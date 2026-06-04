import json
import os
import re
import subprocess
from datetime import datetime

import requests as http_client
from flask import Blueprint, jsonify

from ..auth import login_required
from ..config import AUDIT_LOG, BACKUP_DIR, CADDY_API_URL, CADDYFILE

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


@ops_bp.route("/api/upstreams", methods=["GET"])
@login_required
def upstreams():
    try:
        resp = http_client.get(f"{CADDY_API_URL}/reverse_proxy/upstreams", timeout=5)
        if resp.status_code == 200:
            return jsonify({"upstreams": resp.json()})
        return jsonify({"upstreams": [], "error": f"Caddy returned {resp.status_code}"})
    except http_client.ConnectionError:
        return jsonify({"upstreams": [], "error": "Caddy admin API not reachable"})
    except Exception as e:
        return jsonify({"upstreams": [], "error": str(e)})


@ops_bp.route("/api/traffic", methods=["GET"])
@login_required
def traffic():
    try:
        resp = http_client.get(f"{CADDY_API_URL}/metrics", timeout=5)
        if resp.status_code != 200:
            return jsonify({"error": f"Caddy returned {resp.status_code}", "sites": {}})
        return jsonify(parse_prometheus_metrics(resp.text))
    except http_client.ConnectionError:
        return jsonify({"error": "Caddy metrics endpoint not reachable", "sites": {}})
    except Exception as e:
        return jsonify({"error": str(e), "sites": {}})


def parse_prometheus_metrics(text):
    sites = {}
    totals = {
        "requests": 0,
        "errors": 0,
        "in_flight": 0,
        "bytes_in": 0,
        "bytes_out": 0,
    }
    upstreams_healthy = {}

    for line in text.split("\n"):
        if line.startswith("#") or not line.strip():
            continue

        # caddy_http_requests_total{server="...",handler="...",code="...",method="..."}
        m = re.match(r'caddy_http_requests_total\{([^}]+)\}\s+([\d.eE+]+)', line)
        if m:
            labels = _parse_labels(m.group(1))
            count = int(float(m.group(2)))
            server = labels.get("server", "unknown")
            code = labels.get("code", "")
            if server not in sites:
                sites[server] = {"requests": 0, "errors": 0, "latency_sum": 0, "latency_count": 0, "bytes_in": 0, "bytes_out": 0}
            sites[server]["requests"] += count
            totals["requests"] += count
            if code.startswith("5"):
                sites[server]["errors"] += count
                totals["errors"] += count
            continue

        # caddy_http_requests_in_flight{server="..."}
        m = re.match(r'caddy_http_requests_in_flight\{([^}]+)\}\s+([\d.eE+]+)', line)
        if m:
            totals["in_flight"] += int(float(m.group(2)))
            continue

        # caddy_http_request_duration_seconds_sum{server="..."}
        m = re.match(r'caddy_http_request_duration_seconds_sum\{([^}]+)\}\s+([\d.eE+]+)', line)
        if m:
            labels = _parse_labels(m.group(1))
            server = labels.get("server", "unknown")
            if server not in sites:
                sites[server] = {"requests": 0, "errors": 0, "latency_sum": 0, "latency_count": 0, "bytes_in": 0, "bytes_out": 0}
            sites[server]["latency_sum"] += float(m.group(2))
            continue

        # caddy_http_request_duration_seconds_count{server="..."}
        m = re.match(r'caddy_http_request_duration_seconds_count\{([^}]+)\}\s+([\d.eE+]+)', line)
        if m:
            labels = _parse_labels(m.group(1))
            server = labels.get("server", "unknown")
            if server not in sites:
                sites[server] = {"requests": 0, "errors": 0, "latency_sum": 0, "latency_count": 0, "bytes_in": 0, "bytes_out": 0}
            sites[server]["latency_count"] += int(float(m.group(2)))
            continue

        # caddy_http_request_size_bytes_sum{server="..."}
        m = re.match(r'caddy_http_request_size_bytes_sum\{([^}]+)\}\s+([\d.eE+]+)', line)
        if m:
            labels = _parse_labels(m.group(1))
            server = labels.get("server", "unknown")
            val = float(m.group(2))
            if server in sites:
                sites[server]["bytes_in"] += val
            totals["bytes_in"] += val
            continue

        # caddy_http_response_size_bytes_sum{server="..."}
        m = re.match(r'caddy_http_response_size_bytes_sum\{([^}]+)\}\s+([\d.eE+]+)', line)
        if m:
            labels = _parse_labels(m.group(1))
            server = labels.get("server", "unknown")
            val = float(m.group(2))
            if server in sites:
                sites[server]["bytes_out"] += val
            totals["bytes_out"] += val
            continue

        # caddy_reverse_proxy_upstreams_healthy{upstream="..."}
        m = re.match(r'caddy_reverse_proxy_upstreams_healthy\{([^}]+)\}\s+([\d.eE+]+)', line)
        if m:
            labels = _parse_labels(m.group(1))
            upstream = labels.get("upstream", "unknown")
            upstreams_healthy[upstream] = int(float(m.group(2)))
            continue

    site_list = {}
    for server, data in sites.items():
        avg_latency = (data["latency_sum"] / data["latency_count"] * 1000) if data["latency_count"] > 0 else 0
        error_rate = (data["errors"] / data["requests"] * 100) if data["requests"] > 0 else 0
        site_list[server] = {
            "requests": data["requests"],
            "errors": data["errors"],
            "error_rate": round(error_rate, 2),
            "avg_latency_ms": round(avg_latency, 1),
            "bytes_in": int(data["bytes_in"]),
            "bytes_out": int(data["bytes_out"]),
        }

    return {
        "sites": site_list,
        "totals": totals,
        "upstreams_healthy": upstreams_healthy,
    }


def _parse_labels(label_str):
    labels = {}
    for m in re.finditer(r'(\w+)="([^"]*)"', label_str):
        labels[m.group(1)] = m.group(2)
    return labels
