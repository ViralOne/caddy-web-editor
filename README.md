# Caddy Editor

Web UI to manage your Caddyfile — edit, validate, format, save & reload with zero downtime. Includes traffic metrics from Caddy's Prometheus endpoint, upstream health monitoring, backup/restore with diff, and audit log.

## Features

- **Code Editor** — CodeMirror 6 with Caddyfile syntax highlighting, find/replace, Cmd+S to save
- **Validate & Format** — runs `caddy validate` and `caddy fmt` before every save
- **Save & Reload** — writes Caddyfile and reloads Caddy via admin API (zero downtime)
- **Traffic Metrics** — total requests, error rate, in-flight connections, bandwidth (from Prometheus)
- **Upstream Health** — live view of backend active requests, fail counts, health status
- **Backups** — automatic pre-save backups with preview, inline diff, and one-click restore
- **Audit Log** — who saved what and when
- **Snippets** — common Caddyfile patterns (reverse proxy, headers, rate limiting, etc.)

## Architecture

```
internet → Cloudflare Access (auth) → cloudflared tunnel → caddy-editor:9090
internet → Cloudflare proxy (SSL)  → caddy:80/443       → your services
```

Three containers:
- **caddy** — the reverse proxy serving your sites (ports 80/443)
- **caddy-editor** — web UI to edit the Caddyfile (no port exposed, accessed via tunnel)
- **cloudflared** — Cloudflare Tunnel connecting the editor to the internet securely

All three share the same `./Caddyfile` via volume mounts. When you save in the editor, it reloads Caddy via its admin API (`POST http://caddy:2019/load`).

## Auth Modes

Set `AUTH_MODE` in `.env`:

| Mode | How it works | Session duration |
|------|-------------|-----------------|
| `google` | Google OAuth login page (needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) | `SESSION_TIMEOUT_HOURS` (default 8h) |
| `cloudflare` | Cloudflare Access handles auth before traffic reaches the app (email OTP) | Configured in CF Zero Trust dashboard (default 24h) |

Both modes support `ALLOWED_DOMAIN` and `ALLOWED_EMAILS` as additional filters.

## Production Deploy

```bash
mkdir caddy && cd caddy

# Create your Caddyfile
cat > Caddyfile << 'EOF'
{
    admin 0.0.0.0:2019
    metrics
}

app.yourdomain.com {
    reverse_proxy 10.0.0.1:8080
}
EOF

# Create .env from example
cp .env.example .env
# Edit: set AUTH_MODE, CLOUDFLARE_TUNNEL_TOKEN, ALLOWED_EMAILS, SECRET_KEY

# Start
docker compose -f docker-compose.prod.yaml up -d
```

**Important:**
- The global block must include `admin 0.0.0.0:2019` so the editor can reload Caddy over the Docker network
- Add `metrics` to the global block to enable traffic metrics in the Metrics tab

## Enabling Metrics

Add to your Caddyfile global block and save:

```caddyfile
{
    admin 0.0.0.0:2019
    metrics
}
```

The Metrics tab will then show request counts, latency, error rates, and bandwidth per server group.

## Upstream Health Checks

To get health status for a backend, add `health_uri` inside the `reverse_proxy` block:

```caddyfile
app.yourdomain.com {
    reverse_proxy 10.0.0.1:8080 {
        health_uri /
        health_interval 30s
    }
}
```

Without this, upstreams show as `n/a` in the health column (passive fail counts still work).

## Cloudflare Setup

1. Add your domain to Cloudflare (nameservers must point to CF)
2. SSL/TLS mode → **Full** (Caddy uses local certs, CF handles public SSL)
3. Zero Trust → Tunnels → create tunnel, copy token to `CLOUDFLARE_TUNNEL_TOKEN`
4. Tunnel public hostname: `ceditor.yourdomain.com` → `http://caddy-editor:9090`
5. Zero Trust → Access → Applications → add policy (email OTP for your allowed emails)

## Local Dev

```bash
cp .env.example .env   # fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_DOMAIN
docker compose up -d --build
# open http://localhost:9090
```

## How Save & Reload Works

1. Formats config with `caddy fmt`
2. Validates with `caddy validate`
3. Backs up current Caddyfile to `/backups/`
4. Writes new content to shared `./Caddyfile`
5. Sends `POST http://caddy:2019/load` to reload Caddy live (zero downtime)

## JS Editor (CodeMirror)

The editor uses CodeMirror 6, bundled locally. To rebuild after changing `src/static/js/editor-src.js`:

```bash
npm install
npm run build
```

The bundle (`editor.bundle.js`) is committed — no build step needed on the server.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_MODE` | yes | `google` | Auth mode: `google` or `cloudflare` |
| `SECRET_KEY` | yes | — | Flask session secret |
| `GOOGLE_CLIENT_ID` | google mode | — | OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | google mode | — | OAuth client secret |
| `CLOUDFLARE_TUNNEL_TOKEN` | cloudflare mode | — | Tunnel token |
| `ALLOWED_DOMAIN` | no | — | Restrict to email domain |
| `ALLOWED_EMAILS` | no | — | Comma-separated allowed emails |
| `SESSION_TIMEOUT_HOURS` | no | `8` | Session lifetime (google mode) |
| `SERVER_URL` | no | `http://localhost:9090` | OAuth callback base URL |
| `CADDY_API_URL` | no | `http://caddy:2019` | Caddy admin API address |
| `CADDYFILE_PATH` | no | `/etc/caddy/Caddyfile` | Path to Caddyfile |
| `BACKUP_DIR` | no | `/backups` | Backup storage directory |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check (no auth) |
| `GET /api/caddyfile` | Get current Caddyfile content |
| `POST /api/validate` | Validate + format config |
| `POST /api/save` | Save and reload Caddy |
| `GET /api/backups` | List backups |
| `GET /api/backups/:name` | Get backup content |
| `DELETE /api/backups/:name` | Delete a backup |
| `GET /api/snippets` | Get snippet templates |
| `GET /api/metrics` | Editor activity metrics |
| `GET /api/traffic` | Caddy Prometheus metrics (parsed) |
| `GET /api/upstreams` | Upstream backend status |
| `GET /api/status` | Caddy version and config validity |
| `GET /api/audit` | Audit log entries |

## Commands

```bash
# Start
docker compose -f docker-compose.prod.yaml up -d

# Logs
docker compose -f docker-compose.prod.yaml logs -f

# Update (pull new image from GHCR)
docker compose -f docker-compose.prod.yaml pull caddy-editor
docker compose -f docker-compose.prod.yaml up -d caddy-editor

# Restart caddy (only needed for admin address changes or image upgrades)
docker compose -f docker-compose.prod.yaml restart caddy
```
