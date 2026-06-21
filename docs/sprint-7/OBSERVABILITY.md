# Observability — pos.akhairi.com

Sprint 7.1 / 7.2 / 7.3 / 7.5. Everything you need to debug + monitor.

---

## TL;DR

| What | Where | Format | Cost |
|------|-------|--------|------|
| Request logs | `docker logs pos-api` | Pino structured JSON | 0 |
| Request ID | `X-Request-Id` header | UUID per request | 0 |
| Health | `GET /api/health` | JSON, always-on | 0 |
| Readiness | `GET /api/ready` | JSON, probes DB | 0 |
| Metrics | `GET /api/metrics` | Prometheus text | 0 |
| Errors | `GET /api/errors` (OWNER) | DB query, structured | 0 |
| Telegram | events | bot push | 0 |

No third-party (Sentry, Datadog, etc). All self-hosted.

---

## Logging (Pino)

Every request emits:
```json
{
  "level": 30,
  "time": 1718890000000,
  "pid": 1,
  "hostname": "pos-api",
  "service": "pos-api",
  "requestId": "b21fff3f-f037-467b-b074-1df3aba7dac5",
  "route": "POST /api/orders",
  "method": "POST",
  "msg": "request.end",
  "status": 200,
  "durationMs": "42.1"
}
```

Errors include:
```json
{
  "level": 50,
  "msg": "error captured",
  "requestId": "...",
  "route": "POST /api/orders",
  "statusCode": 500,
  "severity": "ERROR",
  "err": "...",
  "stack": "..."
}
```

### Grep tips
- All logs for a request: `docker logs pos-api | grep b21fff3f`
- All errors: `docker logs pos-api | grep '"level":50'`
- All /api/orders: `docker logs pos-api | grep '/api/orders'`

### Production logs
In production, logs are raw JSON (no `pino-pretty`). Pipe to a log aggregator
(e.g. Vector, Loki) or `jq` for readability:
```bash
docker logs pos-api | jq -r '"\(.time) [\(.level)] \(.msg) \(.requestId // "-")"'
```

---

## Request ID

Every response includes `X-Request-Id`. To trace:
1. User reports issue with order #12345
2. Search logs: `docker logs pos-api | grep orderNumber\":12345`
3. Find requestId
4. Grep all logs: `docker logs pos-api | grep <requestId>`
5. See full lifecycle: login → create order → payment → WS broadcasts

The X-Request-Id is also stored in `error_events.request_id` for cross-ref.

---

## Health checks

### `/api/health` (liveness)
Always returns 200 unless process is dead. Used by Docker `HEALTHCHECK`.

### `/api/ready` (readiness)
Returns:
```json
{
  "status": "ready",
  "checks": {
    "db": { "ok": true, "ms": 2 }
  },
  "uptimeSec": 12345
}
```
Returns 503 if DB is down or times out (>2s). Used by load balancers/orchestrators.

### `/api/live`
Cheap. Just returns timestamp.

---

## Error tracking (Sprint 7.2)

Self-hosted Sentry alternative. Captures unhandled errors via `onError` handler.

### Schema
```sql
CREATE TABLE error_events (
  id text PRIMARY KEY,
  severity text DEFAULT 'ERROR',  -- ERROR | WARN | FATAL
  source text DEFAULT 'API',  -- API | WORKER | WEBHOOK
  request_id text,
  route text,
  method text,
  status_code int,
  user_id text,
  branch_id text,
  message text,
  stack text,
  context jsonb,
  created_at timestamp DEFAULT now()
);
```

### View errors
```
GET /api/errors?severity=ERROR&limit=50
GET /api/errors/stats
```

`stats` returns 24h + 7d counts and severity breakdown.

### Sanitization
The `context` field has secrets auto-redacted:
- Keys matching `/password|token|secret|api[-_]?key|authorization|cookie/i` → `[REDACTED]`
- String values > 1000 chars truncated

---

## Metrics (Sprint 7.5)

Prometheus text format at `GET /api/metrics`. Public (no auth) for scraping.

### Exposed metrics

#### HTTP
- `http_requests_total{method,route,status}` — counter
- `http_request_duration_seconds{method,route,status}` — histogram

#### Business KPIs
- `pos_orders_created_total{type}` — counter
- `pos_order_subtotal_cents` — histogram (order size distribution)
- `pos_payments_completed_total{method}` — counter
- `pos_payment_latency_ms` — histogram (order open → paid time)

### Cardinality notes
- `route` uses the path pattern (e.g. `/api/orders/:id`), not actual IDs
  → bounded cardinality
- `method` is low-cardinality (4 methods)

### Usage
Scrape with Prometheus (see GRAFANA-SETUP.md) or `curl` ad-hoc:
```bash
curl -sS https://pos.akhairi.com/api/metrics | grep pos_orders
```

---

## Alerting strategy

For BKJ Tangerang scale, we use Telegram notifications on critical events
rather than a full PagerDuty stack.

### Events that notify
- DB backup failure (daily 03:00)
- API process crash (Docker restart)
- Unhandled error in payment flow (severity FATAL)

### Where to add more
Edit `apps/api/src/services/error-tracker.ts` to send Telegram on
specific severities. Hook into `onError` handler in `index.ts`.

---

## Debugging playbook

### "Order won't pay"
1. Get the order ID from the cashier
2. `docker logs pos-api | grep <orderId>` — find the failed request
3. Check `error_events` table: `SELECT * FROM error_events WHERE context->>'orderId' = '<id>';`
4. Common causes:
   - Inventory insufficient (check `inventory_items.stock` for items)
   - Shift not open (check `shifts.status` for the cashier)
   - User attempted to act outside their role

### "Menu items not showing"
1. Check the user role: `GET /api/auth/me` — see `role`
2. `SELECT count(*) FROM menu_items WHERE is_active = true;`
3. If 0: menu not seeded → re-run `npm run db:seed -w @pos/db`

### "Channel orders stuck in PENDING"
1. Check `channel_configs.enabled` for the channel
2. Check `channel_poller` logs: `docker logs pos-api | grep channel-poller`
3. Test connection: `POST /api/channels/gofood/test`
4. Manual poll: `POST /api/channels/gofood/poll`
5. If creds bad → re-enter via `/pos/channels`

### "Daily backup didn't run"
1. Check crontab: `crontab -l | grep backup-pos-akhairi`
2. Check log: `tail -50 /var/log/pos-akhairi-backup.log`
3. Manual run: `/root/.hermes/scripts/backup-pos-akhairi.sh`

---

## What's NOT in observability (and why)

| Missing | Reason |
|---------|--------|
| Distributed tracing | Single service. Add if multi-service (microservices). |
| APM (auto-instrumentation) | Pino + metrics is enough for current scale. |
| Long-term log storage | Logs are 7-day rolling via Docker. Add Loki when retention needed. |
| Synthetic monitoring | Out of scope — owner verifies manually. |
| Status page | Out of scope — Telegram is the channel. |
