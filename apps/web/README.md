# `@lead/web` — CRM dashboard

React + Vite + Tailwind, TanStack Query for data and TanStack Table for the
leads grid.

```bash
pnpm --filter @lead/web dev     # http://localhost:5173
pnpm --filter @lead/web build
```

## Pages

| Route | What it does |
| --- | --- |
| `/dashboard` | Funnel, source performance, score bands, pipeline and revenue |
| `/leads` | Filterable, sortable, searchable table |
| `/leads/:id` | Detail, score breakdown, stage changer, interaction timeline |
| `/campaigns` | Scrape run history and campaign returns |
| `/catalogue` | Products and price ladders used by quotations |

## Things worth knowing

**Scores are never computed here.** The lead form has no score field, and the
detail page's "Why this score" panel renders the breakdown returned by
`GET /leads/:id/score`. If the display and the database ever disagree, the
database is right.

**Filters live in the URL.** `/leads?score=high&stage=quoted` is a shareable
link and the back button works. Query values are narrowed against the known
enums on read, so a hand-edited URL falls back to defaults rather than being
forwarded to the API.

**The dev server proxies `/api` to the backend** so the browser sees a single
origin, which keeps the session cookie first-party. In production nginx does
the same thing (`nginx.conf`). Set `VITE_API_PROXY_TARGET` if your API is not
on `localhost:4000`.

## Design language

A paper accounts ledger rather than a generic admin template: moss and forest
greens on parchment, a rust accent, ruled table rows, and tabular numerals so
figures line up in columns. Colour is used to mean something — score band and
funnel stage — not to decorate. The palette lives in `tailwind.config.js`.
