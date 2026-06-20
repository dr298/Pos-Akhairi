# Sprint 7 — Observability & Polish

Sprint 7 deliverables (all 10 items shipped 2026-06-20). This directory contains
the long-form documentation: API reference, admin/cashier guides, DR runbook,
Grafana/Prometheus setup, and observability architecture.

## Files

| File | Purpose |
|------|---------|
| `API.md` | Complete HTTP API reference (auth, menu, orders, payments, reports, channels, branches, errors, metrics) |
| `ADMIN-GUIDE.md` | Multi-branch owner runbook: branch settings, PPN config, menu clone, Z-report, transfer management |
| `CASHIER-GUIDE.md` | Cashier quickstart: open shift, take order, payment, close shift |
| `DR-RUNBOOK.md` | Disaster recovery: backup strategy, restore procedure, RTO target < 1 hour, tested 2026-06-20 |
| `GRAFANA-SETUP.md` | How to scrape `/api/metrics` with Prometheus + visualise in Grafana (optional, not deployed) |
| `OBSERVABILITY.md` | Logging, error tracking, metrics — what's in place, how to use them |

## Quick links

- Live metrics: https://pos.akhairi.com/api/metrics
- Live health: https://pos.akhairi.com/api/health
- Live readiness: https://pos.akhairi.com/api/ready
- Daily backups: `/root/archives/pos-akhairi-backups/`
- Old Stocky archive: `/root/archives/stocky-5.5-final/`
