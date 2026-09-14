import json
import os
import re
from datetime import datetime

import requests as http_client
from flask import Blueprint, jsonify

from ..auth import login_required
from ..config import AUDIT_LOG, BACKUP_DIR, CADDY_API_URL, CADDYFILE
from ..validator import run_caddy

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
    rc, stdout, _ = run_caddy(["caddy", "version"], timeout=5)
    version = stdout.strip() if rc == 0 else "unknown"

    validate_rc, _, _ = run_caddy(
        ["caddy", "validate", "--config", CADDYFILE, "--adapter", "caddyfile"]
    )
    config_valid = validate_rc == 0

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
        if resp.status_code != 200:
            return jsonify({"upstreams": [], "error": f"Caddy returned {resp.status_code}"})
        rows = resp.json()
    except http_client.ConnectionError:
        return jsonify({"upstreams": [], "error": "Caddy admin API not reachable"})
    except Exception as e:
        return jsonify({"upstreams": [], "error": str(e)})

    # Caddy's upstreams endpoint only reports the dial address, so join it with
    # the running config to say which sites proxy there and which kinds of
    # health check are configured.
    detail = _get_upstream_detail()
    enriched = []
    for row in rows if isinstance(rows, list) else []:
        info = detail.get(row.get("address"), {})
        enriched.append({
            **row,
            "domains": info.get("domains", []),
            # `fails` is only ever populated when passive health checking is on,
            # which requires fail_duration > 0 (Caddy's default is 0 = off).
            "passive_health": info.get("passive", False),
            "active_health": info.get("active", False),
        })
    enriched.sort(key=lambda u: (not u["domains"], u["domains"][:1], u.get("address", "")))
    return jsonify({"upstreams": enriched})


def _get_upstream_detail():
    """Map each upstream dial address to its sites and health-check config."""
    try:
        resp = http_client.get(f"{CADDY_API_URL}/config/apps/http/servers", timeout=3)
        if resp.status_code != 200:
            return {}
        servers = resp.json()
        if not isinstance(servers, dict):
            return {}
    except Exception:
        return {}

    detail = {}
    for srv_config in servers.values():
        if isinstance(srv_config, dict):
            _walk_routes(srv_config.get("routes", []), [], detail)
    for info in detail.values():
        info["domains"] = sorted(info["domains"])
    return detail


def _walk_routes(routes, hosts, detail):
    """Recursively collect reverse_proxy upstreams, carrying host matchers down.

    reverse_proxy handlers are normally nested inside a subroute handler, so the
    host matcher lives on an outer route.
    """
    if not isinstance(routes, list):
        return
    for route in routes:
        if not isinstance(route, dict):
            continue
        route_hosts = list(hosts)
        for match_set in route.get("match", []) or []:
            if isinstance(match_set, dict):
                route_hosts.extend(match_set.get("host", []) or [])
        for handler in route.get("handle", []) or []:
            if not isinstance(handler, dict):
                continue
            if handler.get("handler") == "reverse_proxy":
                checks = handler.get("health_checks") or {}
                passive = bool((checks.get("passive") or {}).get("fail_duration"))
                active = bool(checks.get("active"))
                for upstream in handler.get("upstreams", []) or []:
                    dial = (upstream or {}).get("dial")
                    if not dial:
                        continue
                    info = detail.setdefault(dial, {"domains": set(), "passive": False, "active": False})
                    info["domains"].update(route_hosts)
                    info["passive"] = info["passive"] or passive
                    info["active"] = info["active"] or active
            # subroute (and similar wrappers) nest another route list.
            _walk_routes(handler.get("routes", []), route_hosts, detail)


@ops_bp.route("/api/traffic", methods=["GET"])
@login_required
def traffic():
    try:
        resp = http_client.get(f"{CADDY_API_URL}/metrics", timeout=5)
        if resp.status_code == 404:
            return jsonify({"error": "Metrics endpoint not found (404). Add to global block: servers { metrics }", "sites": {}})
        if resp.status_code != 200:
            return jsonify({"error": f"Caddy returned HTTP {resp.status_code}: {resp.text[:200]}", "sites": {}})
        if "caddy_" not in resp.text:
            return jsonify({"error": "Response doesn't contain Caddy metrics. Check Caddy version supports metrics.", "sites": {}})
        result = parse_prometheus_metrics(resp.text)
        result["server_domains"] = _get_server_domain_map()
        return jsonify(result)
    except http_client.ConnectionError as e:
        return jsonify({"error": f"Connection failed to {CADDY_API_URL}/metrics: {e}", "sites": {}})
    except Exception as e:
        return jsonify({"error": f"{type(e).__name__}: {e}", "sites": {}})


def _get_server_domain_map():
    """Fetch running config and map server names (srv0, srv1) to their domains."""
    try:
        resp = http_client.get(f"{CADDY_API_URL}/config/apps/http/servers", timeout=3)
        if resp.status_code != 200:
            return {}
        servers = resp.json()
        if not isinstance(servers, dict):
            return {}
        mapping = {}
        for srv_name, srv_config in servers.items():
            domains = []
            for route in srv_config.get("routes", []):
                for match_set in route.get("match", []):
                    hosts = match_set.get("host", [])
                    domains.extend(hosts)
            if domains:
                mapping[srv_name] = sorted(set(domains))
            else:
                listen = srv_config.get("listen", [])
                if listen:
                    mapping[srv_name] = listen
        return mapping
    except Exception:
        return {}


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
        m = re.match(r'caddy_http_requests_total\{([^}]+)\}\s+([\d.eE+-]+)', line)
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
        m = re.match(r'caddy_http_requests_in_flight\{([^}]+)\}\s+([\d.eE+-]+)', line)
        if m:
            totals["in_flight"] += int(float(m.group(2)))
            continue

        # caddy_http_request_duration_seconds_sum{server="..."}
        m = re.match(r'caddy_http_request_duration_seconds_sum\{([^}]+)\}\s+([\d.eE+-]+)', line)
        if m:
            labels = _parse_labels(m.group(1))
            server = labels.get("server", "unknown")
            if server not in sites:
                sites[server] = {"requests": 0, "errors": 0, "latency_sum": 0, "latency_count": 0, "bytes_in": 0, "bytes_out": 0}
            sites[server]["latency_sum"] += float(m.group(2))
            continue

        # caddy_http_request_duration_seconds_count{server="..."}
        m = re.match(r'caddy_http_request_duration_seconds_count\{([^}]+)\}\s+([\d.eE+-]+)', line)
        if m:
            labels = _parse_labels(m.group(1))
            server = labels.get("server", "unknown")
            if server not in sites:
                sites[server] = {"requests": 0, "errors": 0, "latency_sum": 0, "latency_count": 0, "bytes_in": 0, "bytes_out": 0}
            sites[server]["latency_count"] += int(float(m.group(2)))
            continue

        # caddy_http_request_size_bytes_sum{server="..."}
        m = re.match(r'caddy_http_request_size_bytes_sum\{([^}]+)\}\s+([\d.eE+-]+)', line)
        if m:
            labels = _parse_labels(m.group(1))
            server = labels.get("server", "unknown")
            val = float(m.group(2))
            if server in sites:
                sites[server]["bytes_in"] += val
            totals["bytes_in"] += val
            continue

        # caddy_http_response_size_bytes_sum{server="..."}
        m = re.match(r'caddy_http_response_size_bytes_sum\{([^}]+)\}\s+([\d.eE+-]+)', line)
        if m:
            labels = _parse_labels(m.group(1))
            server = labels.get("server", "unknown")
            val = float(m.group(2))
            if server in sites:
                sites[server]["bytes_out"] += val
            totals["bytes_out"] += val
            continue

        # caddy_reverse_proxy_upstreams_healthy{upstream="..."}
        m = re.match(r'caddy_reverse_proxy_upstreams_healthy\{([^}]+)\}\s+([\d.eE+-]+)', line)
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
