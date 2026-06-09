import hashlib
import json
import os
import shutil
import subprocess
from datetime import datetime

import requests as http_client
from flask import Blueprint, jsonify, render_template, request, session

from ..audit import log_action
from ..auth import get_or_create_csrf, login_required
from ..config import BACKUP_DIR, CADDY_API_URL, CADDY_LOG_FILE, CADDYFILE
from ..validator import caddy_fmt, caddy_validate, smart_validate


editor_bp = Blueprint("editor", __name__)


def _version(content: str) -> str:
    """Short content hash used for optimistic-locking on save."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


def _current_file_version() -> str:
    try:
        with open(CADDYFILE) as f:
            return _version(f.read())
    except OSError:
        return ""


def _apply_config(content: str, user: str, source: str):
    """Back up the current Caddyfile, write new content, reload Caddy.

    `content` must already be formatted and validated. Returns a Flask response
    tuple. Shared by /api/save and /api/backups/<name>/restore.
    """
    backup_name = f"Caddyfile.{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(CADDYFILE, os.path.join(BACKUP_DIR, backup_name))

    with open(CADDYFILE, "w") as f:
        f.write(content)

    new_version = _version(content)

    try:
        resp = http_client.post(
            f"{CADDY_API_URL}/load",
            data=content,
            headers={"Content-Type": "text/caddyfile"},
            timeout=10,
        )
        if resp.status_code == 200:
            log_action(f"{source}_reload", user, f"backup={backup_name}")
            return jsonify({
                "ok": True,
                "message": f"Saved and reloaded by {user}",
                "content": content,
                "version": new_version,
            })
        log_action(f"{source}_reload_failed", user, resp.text[:200])
        return jsonify({
            "ok": False,
            "message": f"Saved but reload failed: {resp.text}",
            "version": new_version,
        }), 500
    except http_client.ConnectionError:
        log_action(f"{source}_no_reload", user, f"backup={backup_name}, caddy not reachable")
        return jsonify({
            "ok": True,
            "message": f"Saved by {user} (Caddy not reachable — reload skipped)",
            "content": content,
            "version": new_version,
        })


@editor_bp.route("/")
@login_required
def index():
    return render_template("index.html", csrf_token=get_or_create_csrf())


@editor_bp.route("/health")
def health():
    return jsonify({"status": "ok"}), 200


@editor_bp.route("/api/me")
@login_required
def me():
    return jsonify({**session["user"], "csrf_token": get_or_create_csrf()})


@editor_bp.route("/api/caddyfile", methods=["GET"])
@login_required
def get_caddyfile():
    with open(CADDYFILE) as f:
        content = f.read()
    return jsonify({"content": content, "version": _version(content)})


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
    client_version = data.get("version")
    user = session.get("user", {}).get("email", "unknown")

    # Optimistic locking: reject if the on-disk file changed since the client
    # loaded it (another editor saved in the meantime).
    if client_version is not None:
        current = _current_file_version()
        if current and client_version != current:
            log_action("save_conflict", user, f"client={client_version} disk={current}")
            return jsonify({
                "ok": False,
                "conflict": True,
                "message": "The Caddyfile changed on disk since you loaded it. Reload to get the latest version before saving.",
                "version": current,
            }), 409

    content = caddy_fmt(content)

    is_valid, message = caddy_validate(content)
    if not is_valid:
        log_action("save_failed", user, message[:200])
        return jsonify({"ok": False, "message": f"Invalid config: {message}"}), 400

    return _apply_config(content, user, "save")


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


@editor_bp.route("/api/backups/<name>", methods=["DELETE"])
@login_required
def delete_backup(name):
    safe_name = os.path.basename(name)
    path = os.path.join(BACKUP_DIR, safe_name)
    if not os.path.isfile(path):
        return jsonify({"error": "not found"}), 404
    user = session.get("user", {}).get("email", "unknown")
    os.remove(path)
    log_action("backup_deleted", user, safe_name)
    return jsonify({"ok": True, "message": f"Deleted {safe_name}"})


@editor_bp.route("/api/backups/<name>/restore", methods=["POST"])
@login_required
def restore_backup(name):
    """Restore a backup to the live Caddyfile and reload Caddy in one step."""
    safe_name = os.path.basename(name)
    path = os.path.join(BACKUP_DIR, safe_name)
    if not os.path.isfile(path):
        return jsonify({"error": "not found"}), 404

    user = session.get("user", {}).get("email", "unknown")
    with open(path) as f:
        content = f.read()

    content = caddy_fmt(content)
    is_valid, message = caddy_validate(content)
    if not is_valid:
        log_action("restore_failed", user, f"{safe_name}: {message[:160]}")
        return jsonify({"ok": False, "message": f"Backup is not valid, not restored: {message}"}), 400

    log_action("restore", user, safe_name)
    return _apply_config(content, user, "restore")


@editor_bp.route("/api/logs", methods=["GET"])
@login_required
def get_logs():
    """Tail the Caddy log file for the Logs panel (polled by the client).

    Pass ?pos=<byte-offset> to fetch only new content since the last poll.
    Without pos, returns roughly the last 8 KB.
    """
    path = CADDY_LOG_FILE
    if not os.path.isfile(path):
        return jsonify({"exists": False, "path": path, "lines": [], "pos": 0})

    size = os.path.getsize(path)
    pos = request.args.get("pos", type=int)
    initial = pos is None

    MAX_CHUNK = 131072  # 128 KB cap per poll
    if initial or pos < 0 or pos > size:
        start = max(0, size - 8192)
    else:
        start = pos
    if size - start > MAX_CHUNK:
        start = size - MAX_CHUNK

    with open(path, "r", errors="replace") as f:
        f.seek(start)
        chunk = f.read()

    lines = chunk.splitlines()
    # On the first read we may have started mid-line; drop the partial line.
    if initial and start > 0 and lines:
        lines = lines[1:]

    return jsonify({"exists": True, "path": path, "lines": lines, "pos": size})


@editor_bp.route("/api/snippets", methods=["GET"])
@login_required
def get_snippets():
    snippets_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "snippets.json")
    with open(snippets_path) as f:
        snippets = json.load(f)
    return jsonify({"snippets": snippets})
