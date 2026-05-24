# Deployment Guide

**GTM Email System** — Instructions for running in production.

---

## Local Development

### Prerequisites

- [Bun](https://bun.sh) v1.0 or later
- Git

### Setup

```bash
# Install Bun (macOS / Linux)
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# Clone the repo
git clone <your-repo-url>
cd email-sender

# Install dependencies
bun install

# Start the server
bun run src/index.ts
```

Open `http://localhost:3000` and log in with `admin` / `admin123`.

The SQLite database is auto-created at `data/system.db` on first run. All schema migrations run automatically.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `NODE_ENV` | `development` | Set to `production` in prod environments |

No `.env` file is required for local development. Most configuration lives in the database (Settings page).

---

## Railway Deployment

Railway is the simplest cloud option. It handles SSL, auto-restarts, and rolling deploys automatically.

### Step 1 — Push to GitHub

```bash
git remote add origin https://github.com/youruser/email-sender.git
git push -u origin main
```

### Step 2 — Create a Railway Project

1. Go to [railway.app](https://railway.app) and log in
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `email-sender` repository
4. Railway auto-detects Bun and sets the start command

### Step 3 — Configure Start Command

In Railway → Settings → Deploy:

```
bun run src/index.ts
```

### Step 4 — Set Environment Variables

In Railway → Variables, add:

```
PORT=3000
NODE_ENV=production
```

### Step 5 — Add a Persistent Volume

The SQLite database must persist between deploys. Without a volume, your data is wiped on every redeploy.

1. In Railway → your service → **+ Add Volume**
2. Set mount path: `/app/data`
3. Railway keeps this volume across all deploys

### Step 6 — Deploy

Push to GitHub and Railway deploys automatically. The first deploy creates the database. Subsequent pushes migrate the schema in place.

### Step 7 — Set Up Custom Domain (Optional)

1. Railway → Settings → Networking → Custom Domain
2. Add your domain (e.g., `gtm.youragency.com`)
3. Update your DNS: `CNAME gtm → <railway-generated-url>`
4. Railway provisions SSL automatically

### Post-Deploy Checklist for Railway

- [ ] Open the app URL and confirm you can log in
- [ ] Go to Settings → change admin password
- [ ] Add at least one warmup account and verify SMTP connects
- [ ] Go to Health Check and confirm all components are green

---

## Self-Hosted VPS (Ubuntu 24.04)

For full control and lowest cost. A $6/month VPS (2GB RAM, 25GB SSD) is sufficient for up to 10 email accounts and 3 clients.

### Step 1 — Provision a VPS

Any provider works: DigitalOcean, Hetzner, Vultr, Linode. Ubuntu 24.04 LTS recommended.

### Step 2 — SSH In and Update

```bash
ssh root@<your-server-ip>
apt update && apt upgrade -y
```

### Step 3 — Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version  # verify
```

### Step 4 — Install PM2 (Process Manager)

PM2 keeps the server running after crashes and restarts on reboot.

```bash
apt install npm -y
npm install -g pm2
```

### Step 5 — Clone the Repo

```bash
cd /var/www
git clone <your-repo-url> email-sender
cd email-sender
bun install
```

### Step 6 — Start with PM2

```bash
pm2 start "bun run src/index.ts" --name gtm-email
pm2 save
pm2 startup  # follow the printed command to enable auto-start
```

Check it's running:

```bash
pm2 status
pm2 logs gtm-email
```

### Step 7 — Install Nginx

Nginx acts as a reverse proxy, handles SSL, and serves the app at port 80/443.

```bash
apt install nginx -y
```

Create a site config:

```bash
nano /etc/nginx/sites-available/gtm
```

Paste:

```nginx
server {
    listen 80;
    server_name gtm.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:

```bash
ln -s /etc/nginx/sites-available/gtm /etc/nginx/sites-enabled/
nginx -t  # test config
systemctl restart nginx
```

### Step 8 — SSL with Let's Encrypt

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d gtm.yourdomain.com
```

Certbot auto-renews every 90 days. Verify:

```bash
certbot renew --dry-run
```

### Step 9 — Configure Firewall

```bash
ufw allow ssh
ufw allow http
ufw allow https
ufw enable
```

### Updating the App

```bash
cd /var/www/email-sender
git pull
bun install
pm2 restart gtm-email
```

Schema migrations run automatically on startup.

### Backup the Database

The app backs up `data/system.db` daily at 1am UTC to the `backups/` directory (keeps 7 copies). To manually copy backups off-server:

```bash
scp root@<server-ip>:/var/www/email-sender/backups/system.db.2026-05-24.bak ./
```

---

## Docker

Docker is the best option if you want to run the system alongside other services on the same machine.

### Dockerfile

Create `Dockerfile` in the project root:

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
```

### docker-compose.yml

```yaml
version: "3.8"

services:
  gtm-email:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
    volumes:
      - ./data:/app/data
      - ./backups:/app/backups
      - ./conversations:/app/conversations
    restart: unless-stopped
```

The volumes map the database, backups, and conversation files to the host so they persist across container rebuilds.

### Run It

```bash
docker compose up -d
docker compose logs -f
```

### Update

```bash
git pull
docker compose up -d --build
```

### With Nginx Reverse Proxy (Docker)

Add an Nginx service to `docker-compose.yml`:

```yaml
services:
  gtm-email:
    # ... same as above, but remove the ports mapping
    # ports:
    #   - "3000:3000"
    expose:
      - "3000"
    networks:
      - web

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./ssl:/etc/ssl/certs:ro
    depends_on:
      - gtm-email
    networks:
      - web
    restart: unless-stopped

networks:
  web:
```

---

## Post-Deployment Checklist

Run through this after every fresh deployment.

### Security
- [ ] Changed admin username and password from defaults (`admin` / `admin123`)
- [ ] HTTPS is working (browser shows padlock)
- [ ] App is not accessible on raw port 3000 from public internet (firewall configured)

### Configuration
- [ ] Notification email set in Settings
- [ ] Daily warmup summary enabled (if desired)

### Warmup
- [ ] At least one warmup account added and verified
- [ ] Warmup conversations generating (check Warmup Log after 30 minutes)
- [ ] Health Check page shows all green

### Campaign
- [ ] At least one sending account added
- [ ] SMTP verified (test by creating a draft campaign)
- [ ] DNS records checked for all sending domains (SPF, DKIM, DMARC)

### Data Safety
- [ ] Backups directory is writable (or volume mounted)
- [ ] First backup created (check Backups page after 1am UTC)
- [ ] If using Railway: Volume mounted at `/app/data`

---

## Resource Requirements

| Accounts | Leads | RAM | Storage |
|---|---|---|---|
| 1–5 | < 5,000 | 512 MB | 5 GB |
| 5–15 | < 25,000 | 1 GB | 10 GB |
| 15–30 | < 100,000 | 2 GB | 25 GB |

SQLite handles all workloads on a single server. There is no separate database process. The bottleneck is network I/O (SMTP/IMAP connections), not CPU or RAM.

---

## Troubleshooting Deployment

### App won't start

```bash
# Check for port conflicts
lsof -i :3000

# Check Bun version
bun --version  # needs 1.0+

# Check for missing dependencies
bun install
```

### Database locked error

Only one process can write to SQLite at a time. Make sure there is only one running instance:

```bash
pm2 list  # should show only one gtm-email process
```

### PM2 logs show IMAP errors on startup

Normal. The IMAP checker runs every 2 hours and logs failures if credentials haven't been added yet. Add warmup accounts and the errors stop.

### Railway: "Application failed to respond"

Check that the start command is exactly `bun run src/index.ts` and that `PORT=3000` is set. Railway routes traffic to the port your app listens on.
