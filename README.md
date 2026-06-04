# Caddy Editor

Web UI to edit your Caddyfile. Validate, format, save & reload — with backup/restore and audit log.

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

| Mode | How it works |
|------|-------------|
| `google` | Google OAuth login page (needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) |
| `cloudflare` | Cloudflare Access handles auth before traffic reaches the app (email OTP, no passwords) |

Both modes support `ALLOWED_DOMAIN` and `ALLOWED_EMAILS` as additional filters.

## Production Deploy

```bash
# On your server/NAS
mkdir caddy && cd caddy

# Create your Caddyfile
cat > Caddyfile << 'EOF'
{
    admin 0.0.0.0:2019
    local_certs
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

**Important:** The Caddyfile global block must include `admin 0.0.0.0:2019` so the editor container can reload Caddy over the Docker network.

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

1. Validates config with `caddy validate` (binary in editor container)
2. Backs up current Caddyfile to `/backups/`
3. Writes new content to shared `./Caddyfile`
4. Sends `POST http://caddy:2019/load` to reload Caddy server live (zero downtime)

## JS Editor (CodeMirror)

The editor uses CodeMirror 6, bundled locally. To rebuild after changing `svc/static/js/editor-src.js`:

```bash
npm install
npm run build
```

The bundle (`editor.bundle.js`) is committed — no build step needed on the server.

## Commands

```bash
# Start
docker compose -f docker-compose.prod.yaml up -d

# Logs
docker compose -f docker-compose.prod.yaml logs -f

# Update (pull new image from GHCR)
docker compose -f docker-compose.prod.yaml pull caddy-editor
docker compose -f docker-compose.prod.yaml up -d caddy-editor

# Restart caddy after Caddyfile global block changes
docker compose -f docker-compose.prod.yaml restart caddy
```
