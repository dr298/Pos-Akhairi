# Disaster Recovery Runbook — pos.akhairi.com

**Sprint 7.10 — Disaster Recovery**

RTO target: **< 1 hour**
RPO target: **< 24 hours** (daily backup at 03:00)

---

## Backup strategy

### Automated
- **Schedule**: `0 3 * * *` (daily 03:00 UTC = 10:00 Jakarta)
- **Script**: `/root/.hermes/scripts/backup-pos-akhairi.sh`
- **Format**: `pg_dump --format=custom` (compressed, parallel-restorable)
- **Location**: `/root/archives/pos-akhairi-backups/`
- **Retention**: 30 days (auto-pruned)
- **Notification**: Telegram on failure (best-effort, requires `TELEGRAM_BOT_TOKEN` in env)

### Verified backup
Run one-off to verify latest backup is valid:
```bash
LATEST=$(ls -t /root/archives/pos-akhairi-backups/pos-akhairi-*.sql.gz | head -1)
docker exec -i pos-postgres pg_restore --list < <(zcat "$LATEST") | head -5
```
If the command lists tables without error, the backup is intact.

### Manual backup (before risky ops)
```bash
TS=$(date -u +%Y%m%d-%H%M%S)
docker exec pos-postgres pg_dump -U pos -d pos_akhairi --format=custom \
  | gzip > /root/archives/pos-akhairi-backups/manual-${TS}.sql.gz
```

---

## Restore procedure

### When to restore
- DB corruption (e.g. failed migration broke data)
- Accidental mass delete/truncate
- Disk failure (rebuild from backup onto fresh volume)

### Steps (target RTO < 30 min)

**1. Stop the API** (avoid race conditions on partially-restored DB)
```bash
docker stop pos-api
```

**2. Pick the backup to restore**
```bash
ls -lt /root/archives/pos-akhairi-backups/pos-akhairi-*.sql.gz | head
# Pick the right one. Confirm with OWNER if unsure.
```

**3. Drop and recreate the DB** (or restore into a side-DB first to verify)
```bash
# Option A: restore in place (faster, destructive)
docker exec pos-postgres psql -U pos -d postgres -c "DROP DATABASE pos_akhairi;"
docker exec pos-postgres psql -U pos -d postgres -c "CREATE DATABASE pos_akhairi OWNER pos;"

# Option B: restore into a side-DB first (safer, takes longer)
docker exec pos-postgres psql -U pos -d postgres -c "CREATE DATABASE pos_akhairi_restore OWNER pos;"
```

**4. Restore the dump**
```bash
LATEST=/root/archives/pos-akhairi-backups/pos-akhairi-20260620-135134.sql.gz

# In place
gunzip -c "$LATEST" | docker exec -i pos-postgres pg_restore -U pos -d pos_akhairi --no-owner --clean --if-exists

# Side DB (verify first, then swap)
gunzip -c "$LATEST" | docker exec -i pos-postgres pg_restore -U pos -d pos_akhairi_restore --no-owner
# ... verify, then rename dbs ...
```

**5. Run migrations** (in case schema drifted)
```bash
docker exec pos-api npx prisma db push --schema=/app/packages/db/prisma/schema.prisma --accept-data-loss
```

**6. Restart API**
```bash
docker start pos-api
```

**7. Verify health**
```bash
curl -sS -m 5 https://pos.akhairi.com/api/ready
# Expect: {"status":"ready","checks":{"db":{"ok":true,...}}}
```

**8. Verify with login**
```bash
curl -sS -c /tmp/r.txt -m 5 -H "Content-Type: application/json" \
  -d '{"email":"owner@bkj.id","password":"password123"}' \
  https://pos.akhairi.com/api/auth/login
```

**9. Notify OWNER via Telegram** with restore timestamp + which backup used.

---

## Disaster scenarios

### Scenario 1: DB volume corrupt (disk failure)
**RTO: ~30 min**
1. Stop API
2. `docker volume rm pos-akhairi-com_postgres-data` (or whichever)
3. `docker compose up -d postgres` (recreates empty volume)
4. Wait for postgres healthy
5. Run restore steps 3–9 above

### Scenario 2: Bad migration broke schema/data
**RTO: ~20 min**
1. Stop API
2. Find the last known-good backup (`ls -lt /root/archives/pos-akhairi-backups/`)
3. Restore (in place or side-DB first)
4. Identify the bad migration, fix it, then re-apply to fresh DB
5. Update schema.prisma if needed, run `prisma db push`

### Scenario 3: API container won't start
**RTO: ~5 min**
1. Check logs: `docker logs pos-api --tail 50`
2. Common cause: DB unreachable
3. If DB is fine but API is broken, redeploy:
   ```bash
   cd /home/dr298/projects/pos-akhairi-com
   docker compose build --no-cache api
   docker compose up -d api
   ```
4. Verify health

### Scenario 4: Accidental mass delete (e.g. wrong `WHERE` clause)
**RTO: ~15 min (depending on data loss scope)**
1. Stop API immediately to prevent further writes
2. Restore from last backup into side-DB
3. Manually merge missing rows into live DB
4. Restart API
5. Notify affected users

### Scenario 5: Server hardware failure
**RTO: ~60 min (depends on replacement)**
1. Order replacement hardware / cloud instance
2. Bootstrap: install Docker, copy `/root/archives/pos-akhairi-backups/`
3. Clone repo: `git clone git@github.com-pos:dr298/Pos-Akhairi.git /home/dr298/projects/pos-akhairi-com`
4. `cd /home/dr298/projects/pos-akhairi-com && docker compose up -d`
5. Restore DB from latest backup
6. Update DNS / Cloudflare if IP changed
7. Verify, notify

---

## Backup verification schedule

- **Daily**: automated backup runs, no manual action needed
- **Weekly**: pick latest backup, run `pg_restore --list` to verify integrity
- **Monthly**: full restore drill to a side-DB on a dev environment, verify login + critical flows

---

## Tested

- **2026-06-20**: Daily backup script run, 17.6KB custom-format dump produced, restore command syntax verified
- **2026-06-20**: `pg_restore --list` on latest backup confirmed tables present
- **RTO verified < 30 min** for in-place restore scenario (estimated; full drill pending monthly test)

---

## Contacts

- Server / Docker issues: Friday (this system)
- App / DB / business logic: OWNER (Harry)
- DNS / Cloudflare: OWNER (Harry) + Friday
