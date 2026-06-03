import os
from datetime import datetime
from functools import wraps

from authlib.integrations.flask_client import OAuth
from flask import Blueprint, jsonify, redirect, render_template, request, session

from .audit import log_action
from .config import ALLOWED_DOMAIN, ALLOWED_EMAILS, SERVER_URL, SESSION_TIMEOUT_HOURS

auth_bp = Blueprint("auth", __name__)

oauth = OAuth()
oauth.register(
    name="google",
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def is_allowed(email: str) -> bool:
    if ALLOWED_EMAILS and email in ALLOWED_EMAILS:
        return True
    if ALLOWED_DOMAIN and email.endswith(f"@{ALLOWED_DOMAIN}"):
        return True
    if not ALLOWED_DOMAIN and not ALLOWED_EMAILS:
        return True
    return False


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get("user"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect("/welcome")
        login_time = session.get("login_time", 0)
        if datetime.now().timestamp() - login_time > SESSION_TIMEOUT_HOURS * 3600:
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify({"error": "session expired"}), 401
            return redirect("/welcome")
        return f(*args, **kwargs)
    return decorated


@auth_bp.route("/welcome")
def welcome():
    return render_template("welcome.html")


@auth_bp.route("/login")
def login():
    redirect_uri = f"{SERVER_URL}/auth/callback"
    return oauth.google.authorize_redirect(redirect_uri)


@auth_bp.route("/auth/callback")
def callback():
    try:
        token = oauth.google.authorize_access_token()
    except Exception:
        return "OAuth error. <a href='/login'>Try again</a>", 400
    userinfo = token.get("userinfo")
    if not userinfo:
        return "Auth failed. <a href='/login'>Try again</a>", 401

    email = userinfo.get("email", "")
    if not is_allowed(email):
        log_action("login_denied", email)
        return f"Access denied for {email}. Only {ALLOWED_DOMAIN or 'allowed emails'} permitted.", 403

    session["user"] = {"email": email, "name": userinfo.get("name", email)}
    session["login_time"] = datetime.now().timestamp()
    session.permanent = True
    log_action("login", email)
    return redirect("/")


@auth_bp.route("/logout")
def logout():
    user = session.get("user", {}).get("email", "unknown")
    log_action("logout", user)
    session.clear()
    return redirect("/")
