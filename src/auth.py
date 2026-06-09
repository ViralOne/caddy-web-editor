import hmac
import os
import secrets
from datetime import datetime
from functools import wraps

from authlib.integrations.flask_client import OAuth
from flask import Blueprint, jsonify, redirect, render_template, request, session

from .audit import log_action
from .config import ALLOWED_DOMAIN, ALLOWED_EMAILS, AUTH_MODE, SERVER_URL, SESSION_TIMEOUT_HOURS

auth_bp = Blueprint("auth", __name__)


def get_or_create_csrf() -> str:
    """Return the session CSRF token, creating one if absent."""
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def csrf_valid() -> bool:
    """Constant-time compare of the X-CSRF-Token header against the session token."""
    sent = request.headers.get("X-CSRF-Token", "")
    expected = session.get("csrf_token", "")
    return bool(expected) and hmac.compare_digest(sent, expected)


oauth = OAuth()
if AUTH_MODE == "google":
    oauth.register(
        name="google",
        client_id=os.environ.get("GOOGLE_CLIENT_ID"),
        client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


def is_allowed(email: str) -> bool:
    if not email:
        return False
    if ALLOWED_EMAILS and email in ALLOWED_EMAILS:
        return True
    if ALLOWED_DOMAIN and email.endswith(f"@{ALLOWED_DOMAIN}"):
        return True
    return False


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if AUTH_MODE == "cloudflare":
            email = request.headers.get("Cf-Access-Authenticated-User-Email", "")
            if not email:
                if request.path.startswith("/api/"):
                    return jsonify({"error": "unauthorized"}), 401
                return "Access denied. Not authenticated via Cloudflare Access.", 403
            if not is_allowed(email):
                return jsonify({"error": f"access denied for {email}"}), 403
            session["user"] = {"email": email, "name": email}
            return f(*args, **kwargs)

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
    if AUTH_MODE == "cloudflare":
        return redirect("/")
    return render_template("welcome.html")


@auth_bp.route("/login")
def login():
    if AUTH_MODE == "cloudflare":
        return redirect("/")
    redirect_uri = f"{SERVER_URL}/auth/callback"
    return oauth.google.authorize_redirect(redirect_uri)


@auth_bp.route("/auth/callback")
def callback():
    if AUTH_MODE == "cloudflare":
        return redirect("/")
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
    user = session.get("user", {}).get("email")
    if user:
        log_action("logout", user)
    session.clear()
    if AUTH_MODE == "cloudflare":
        return redirect("/cdn-cgi/access/logout")
    return redirect("/welcome")
