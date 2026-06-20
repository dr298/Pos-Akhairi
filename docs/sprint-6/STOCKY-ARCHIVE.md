# Stocky 5.5 Final Archive — 2026-06-20

## Contents
- `stocky-5.5-final-2026-06-20.sql.gz` — full mysqldump (875KB compressed)
  - MariaDB 10.5, single-transaction, with routines/triggers/events
  - 26 stocky tables (products, sales, purchases, accounts, etc.)
- `../stocky-5.5-csv/*.csv` — CSV extracts of key tables

## Why archived
- Production was empty (0 products, 0 sales) — this Stocky instance was
  evaluation/demo data only. Real production data lives in the new
  pos.akhairi.com Postgres (started fresh per Sprint 1 decision #4).
- Stocky 5.5 stopped after cutover to pos.akhairi.com 2026-06-20.

## Restore (if ever needed)
```bash
gunzip -c stocky-5.5-final-2026-06-20.sql.gz | mysql -u root -p pos_akhairi
```

## Volume preserved
- /home/dr298/apps/db_data/pos_akhairi/ (28MB) — kept for 30 days
- Old compose: /home/dr298/apps/pos_akhairi/ (source preserved)
- Containers stopped after this dump (per S6.4)
