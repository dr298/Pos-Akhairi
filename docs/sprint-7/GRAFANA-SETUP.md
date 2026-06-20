# Grafana / Prometheus Setup

Sprint 7.6 — Optional. The metrics endpoint is live and the system is
self-monitoring. This doc covers how to add a Prometheus scraper + Grafana
visualization on top of `/api/metrics`.

**Not deployed** — the metrics endpoint is ready; this is a guide for when
the OWNER wants time-series dashboards.

---

## Why optional

The system already has:
- `/api/health` (always-on, uptime)
- `/api/ready` (deep DB probe)
- `/api/metrics` (Prometheus format, all KPIs)
- Pino structured logs (with request IDs for grep)
- Self-hosted error tracker (`/api/errors`)
- Telegram notifications for critical events

A full Grafana stack adds value when:
- You want long-term trend graphs (not just "today's report")
- You need alerting on metric thresholds (e.g. "alert if no orders for 30 min")
- You're debugging performance regressions over weeks

For BKJ Tangerang scale (1-2 outlets, ~200 orders/day), a Prometheus+Grafana
stack is overkill. The built-in Z-report and Chain dashboard cover 95% of
operational needs.

---

## Minimal Prometheus + Grafana setup

### Option A: Same Docker host (recommended for single-server)

Create `docker-compose.observability.yml`:
```yaml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus:latest
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus

  grafana:
    image: grafana/grafana:latest
    restart: unless-stopped
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
    volumes:
      - grafana-data:/var/lib/grafana

volumes:
  prometheus-data:
  grafana-data:
```

Create `prometheus.yml`:
```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'pos-api'
    scheme: https
    static_configs:
      - targets: ['pos.akhairi.com']
    metrics_path: /api/metrics
```

Boot:
```bash
docker compose -f docker-compose.observability.yml up -d
```

### Option B: Cloud (managed)

Use Grafana Cloud free tier or Better Stack. Point scrape to:
`https://pos.akhairi.com/api/metrics`

---

## Grafana dashboard starter

Import the dashboard ID `18419` (basic Node.js metrics) as a base, then add:

### Panel 1: Orders per hour
Query: `sum by (branchId) (rate(pos_orders_created_total[1h]))`

### Panel 2: P95 payment latency
Query: `histogram_quantile(0.95, sum by (le, method) (rate(pos_payment_latency_ms_bucket[5m])))`

### Panel 3: Active HTTP requests
Query: `sum(rate(http_requests_total[1m])) by (route)`

### Panel 4: Error rate
Query: `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))`

### Panel 5: Top routes by traffic
Query: `topk(10, sum by (route) (rate(http_requests_total[5m])))`

### Panel 6: Branch revenue (last 24h)
Query: `sum by (branchId) (increase(pos_order_subtotal_cents_sum[24h])) / 100`

---

## Alerting

In Grafana, add alert rules:
- **No orders in 30 min during business hours**: `sum(rate(pos_orders_created_total[30m])) == 0` AND time is 09:00-22:00
- **High payment latency**: `histogram_quantile(0.95, ...) > 300000` (5 min)
- **Error rate > 5%**: `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05`
- **API down**: `up == 0`

Route alerts to Telegram via Grafana's Telegram contact point.

---

## Why not deployed yet

- BKJ has 1-2 outlets, 200 orders/day. Grafana adds operational overhead.
- Pino logs + Z-report + Chain dashboard cover current needs.
- Add when: scale hits 5+ outlets OR when time-series alerting becomes valuable.

Cost: zero (self-hosted on existing server). Time to set up: ~30 min.
