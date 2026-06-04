import os

CADDYFILE = os.environ.get("CADDYFILE_PATH", "/etc/caddy/Caddyfile")
BACKUP_DIR = os.environ.get("BACKUP_DIR", "/backups")
AUDIT_LOG = os.environ.get("AUDIT_LOG", "/backups/audit.log")
ALLOWED_DOMAIN = os.environ.get("ALLOWED_DOMAIN", "")
ALLOWED_EMAILS = [
    e.strip()
    for e in os.environ.get("ALLOWED_EMAILS", "").split(",")
    if e.strip()
]
SESSION_TIMEOUT_HOURS = int(os.environ.get("SESSION_TIMEOUT_HOURS", "8"))
SERVER_URL = os.environ.get("SERVER_URL", "http://localhost:9090")
AUTH_MODE = os.environ.get("AUTH_MODE", "google").lower()
CADDY_API_URL = os.environ.get("CADDY_API_URL", "http://caddy:2019")

os.makedirs(BACKUP_DIR, exist_ok=True)
