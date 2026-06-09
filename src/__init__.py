from datetime import timedelta
import os
import secrets

from flask import Flask

from .auth import auth_bp, oauth
from .config import AUTH_MODE
from .routes.editor import editor_bp
from .routes.ops import ops_bp

# Known placeholder secrets that must never be used to sign real sessions.
_INSECURE_SECRETS = {"", "dev-secret-change-me", "change-me-to-a-random-string"}


def create_app():
    app = Flask(
        __name__,
        static_folder="static",
        template_folder="templates",
    )

    secret_key = os.environ.get("SECRET_KEY", "").strip()
    if secret_key in _INSECURE_SECRETS:
        if AUTH_MODE == "google":
            raise RuntimeError(
                "SECRET_KEY must be set to a strong random value when AUTH_MODE=google. "
                'Generate one with: python -c "import secrets; print(secrets.token_hex(32))"'
            )
        secret_key = secrets.token_hex(32)
    app.secret_key = secret_key

    app.config["PREFERRED_URL_SCHEME"] = "http"
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(
        hours=int(os.environ.get("SESSION_TIMEOUT_HOURS", "8"))
    )

    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
        != "false",
    )

    if AUTH_MODE == "google":
        oauth.init_app(app)

    app.register_blueprint(auth_bp)
    app.register_blueprint(editor_bp)
    app.register_blueprint(ops_bp)

    @app.after_request
    def security_headers(response):
        response.headers["Server"] = "Microsoft-IIS/10.0"
        response.headers["X-Powered-By"] = "ASP.NET"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response

    return app
