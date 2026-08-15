# Deployment Guide

## Server

| | |
|---|---|
| Provider | Oracle Cloud (Always Free) |
| Host | `140.245.47.60` |
| User | `ubuntu` |
| SSH key | `C:\Users\My PC\.ssh\id_ed25519` |
| App dir | `~/torn-tracker/` |
| Repo | `https://github.com/ghericsantiago/torn-tracker-hosted` |

## Process Manager — PM2

Four processes run under PM2:

| ID | Name | What |
|----|------|------|
| 0 | `personal-site` | Personal site (port 3000) |
| 1 | `torn-tracker` | This app (port 3001) |
| 2 | `portfolio-sync` | Portfolio sync worker |
| 5 | `pgweb` | PostgreSQL web UI (port 8081) |

## Nginx Reverse Proxy

| Domain | Backend |
|--------|---------|
| `torn-imarket-tracker.gvsantiago.com` | `localhost:3001` (this app) |
| `pgweb.gvsantiago.com` | `localhost:8081` (pgweb, password-protected) |
| `gvsantiago.com` | `localhost:3000` (personal site) |

## Standard Deploy

```bash
ssh -i "C:\Users\My PC\.ssh\id_ed25519" ubuntu@140.245.47.60 "cd torn-tracker && git pull && pm2 restart torn-tracker --update-env"
```

Or step by step on the server:

```bash
cd torn-tracker
git pull
pm2 restart torn-tracker --update-env
pm2 logs torn-tracker --lines 20 --nostream   # verify startup
```

## Sync .env to Server

```bash
scp -i "C:\Users\My PC\.ssh\id_ed25519" .env ubuntu@140.245.47.60:~/torn-tracker/.env
# then restart to pick up changes:
ssh -i "C:\Users\My PC\.ssh\id_ed25519" ubuntu@140.245.47.60 "pm2 restart torn-tracker --update-env"
```

## Reset Inventory Monitor DB

Wipes all inventory-monitor tables so the next poll starts fresh from `MONITOR_START` in `.env`.

```bash
ssh -i "C:\Users\My PC\.ssh\id_ed25519" ubuntu@140.245.47.60 \
  "pm2 stop torn-tracker && cd torn-tracker && npm run reset-db && pm2 start torn-tracker"
```

**Warning:** This truncates all tracked inventory data. Stop the server first — a running server will repopulate from memory on the next poll.

## Key URLs

| URL | What |
|-----|------|
| `https://torn-imarket-tracker.gvsantiago.com/admin` | Admin login |
| `https://torn-imarket-tracker.gvsantiago.com/admin/dashboard` | Admin dashboard |
| `https://torn-imarket-tracker.gvsantiago.com/admin/inventory` | Inventory monitor (requires login) |
| `https://pgweb.gvsantiago.com` | PostgreSQL web UI |

## Environment Variables (.env)

Key variables the app reads:

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3001) |
| `DB_HOST / DB_NAME / DB_USER / DB_PASS` | PostgreSQL credentials |
| `ADMIN_USER / ADMIN_PASS` | Admin panel login |
| `SESSION_SECRET` | Express session secret |
| `TORN_API_KEY` | Torn API key |
| `MONITOR_START` | Inventory monitor start timestamp (ISO 8601) |
| `POLL_INTERVAL` | Inventory poll interval in ms (default 60000) |

## PostgreSQL

- Database: `torn_tracker` (main app) / `torn_tracker_v2` (inventory monitor)
- The inventory monitor schema is auto-applied at startup (`inventory-monitor/schema.sql`)
- Access via pgweb: `https://pgweb.gvsantiago.com`
