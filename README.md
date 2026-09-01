# Makhana Lead Engine

A lead generation and CRM system for a makhana (fox nut) wholesale and
white-label manufacturing business in India. It finds potential B2B buyers,
scores them, tracks them through a sales funnel, and generates the outreach
documents that move a deal along.

This is **one business's internal tool**, not a multi-tenant SaaS. There are no
organizations, workspaces or tenants — and there shouldn't be. It is built to
run on a single Oracle Cloud "Always Free" ARM VM at close to zero rupees a
month.

> **The scraper only works from an Indian IP.** IndiaMART redirects non-Indian
> traffic to a host that returns 403. Deploy in Hyderabad or Mumbai. See
> [services/scraper/README.md](services/scraper/README.md) — this is the single
> most likely reason for a deployment that "runs fine" and finds zero leads.

## Modules

| Path | Package | What it does |
| --- | --- | --- |
| `packages/shared` | `@lead/shared` | Enums, zod schemas, DTO types, the dedupe key. Shared by every other module including the browser. |
| `packages/db` | `@lead/db` | Prisma schema, migrations, seed data, money helpers. |
| `services/api` | `@lead/api` | REST API, scoring engine, auth, funnel logic. The only thing that writes leads. |
| `services/scraper` | `@lead/scraper` | Throttled Puppeteer collection from IndiaMART, Justdial, TradeIndia. |
| `services/docgen` | `@lead/docgen` | Quotation (.docx) and presentation (.pptx) generation. |
| `services/outreach` | `@lead/outreach` | Email/WhatsApp sending behind a provider interface. |
| `apps/web` | `@lead/web` | The CRM dashboard. |

## Deploying to production

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the full runbook — Oracle Cloud VM,
automatic HTTPS via Caddy, backups, and the region requirement that cannot be
changed after signup.

## Quick start

```bash
cp .env.example .env
# Edit .env — at minimum set POSTGRES_PASSWORD, SESSION_SECRET,
# INTERNAL_API_TOKEN, ADMIN_EMAIL and ADMIN_PASSWORD.
#   openssl rand -hex 32   # for the two secrets

docker compose up
```

Then seed the admin account and business configuration:

```bash
pnpm db:seed
```

The web app is on <http://localhost:5173>, the API on <http://localhost:4000>.

### Running without Docker

You need Node 22+, pnpm 10+, a Postgres 16 database and a Redis instance.
Point `DATABASE_URL` and `REDIS_URL` in `.env` at them (use `localhost`, not
`postgres`/`redis` — those hostnames only resolve inside Compose), then:

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm --filter @lead/api dev
pnpm --filter @lead/web dev
```

## Design decisions worth knowing

**Scores are computed server-side, always.** `Lead.score` is written only by the
API's scoring engine. The API ignores a `score` field submitted by any client,
so a stale frontend cannot corrupt the data. The frontend displays scores; it
never calculates them.

**Stage changes go through a dedicated endpoint**, not the generic update route,
so every move can be validated and recorded on the interaction timeline.

**Every scrape writes a `ScraperRun` row** — including the ones that fail. A run
that silently finds nothing is the most likely production bug in a system like
this, and it needs to leave evidence.

**Money is `Decimal` in the database and `number` on the wire.** Prisma's
`Decimal` serialises to an object, not a number, which quietly breaks
arithmetic in the browser. `packages/db/src/decimal.ts` has the conversions;
use them at every boundary.

**No proxies, no paid scraping APIs.** The scraper self-throttles instead
(randomised delays, batch pauses, a hard request cap). This is a deliberate
cost constraint, not an oversight — please don't "fix" it by adding a proxy
dependency.

## Testing

```bash
pnpm test          # every package
pnpm lint
pnpm typecheck
```

**The API integration suite `TRUNCATE`s every table**, so it runs against a
separate database. The vitest config derives a `<name>_test` sibling of
`DATABASE_URL` (override with `TEST_DATABASE_URL`), and the reset helper refuses
outright unless the database name contains "test". Create it once:

```bash
createdb -O lead lead_engine_test
DATABASE_URL=postgresql://lead:...@localhost:5432/lead_engine_test pnpm db:migrate
```

| Package | Tests | Covers |
| --- | ---: | --- |
| `@lead/shared` | 18 | De-duplication key normalisation |
| `@lead/db` | 10 | Enum parity between the schema and shared |
| `@lead/api` | 174 | Scoring engine (band boundaries, every rule), lead API, catalogue |
| `@lead/scraper` | 55 | Throttle pacing and caps, IndiaMART parsing, geo detection |
| `@lead/docgen` | 41 | Money arithmetic, Indian numbering, storage path safety |
| `@lead/outreach` | 17 | Provider contract, WhatsApp stub behaviour |
| **Total** | **315** | |

## Commands

| Command | Effect |
| --- | --- |
| `pnpm dev` | `docker compose up` |
| `pnpm build` | Build every package and service |
| `pnpm typecheck` | Typecheck the whole workspace |
| `pnpm test` | Run all unit tests |
| `pnpm lint` | ESLint across the workspace |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Seed admin user + business config (idempotent) |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm --filter @lead/api seed:demo` | 10 sample leads, scored by the engine |
| `pnpm --filter @lead/api rescore` | Recompute scores after editing the rules |
| `pnpm --filter @lead/scraper check-geo` | Verify this host can reach IndiaMART |

## Licence

Private and unlicensed. All rights reserved.
