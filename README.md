# pos.akhairi.com — Bakmie resto POS

Sprint 0 monorepo scaffold for Bakmie Khas Jaksel (BKJ) Pasar Lama Tangerang.

## Stack

- **Backend:** Hono 4.12.26 on Node.js 22, TypeScript 5.7+, ESM, pino logging
- **Frontend:** Next.js 16.2.9 (App Router), Tailwind v4, shadcn/ui, TypeScript 5.7+
- **Database:** PostgreSQL 18 + Prisma 7.8
- **Cache/Queue:** Redis 7
- **Auth:** Custom email/password — bcrypt + @hono/jwt + HTTP-only cookie
- **Container:** Docker + docker-compose, multi-stage builds

## Layout

```
.
├── apps/
│   ├── api/          # Hono backend (port 8787)
│   └── web/          # Next.js frontend (port 3000)
├── packages/
│   └── db/           # Prisma schema, migrations, seed
├── docker-compose.yml
├── Dockerfile.api
├── Dockerfile.web
└── .github/workflows/ci.yml
```

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up -d --build
```

Wait ~30s for postgres + migrations, then verify:

```bash
curl -i http://localhost:8787/api/health
curl -i http://localhost:8787/api/ready
curl -I http://localhost:3000
```

## Seeded data

- **Branch:** BKJ Pasar Lama (Tangerang)
- **Users:** `owner@bkj.id`, `manager@bkj.id`, `cashier@bkj.id` (password: `password123`)
- **Menus:** 10 bakmie items (ayam, babi, special, pangsit, dll)

## Local dev (without Docker)

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

## Pilot context

- Owner: Harry (`dr298`)
- Currency: IDR, PPN 11%, QRIS-ready
- Custom email/password only — no SSO

# retrigger deploy
