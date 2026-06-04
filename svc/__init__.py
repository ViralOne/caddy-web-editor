from datetime import timedelta
import os

from flask import Flask

from .auth import auth_bp, oauth
from .routes.editor import editor_bp
from .routes.ops import ops_bp
from .routes.sites import sites_bp


def create_app():
    app = Flask(
        __name__,
        static_folder="static",
        template_folder="templates",
    )

    app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    app.config["PREFERRED_URL_SCHEME"] = "http"
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(
        hours=int(os.environ.get("SESSION_TIMEOUT_HOURS", "8"))
    )

    oauth.init_app(app)

    app.register_blueprint(auth_bp)
    app.register_blueprint(editor_bp)
    app.register_blueprint(sites_bp)
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
