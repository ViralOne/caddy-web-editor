import os
import shutil
import subprocess
from datetime import datetime

from flask import Blueprint, jsonify, render_template, request, session

from ..audit import log_action
from ..auth import login_required
from ..config import BACKUP_DIR, CADDYFILE
from ..validator import caddy_fmt, caddy_validate, smart_validate


editor_bp = Blueprint("editor", __name__)


@editor_bp.route("/")
@login_required
def index():
    return render_template("index.html")


@editor_bp.route("/health")
def health():
    return jsonify({"status": "ok"}), 200


@editor_bp.route("/api/me")
@login_required
def me():
    return jsonify(session["user"])


@editor_bp.route("/api/caddyfile", methods=["GET"])
@login_required
def get_caddyfile():
    with open(CADDYFILE) as f:
        return jsonify({"content": f.read()})


@editor_bp.route("/api/fmt", methods=["POST"])
@login_required
def fmt():
    data = request.json or {}
    content = data.get("content", "")
    formatted = caddy_fmt(content)
    return jsonify({"content": formatted, "changed": formatted != content})


@editor_bp.route("/api/validate", methods=["POST"])
@login_required
def validate():
    data = request.json or {}
    content = data.get("content", "")

    formatted = caddy_fmt(content)
    warnings = smart_validate(formatted)
    is_valid, message = caddy_validate(formatted)

    if not is_valid:
        return jsonify({"valid": False, "message": message, "warnings": [], "formatted": None})

    if warnings:
        return jsonify({"valid": True, "message": "Caddy valid, but check warnings", "warnings": warnings, "formatted": formatted if formatted != content else None})

    return jsonify({"valid": True, "message": "Config is valid", "warnings": [], "formatted": formatted if formatted != content else None})


@editor_bp.route("/api/save", methods=["POST"])
@login_required
def save():
    data = request.json or {}
    content = data.get("content", "")
    user = session.get("user", {}).get("email", "unknown")

    content = caddy_fmt(content)

    is_valid, message = caddy_validate(content)
    if not is_valid:
        log_action("save_failed", user, message[:200])
        return jsonify({"ok": False, "message": f"Invalid config: {message}"}), 400

    backup_name = f"Caddyfile.{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(CADDYFILE, os.path.join(BACKUP_DIR, backup_name))

    with open(CADDYFILE, "w") as f:
        f.write(content)

    reload_result = subprocess.run(
        ["caddy", "reload", "--config", CADDYFILE, "--adapter", "caddyfile"],
        capture_output=True, text=True,
    )

    if reload_result.returncode == 0:
        log_action("save_reload", user, f"backup={backup_name}")
        return jsonify({"ok": True, "message": f"Saved and reloaded by {user}", "content": content})

    if "connection refused" in reload_result.stderr:
        log_action("save_no_reload", user, f"backup={backup_name}, caddy not running")
        return jsonify({"ok": True, "message": f"Saved by {user} (Caddy not running — reload skipped)", "content": content})

    log_action("reload_failed", user, reload_result.stderr[:200])
    return jsonify({"ok": False, "message": f"Saved but reload failed: {reload_result.stderr}"}), 500


@editor_bp.route("/api/backups", methods=["GET"])
@login_required
def list_backups():
    files = sorted(
        [f for f in os.listdir(BACKUP_DIR) if f.startswith("Caddyfile.")],
        reverse=True,
    )[:20]
    return jsonify({"backups": files})


@editor_bp.route("/api/backups/<name>", methods=["GET"])
@login_required
def get_backup(name):
    safe_name = os.path.basename(name)
    path = os.path.join(BACKUP_DIR, safe_name)
    if not os.path.isfile(path):
        return jsonify({"error": "not found"}), 404
    with open(path) as f:
        return jsonify({"content": f.read()})


