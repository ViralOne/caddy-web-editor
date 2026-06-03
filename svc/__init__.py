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

    return app
