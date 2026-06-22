# pos.akhairi.com — STATUS

**Live since:** 2026-06-20
**URL:** https://pos.akhairi.com
**Stack:** Cloudflare tunnel → Docker (Hono 4 + Next.js 16 + Postgres 18 + Redis 8)
**Repo:** github.com/dr298/Pos-Akhairi (SSH alias `github.com-pos`)
**Local path:** /home/dr298/projects/pos-akhairi-com
**Last commit:** see `git log -1 --format='%h %s'` (HEAD of `master`)

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

## All features (12 sprints, 0-11)

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
| **Light/Dark theme** | Tailwind v4 class-based, persist localStorage | Sun/moon toggle in navbar |
| **Menu click animation** | Scale 0.96 + radial ripple, 150ms | POS menu grid (`/pos`) |

---

## Architecture (TL;DR)

---

## Post-Sprint 9 changes (2026-06-21 → 2026-06-22)

A handful of refactors and features have been added since the Sprint 9 cutover. None of them change the public surface; they're all backward compatible.

### Sprint 10 — Delivery removal
3rd-party delivery aggregator UI (`/pos/delivery`, `/pos/channels`) removed.
Domain models (`Aggregator`, `AggregatorOrder`, `ChannelOrder`) and webhook
routes still exist in the schema and API but are no longer surfaced in
the UI. The aggregator integration code is wired but disabled (no
credentials configured). Re-enabling is a 1-line config change.

### Sprint "No-Branch" — Branch refactor
Removed the `branchId` column from 13 core tables and the `Branch` model
entirely. The deployment is now single-location (BKJ Bakmie Ciputat); the
branch scoping layer was overhead. Net change: −`branchId` everywhere,
simpler queries, simpler auth, no cross-branch ambiguity. Migration
applied; 42 tables, 21 enums remain. No data loss — existing rows had
branchId = null or a single shared value.

### Sprint 11 — UX polish
- **Light/Dark theme toggle** — sun/moon icon in navbar (top right, next
  to language switcher). Default: dark (preserves existing UX).
  Persistence: localStorage `pos:theme`. Implementation: Tailwind v4
  `@custom-variant dark` + CSS variables (`--background`,
  `--foreground`, `--card`, `--border`, `--primary`) + `useTheme` hook
  with no-flash inline script. 43 source files converted to use
  `dark:` variant pairs.
- **Menu click animation** — `MenuItemCard` now gives visual feedback on
  tap: scale to 0.96, red-50 tint flash, and a 500ms radial ripple from
  the click origin. Pure CSS animation, no deps. Animation is throttled
  by CSS `transform` (compositor-friendly) so it doesn't jank during
  fast-tap sequences.
- **Engineering page fix** — `/pos/menu/engineering` was failing to
  load due to a JSON-column type mismatch: API returned `itemsJson` /
  `totalsJson` (raw Prisma column names) but the web client expected
  `items` / `totals`. API normalized: list + detail endpoints now spread
  the JSON columns into properly-named `items` / `totals` keys, matching
  the type contract used by the create endpoint. Also added theme-aware
  quadrant colors (`bg-emerald-50` in light, `bg-emerald-900/20` in
  dark) so the BCG matrix is readable in both modes.

### Verified
- tsc apps/web = 0 errors
- 9/9 E2E tests pass (real-browser, theme, full-verify, sprint-11)
- Visual screenshots of all 9 main pages in both themes confirm correct
  rendering

---

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
4. **Old Stocky containers were removed** in Sprint "No-Branch". The legacy
   data path (`/home/dr298/apps/pos_akhairi/`) is gone. Active data
   resides in the `pos-postgres` container only. If you need historical
   Stocky data, restore from a pre-refactor backup (see
   `docs/sprint-7/DR-RUNBOOK.md`).

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
