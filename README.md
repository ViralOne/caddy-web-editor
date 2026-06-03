# Caddy Editor

Web UI to edit your Caddyfile. Google OAuth, backup/restore with diff, validate before save.

## Local Dev

```bash
cp .env.example .env   # fill in GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ALLOWED_DOMAIN
docker compose up -d --build
# open http://localhost:9090
```

Google OAuth redirect URI: `http://localhost:9090/auth/callback`

## Deploy (Production)

Uses `docker-compose.prod.yaml` which runs 3 containers: caddy + caddy-editor + cloudflared.

```bash
scp -r ./* root@YOUR_SERVER:/opt/caddy-editor/
ssh root@YOUR_SERVER
cd /opt/caddy-editor

# Create .env (see .env.example), set SERVER_URL to your production URL
# Set TUNNEL_TOKEN from Cloudflare Zero Trust -> Tunnels

docker compose -f docker-compose.prod.yaml up -d --build
```

Google OAuth redirect URI: `https://editor.yourdomain.com/auth/callback`

Cloudflare tunnel public hostnames:
- `*.yourdomain.com` -> `http://caddy:80`
- `editor.yourdomain.com` -> `http://caddy-editor:9090`

## Commands

```bash
# Logs
docker compose -f docker-compose.prod.yaml logs -f

# Update
git pull && docker compose -f docker-compose.prod.yaml up -d --build caddy-editor

# Seed initial Caddyfile (first deploy only)
docker run --rm -v caddy-editor_caddy-config:/etc/caddy alpine sh -c 'cat > /etc/caddy/Caddyfile << EOF
{
    auto_https disable_redirects
}

app.yourdomain.com {
    reverse_proxy 10.0.0.1:8080
}
EOF'
```

## How It Works

- Caddy runs with `--watch` — auto-reloads when editor saves the file
- Editor and Caddy share a Docker volume (`caddy-config`)
- Cloudflared tunnels traffic from internet to containers (no exposed ports)
- Backups + audit log stored in `caddy-backups` volume
