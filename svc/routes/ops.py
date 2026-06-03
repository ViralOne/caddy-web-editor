import json
import os
import subprocess
from datetime import datetime

from flask import Blueprint, jsonify

from ..auth import login_required
from ..config import AUDIT_LOG, CADDYFILE

ops_bp = Blueprint("ops", __name__)


@ops_bp.route("/api/audit", methods=["GET"])
@login_required
def get_audit():
    if not os.path.isfile(AUDIT_LOG):
        return jsonify({"entries": []})
    with open(AUDIT_LOG) as f:
        lines = f.readlines()[-50:]
    entries = []
    for line in reversed(lines):
        try:
            entries.append(json.loads(line.strip()))
        except json.JSONDecodeError:
            pass
    return jsonify({"entries": entries})


@ops_bp.route("/api/status", methods=["GET"])
@login_required
def caddy_status():
    result = subprocess.run(["caddy", "version"], capture_output=True, text=True)
    version = result.stdout.strip() if result.returncode == 0 else "unknown"

    validate_result = subprocess.run(
        ["caddy", "validate", "--config", CADDYFILE, "--adapter", "caddyfile"],
        capture_output=True, text=True,
    )
    config_valid = validate_result.returncode == 0

    try:
        mtime = os.path.getmtime(CADDYFILE)
        last_modified = datetime.fromtimestamp(mtime).isoformat()
    except OSError:
        last_modified = "unknown"

    return jsonify({
        "caddy_version": version,
        "config_valid": config_valid,
        "config_path": CADDYFILE,
        "last_modified": last_modified,
    })
