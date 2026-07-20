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

# Remember the last signed-in account for 90 days so returning users can be
# re-authenticated silently (prompt=none) and get the right account pre-selected.
LOGIN_HINT_COOKIE = "last_login_hint"
LOGIN_HINT_MAX_AGE = 60 * 60 * 24 * 90


def _cookie_secure() -> bool:
    return os.environ.get("SESSION_COOKIE_SECURE", "true").lower() != "false"


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
    # Returning users with a remembered account get a one-shot silent sign-in.
    # `retry=1` is set after a silent attempt fails, so we don't loop.
    if (
        AUTH_MODE == "google"
        and request.cookies.get(LOGIN_HINT_COOKIE)
        and request.args.get("retry") != "1"
    ):
        return redirect("/login/silent")
    return render_template("welcome.html")


@auth_bp.route("/login")
def login():
    if AUTH_MODE == "cloudflare":
        return redirect("/")
    redirect_uri = f"{SERVER_URL}/auth/callback"
    extra = {}
    # Pre-select the account the user signed in with last time so even the
    # interactive screen skips account selection.
    login_hint = request.cookies.get(LOGIN_HINT_COOKIE)
    if login_hint:
        extra["login_hint"] = login_hint
    return oauth.google.authorize_redirect(redirect_uri, **extra)


@auth_bp.route("/login/silent")
def login_silent():
    """Attempt to sign in without any Google UI.

    If the user still has a live Google session and has already granted
    consent, Google returns a token with no screen shown. Otherwise it
    redirects back with an error and we fall through to the visible button.
    """
    if AUTH_MODE == "cloudflare":
        return redirect("/")
    login_hint = request.cookies.get(LOGIN_HINT_COOKIE)
    if not login_hint:
        # No prior account known: a silent attempt can only fail, so skip it.
        return redirect("/login")
    session["silent_auth"] = True
    redirect_uri = f"{SERVER_URL}/auth/callback"
    return oauth.google.authorize_redirect(
        redirect_uri, prompt="none", login_hint=login_hint
    )


@auth_bp.route("/auth/callback")
def callback():
    if AUTH_MODE == "cloudflare":
        return redirect("/")
    was_silent = session.pop("silent_auth", False)
    if request.args.get("error"):
        # prompt=none couldn't complete without interaction (e.g.
        # login_required / interaction_required / consent_required).
        # Fall back to the normal button instead of showing an error.
        if was_silent:
            return redirect("/welcome?retry=1")
        return "OAuth error. <a href='/login'>Try again</a>", 400
    try:
        token = oauth.google.authorize_access_token()
    except Exception:
        if was_silent:
            return redirect("/welcome?retry=1")
        return "OAuth error. <a href='/login'>Try again</a>", 400
    userinfo = token.get("userinfo")
    if not userinfo:
        if was_silent:
            return redirect("/welcome?retry=1")
        return "Auth failed. <a href='/login'>Try again</a>", 401

    email = userinfo.get("email", "")
    if not is_allowed(email):
        log_action("login_denied", email)
        return f"Access denied for {email}. Only {ALLOWED_DOMAIN or 'allowed emails'} permitted.", 403

    session["user"] = {"email": email, "name": userinfo.get("name", email)}
    session["login_time"] = datetime.now().timestamp()
    session.permanent = True
    log_action("login", email)
    resp = redirect("/")
    resp.set_cookie(
        LOGIN_HINT_COOKIE,
        email,
        max_age=LOGIN_HINT_MAX_AGE,
        httponly=True,
        samesite="Lax",
        secure=_cookie_secure(),
    )
    return resp


@auth_bp.route("/logout")
def logout():
    user = session.get("user", {}).get("email")
    if user:
        log_action("logout", user)
    session.clear()
    if AUTH_MODE == "cloudflare":
        return redirect("/cdn-cgi/access/logout")
    # Forget the remembered account so /welcome doesn't silently sign back in.
    resp = redirect("/welcome?retry=1")
    resp.delete_cookie(LOGIN_HINT_COOKIE)
    return resp
