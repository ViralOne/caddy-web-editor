import ipaddress
import json
import os
import subprocess
import urllib.parse

from flask import Blueprint, jsonify, request

from ..auth import login_required
from ..config import CADDYFILE

BLOCKED_NETWORKS = [
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
]

sites_bp = Blueprint("sites", __name__)


@sites_bp.route("/api/sites", methods=["GET"])
@login_required
def list_sites():
    """Parse Caddyfile and return structured site list."""
    with open(CADDYFILE) as f:
        content = f.read()

    sites = []
    current_site = None
    brace_depth = 0
    in_global = False

    for line in content.split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        if stripped == "{" and brace_depth == 0 and current_site is None:
            in_global = True
            brace_depth = 1
            continue

        if in_global:
            brace_depth += stripped.count("{") - stripped.count("}")
            if brace_depth <= 0:
                in_global = False
            continue

        if brace_depth == 0 and "{" in stripped:
            addr = stripped.rstrip(" {").strip()
            current_site = {"domain": addr, "backend": "", "directives": []}
            brace_depth = 1
        elif brace_depth == 1 and stripped == "}":
            if current_site:
                sites.append(current_site)
            current_site = None
            brace_depth = 0
        elif current_site is not None:
            if stripped.startswith("reverse_proxy"):
                current_site["backend"] = stripped.replace("reverse_proxy", "").strip()
            else:
                current_site["directives"].append(stripped)
            brace_depth += stripped.count("{") - stripped.count("}")

    return jsonify({"sites": sites})


def is_blocked_url(url: str) -> bool:
    """Block SSRF attempts to internal/metadata IPs."""
    try:
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname or ""
        ip = ipaddress.ip_address(host)
        return any(ip in net for net in BLOCKED_NETWORKS)
    except ValueError:
        return False


@sites_bp.route("/api/health-check", methods=["POST"])
@login_required
def health_check():
    """Curl a domain and return response code + time."""
    data = request.json or {}
    url = data.get("url", "")

    if not url.startswith("http"):
        url = f"https://{url}"

    if is_blocked_url(url):
        return jsonify({"ok": False, "url": url, "code": 0, "time": 0, "error": "blocked: internal IP"})

    try:
        result = subprocess.run(
            [
                "curl", "-sk", "-o", "/dev/null", "-w",
                '{"code":%{http_code},"time":%{time_total}}',
                "--max-time", "5", url,
            ],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            info = json.loads(result.stdout)
            return jsonify({"ok": True, "url": url, **info})
        return jsonify({"ok": False, "url": url, "code": 0, "time": 0, "error": "timeout"})
    except Exception as e:
        return jsonify({"ok": False, "url": url, "code": 0, "time": 0, "error": str(e)})


@sites_bp.route("/api/snippets", methods=["GET"])
@login_required
def get_snippets():
    snippets_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "snippets.json")
    with open(snippets_path) as f:
        snippets = json.load(f)
    return jsonify({"snippets": snippets})
