import json
import os
import ssl
import socket
import subprocess
from datetime import datetime

from flask import Blueprint, jsonify

from ..auth import login_required
from ..config import AUDIT_LOG, BACKUP_DIR, CADDYFILE

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


@ops_bp.route("/api/ssl", methods=["GET"])
@login_required
def ssl_info():
    with open(CADDYFILE) as f:
        content = f.read()

    domains = []
    for line in content.split("\n"):
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and not stripped.startswith("{") and "{" in stripped:
            domain = stripped.rstrip(" {").strip()
            if "." in domain and not domain.startswith("*"):
                domains.append(domain)

    certs = []
    for domain in domains:
        certs.append(_get_cert_info(domain))

    return jsonify({"certs": certs})


def _get_cert_info(domain):
    try:
        ctx = ssl.create_default_context()
        conn = ctx.wrap_socket(socket.socket(), server_hostname=domain)
        conn.settimeout(5)
        conn.connect((domain, 443))
        cert = conn.getpeercert()
        conn.close()

        not_after = datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z")
        not_before = datetime.strptime(cert["notBefore"], "%b %d %H:%M:%S %Y %Z")
        days_left = (not_after - datetime.now()).days
        issuer = dict(x[0] for x in cert.get("issuer", []))

        return {
            "domain": domain,
            "valid": True,
            "issuer": issuer.get("organizationName", issuer.get("commonName", "Unknown")),
            "expires": not_after.isoformat(),
            "issued": not_before.isoformat(),
            "days_left": days_left,
            "status": "ok" if days_left > 14 else "warning" if days_left > 0 else "expired",
        }
    except Exception as e:
        return {
            "domain": domain,
            "valid": False,
            "error": str(e),
            "status": "error",
        }


@ops_bp.route("/api/metrics", methods=["GET"])
@login_required
def metrics():
    total_saves = 0
    total_logins = 0
    users = set()
    saves_today = 0
    today = datetime.now().strftime("%Y-%m-%d")

    if os.path.isfile(AUDIT_LOG):
        with open(AUDIT_LOG) as f:
            for line in f:
                try:
                    entry = json.loads(line.strip())
                    action = entry.get("action", "")
                    if "save" in action:
                        total_saves += 1
                        if entry.get("time", "").startswith(today):
                            saves_today += 1
                    if action == "login":
                        total_logins += 1
                    users.add(entry.get("user", ""))
                except json.JSONDecodeError:
                    pass

    with open(CADDYFILE) as f:
        content = f.read()
    site_count = content.count("reverse_proxy")
    config_lines = len(content.split("\n"))

    backup_count = len([f for f in os.listdir(BACKUP_DIR) if f.startswith("Caddyfile.")])

    try:
        mtime = os.path.getmtime(CADDYFILE)
        last_modified = datetime.fromtimestamp(mtime).isoformat()
    except OSError:
        last_modified = None

    return jsonify({
        "total_saves": total_saves,
        "saves_today": saves_today,
        "total_logins": total_logins,
        "unique_users": len(users),
        "site_count": site_count,
        "backup_count": backup_count,
        "last_modified": last_modified,
        "config_lines": config_lines,
    })
