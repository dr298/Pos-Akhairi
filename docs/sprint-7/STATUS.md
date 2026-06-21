# pos.akhairi.com — STATUS

**Live since:** 2026-06-20
**URL:** https://pos.akhairi.com
**Stack:** Cloudflare tunnel → Docker (Hono 4 + Next.js 16 + Postgres 18 + Redis 8)
**Repo:** github.com/dr298/Pos-Akhairi (SSH alias `github.com-pos`)
**Local path:** /home/dr298/projects/pos-akhairi-com
**Last commit:** 309fe55

---

## Quick links

| Resource | Where |
|----------|-------|
| Production site | https://pos.akhairi.com |
| API health | https://pos.akhairi.com/api/ready |
| API metrics | https://pos.akhairi.com/api/metrics |
| API docs | `docs/sprint-7/API.md` (in repo) |
| Admin guide | `docs/sprint-7/ADMIN-GUIDE.md` |
| Cashier guide | `docs/sprint-7/CASHIER-GUIDE.md` |
| Observability | `docs/sprint-7/OBSERVABILITY.md` |
| DR runbook | `docs/sprint-7/DR-RUNBOOK.md` |
| Grafana setup | `docs/sprint-7/GRAFANA-SETUP.md` |
| Staff runbook | `docs/sprint-7/RUNBOOK.md` (this wrap) |

---

## Login (test users)

| Role | Email | Password |
|------|-------|----------|
| Owner | owner@bkj.id | password123 |
| Manager | manager@bkj.id | password123 |
| Cashier | cashier@bkj.id | password123 |

(3 test users, single location)

---

## All features (10 sprints, 0-9+)

| # | Feature | Where |
|---|---------|-------|
| Login + auth | JWT cookie, role-based, 2FA-ready | /login |
| Menu management | CRUD, categories, modifiers, recipes, cost | /pos/menu |
| Order entry | Dine-in/takeaway/delivery, modifiers | /pos |
| Payments | Cash, QRIS (Midtrans+Xendit), split | /pos/orders/[id] |
| Customer display | 2nd screen via WS | /display |
| Delivery aggregators | GoFood, GrabFood, ShopeeFood | /pos/delivery, /pos/channels |
| Z-report + daily close | End-of-day reconciliation | /pos/shift |
| **Combo/set meals** | Server-side resolution, /pos/menu/combos | /pos/menu/combos |
| **Promo engine** | 4 types, 9 conditions | /pos/promos |
| **Customer/loyalty** | Points, tier, phone/email | /pos/customers |
| **Digital receipt** | WA + Email auto-dispatch | /pos/orders/[id]/receipt |
| **Cash drawer** | ESC/POS, multi-transport | /pos/settings/hardware |
| **Barcode scanner** | Web Bluetooth + keyboard wedge | /pos (Pindai barcode) |
| **Self-order kiosk** | 30-min TTL, public | /kiosk |
| **Reservation** | 30-min slots | /pos/reservations |
| **Waiter handheld** | Mobile-first, table transfer | /pos/waiter |
| **Menu engineering** | BCG 2x2 (Bintang/Kuda/Teka-teki/Anjing) | /pos/menu/engineering |
| **Supplier/PO** | DRAFT→SENT→PARTIAL→RECEIVED→CANCELLED | /pos/suppliers, /pos/purchase-orders |
| **Prep sheet** | DOW-aware, print-friendly | /pos/prep-sheets |
| **Accounting export** | JURNAL/ACCURATE/MEKARI/GENERIC CSV | /pos/accounting-export |
| **Multi-language** | ID/EN, cookie-persisted | Header switcher (ID/EN) |
| **Waste tracking** | FOOD/INGREDIENT/PACKAGING, auto cost | /pos/waste |
| **Observability** | Pino logs, X-Request-Id, self-hosted errors | /api/metrics, /api/ready |
| **Backups** | Daily 03:00 UTC, 30-day retention | /root/archives/pos-akhairi-backups/ |

---

## Architecture (TL;DR)

```
Browser → Cloudflare → Caddy (in stack) → Hono 4 API (8787) + Next.js 16 (3000)
                                    └→ Postgres 18 + Redis 8 (internal docker network)
```

WebSocket: wss://pos.akhairi.com/ws (tunnel path, handled by Hono).

---

## Known limitations

1. **WA / SMTP not configured.** Receipt delivery is wired but `WHATSAPP not configured` / `SMTP not configured` rows will appear until env vars set. Set in `apps/api/.env`:
   ```
   WHATSAPP_API_URL=https://api.wagateway.com
   WHATSAPP_API_KEY=...
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=...
   SMTP_PASS=...
   ```
2. **3 aggregator channels (GoFood/GrabFood/ShopeeFood)** wired but credentials not configured. To enable: /pos/channels → Add channel.
3. **Grafana not deployed** (optional). Setup doc at `docs/sprint-7/GRAFANA-SETUP.md`. Self-monitoring via /api/ready is in place.
4. **Old Stocky containers still running** at `/home/dr298/apps/pos_akhairi/` (data preserved 30 days, then archive). See `docs/sprint-7/DR-RUNBOOK.md` for the legacy data path.

---

## Containers

| Container | Purpose | Port (internal) |
|-----------|---------|-----------------|
| pos-api | Hono 4 API + WebSocket | 8787 |
| pos-web | Next.js 16 | 3000 |
| pos-postgres | Postgres 18 | 5432 |
| pos-redis | Redis 8 (cache + pub/sub) | 6379 |
| pos-caddy | Reverse proxy | 80/443 (host) |

Manage: `cd /home/dr298/projects/pos-akhairi-com && docker compose {up -d,stop,restart,logs}`

---

## Backups

- **Schedule:** daily 03:00 UTC via cron (`/root/.hermes/scripts/backup-pos-akhairi.sh`)
- **Retention:** 30 days
- **Location:** `/root/archives/pos-akhairi-backups/pos-akhairi-YYYYMMDD-HHMMSS.dump.gz`
- **Format:** PostgreSQL custom format + gzip (recover with `pg_restore -d pos_akhairi <file>`)
- **Restore:** see `docs/sprint-7/DR-RUNBOOK.md`
- **Baseline captured:** `pos-akhairi-post-sprint9plus-baseline-2026-06-20.dump` (296 TOC entries, 123KB, restorable)
- **Latest verified:** 2026-06-20

---

## Monitoring

```bash
# Health (auth-free)
curl https://pos.akhairi.com/api/ready

# Metrics (Prometheus format, no auth — restrict via firewall if exposed)
curl https://pos.akhairi.com/api/metrics

# Container logs
docker logs --tail 200 -f pos-api
```

The `/api/ready` endpoint probes Postgres + Redis. If either is down, returns 503.

---

## Contacts

- **Owner:** Harry (owner@bkj.id)
- **Repos:** github.com/dr298/Pos-Akhairi (code), github.com/dr298/Friday-Obsidian (notes)
- **Telegram ops:** chat_id 444168489 (Friday agent → user)
