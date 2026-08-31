# `@lead/api` — REST API and scoring engine

The only service that writes leads. Everything else — the scraper, the CSV
importer, the frontend — goes through these endpoints, which is what keeps lead
scoring consistent.

## Running

```bash
# From the repo root, with Postgres and Redis up:
pnpm --filter @lead/api dev     # tsx watch on http://localhost:4000
pnpm --filter @lead/api test    # unit + integration tests
```

Requires `DATABASE_URL`, `SESSION_SECRET`, `INTERNAL_API_TOKEN` (see
`.env.example`). The server checks the database before opening the port, so a
bad `DATABASE_URL` fails loudly at boot rather than 500-ing every request.

## The scoring engine

Lives in `src/scoring/`. **This is the single source of truth for `Lead.score`.**
The frontend displays scores; it never computes them. The shared zod schemas do
not accept a `score` field, and the create/update paths overwrite it regardless
— a client that submits `score: "high"` gets whatever the engine says.

The model is additive and bounded at 100 so a score is explainable to a human:

| Signal | Max | What it measures |
| --- | ---: | --- |
| `category` | 50 | Keyword-matched business type (`rules.ts`) |
| `regionTier` | 25 | 1 = metro, 2 = large city, 3 = smaller town |
| `website` | 15 | Established enough to warrant a formal quotation |
| `contactable` | 10 | Has a phone, email or website — otherwise unactionable |

Bands: **high ≥ 70**, **medium ≥ 45**, **low** below that.

`GET /leads/:id/score` returns the full breakdown plus a `stale` flag, so the UI
can show *why* a lead scored what it did without reimplementing any of it.

### Changing the rules

Edit `src/scoring/rules.ts`, then **run `pnpm --filter @lead/api rescore`**.
Without it, existing leads keep the band they were given under the old rules and
the table becomes a silent mix of two schemes.

Two things about `CATEGORY_RULES` that are easy to get wrong:

1. **Order is specificity, not point value.** First match wins, so a rule must
   sit above any broader rule that would also match its listings. Point values
   are deliberately not in descending order.
2. **Patterns are matched against normalised text**, where punctuation has
   already become spaces. A pattern containing a literal `-` or `&` can look
   correct and match nothing. A test asserts no pattern does this.

Every rule carries `examples` of real directory-listing text. The test suite
asserts each example routes to its own rule — that is what catches a new rule
stealing listings from an existing one.

## Endpoints

### Auth
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/login` | Rate limited to 10 per 5 min |
| POST | `/auth/logout` | |
| GET | `/auth/me` | |
| POST | `/auth/change-password` | Invalidates all sessions |

### Leads
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/leads` | Filter, search, sort, paginate |
| POST | `/leads` | 409 on duplicate name+city |
| GET | `/leads/:id` | Includes timeline, documents, campaign |
| PATCH | `/leads/:id` | Rescores if a scored field changed |
| DELETE | `/leads/:id` | Cascades interactions and documents |
| POST | `/leads/:id/stage` | Logs the move to the timeline |
| GET | `/leads/:id/score` | Score breakdown + staleness |
| GET/POST | `/leads/:id/interactions` | |
| POST | `/leads/import` | CSV, `?dryRun=true` supported |

### Catalogue
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/catalogue/products` | `?includeInactive=true`, `?q=` |
| POST | `/catalogue/products` | With an optional price ladder |
| PATCH | `/catalogue/products/:id` | |
| DELETE | `/catalogue/products/:id` | Soft by default; `?hard=true` removes the row |
| POST | `/catalogue/products/:id/restore` | Undo a soft delete |
| POST | `/catalogue/products/:id/tiers` | Add one tier |
| PUT | `/catalogue/products/:id/tiers` | Replace the ladder |
| DELETE | `/catalogue/products/:id/tiers/:tierId` | |
| GET/PATCH | `/config/business` | Business profile used by docgen |

Price tiers are validated as a ladder: no overlaps, no gaps mid-ladder, at most
one open-ended top tier. An ambiguous ladder would let a quotation be priced
from whichever row the database returned first.

Deleting is soft by default (`active = false`) so the listing stops appearing on
new quotations but the row survives. Hard delete is offered too and is safe,
because each generated document snapshots its own line items in `Document.meta`
— past quotations do not read prices back out of this table.

### Campaigns, scraper runs, stats
| Method | Path | Notes |
| --- | --- | --- |
| GET/POST/PATCH/DELETE | `/campaigns` | With per-campaign roll-ups |
| GET | `/scraper-runs` | Audit history |
| POST | `/scraper-runs` | Creates the audit row, then enqueues |
| GET | `/scraper-runs/schedule` | Whether automatic scraping is on |
| GET | `/stats/dashboard` | Funnel, source performance, pipeline, revenue |
| GET | `/health` | Unauthenticated; reports database reachability |

## Authentication

Opaque session id in an httpOnly, signed, `SameSite=Lax` cookie, backed by a
`Session` row — revocable instantly, which is the property that matters for an
internal tool. Passwords are Argon2id.

Service-to-service calls (the scraper posting leads) use an `x-internal-token`
header compared in constant time. That path never creates a session and cannot
change a password.

## Testing

`pnpm --filter @lead/api test` runs both suites:

- **`src/scoring/engine.test.ts`** — pure unit tests, no database. Covers every
  band boundary at the threshold and either side, every category rule via its
  examples, every region tier, and the arithmetic invariants.
- **`src/routes/*.test.ts`** — integration tests against a real Postgres.
  Mocking Prisma would skip exactly the things most likely to break: the unique
  index behind de-duplication, enum constraints, and Decimal handling.

> **The integration suite `TRUNCATE`s every table.** `resetDatabase()` refuses to
> run unless `NODE_ENV=test`, and the vitest config sets that itself — but point
> `DATABASE_URL` at a throwaway database anyway.

## Scripts

| Command | Effect |
| --- | --- |
| `pnpm --filter @lead/api seed:demo` | 10 sample leads, scored by the engine |
| `pnpm --filter @lead/api rescore` | Recompute every lead against current rules |
