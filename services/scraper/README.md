# `@lead/scraper` — lead collection

Throttled Puppeteer collection from IndiaMART, Justdial and TradeIndia, plus an
optional Google Places source.

---

## ⚠️ THIS ONLY WORKS FROM AN INDIAN IP ADDRESS

**IndiaMART redirects non-Indian traffic to a separate host that returns 403.**
Justdial serves a degraded page. If you deploy this to a US or EU server it will
run cleanly, find nothing, and — without the checks described below — look like
it worked.

That silent-success failure is the single most likely production bug in this
system, so the scraper is built to refuse rather than to shrug:

1. **Pre-flight country check.** Before any browser starts, the run resolves the
   host's country. A confident "not India" aborts immediately with the remedy in
   the message. A lookup *failure* does not abort — the geolocation service
   being down is not evidence about your IP.
2. **HTTP status check.** A 403 becomes a `GeoBlockedError`, never an empty
   result set. A 429 names the throttle settings to raise.
3. **Redirect check.** Landing on `indiamart.com/international`, or on any host
   other than the expected one, is treated as a block.
4. **Body-marker check.** "Access Denied", "not available in your country",
   Cloudflare interstitials and similar are detected. A page that genuinely says
   "no results found" is *not* flagged — that distinction is tested.
5. **The run row records `geo_blocked`**, not `completed`, and the CRM shows it.

Check your host before deploying:

```bash
pnpm --filter @lead/scraper check-geo
```

### Deploying to Oracle Cloud (Always Free, Indian region)

1. **Create the tenancy in an Indian home region.** At sign-up choose
   **India South (Hyderabad)** or **India West (Mumbai)**. The home region
   cannot be changed afterwards — getting this wrong means starting a new
   tenancy.
2. Create an **Always Free VM.Standard.A1.Flex** instance (ARM, up to 4 OCPU /
   24 GB) running **Ubuntu 22.04 (aarch64)**. Both Indian regions tend to have
   A1 capacity more often than the popular US regions.
3. In the subnet's security list, **do not open 4000 or 5432 to the internet.**
   Open 22 only and reach the CRM over an SSH tunnel or Tailscale. The Compose
   file already binds Postgres and Redis to `127.0.0.1`.
4. On the box:

   ```bash
   sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
   sudo usermod -aG docker $USER   # log out and back in
   git clone <your repo> && cd makhanaStore
   cp .env.example .env && nano .env    # set the secrets
   docker compose up -d
   docker compose run --rm migrate pnpm --filter @lead/db seed
   ```

5. **Verify the geo check from the VM itself**, not from your laptop:

   ```bash
   docker compose exec scraper pnpm --filter @lead/scraper check-geo
   ```

6. Chromium on ARM needs shared memory. `shm_size: 1gb` is already set for the
   scraper service in `docker-compose.yml`; if you run the worker outside
   Compose, pass `--shm-size=1g`.

> A VPN on your laptop does not help. The only IP that matters is the one the
> scraper process egresses from.

---

## No proxies, no paid scraping APIs

A deliberate cost constraint, not an oversight. The scraper stays usable by
being genuinely polite instead:

| Setting | Default | Why |
| --- | ---: | --- |
| `SCRAPER_MIN_DELAY_MS` / `SCRAPER_MAX_DELAY_MS` | 3500 / 9000 | Randomised gap between requests. A constant interval is itself a fingerprint. |
| `SCRAPER_BATCH_SIZE` | 40 | Requests before a long pause |
| `SCRAPER_BATCH_PAUSE_MS` | 90000 | The long pause |
| `SCRAPER_MAX_REQUESTS_PER_RUN` | 300 | **Hard cap.** Also the safety net stopping a parser bug walking a site forever. |
| `SCRAPER_CONCURRENCY` | 1 | Two browsers from one IP is how that IP gets blocked. |

A full 300-request run takes upwards of twenty minutes. That is intended, and a
test asserts the defaults stay slow — tuning them toward "fast" fails the build.

Images, fonts, stylesheets and analytics are blocked at the request level —
partly for speed, mostly because not pulling a megabyte of product photography
per listing page is a real reduction in load on someone else's server.

Please do not "fix" any of this by adding a proxy pool. The architecture is
scoped around ₹0 of running cost.

## How each source is read

**IndiaMART — `window.__INITIAL_STATE__`, not CSS selectors.** IndiaMART
restyles often; the JSON blob its own app hydrates from changes far less, and
when it does change it changes structurally — which fails loudly rather than
silently yielding empty strings. That shape is undocumented and unstable, so the
extractor *walks* the blob looking for listing-shaped objects (a company name
plus a city or a phone) rather than assuming a fixed path. Navigation entries
and ads are filtered out, because a bare `{name}` is not a business.

A page that arrives with no state blob at all raises an error. It is a parser or
blocking problem, not an empty result.

**Justdial and TradeIndia — selectors, all in one file.**
`src/sources/selectors.ts` holds every selector for both sites, so a redesign is
a one-file fix. Each field declares several candidates and the first match wins,
so a partial redesign costs one field rather than the whole scrape.

Two conditions fail loudly instead of reporting a clean empty run:
- Zero result containers **and** no "no results" marker → selectors are stale.
- Containers found but no readable name → the name selectors are stale.

**Google Places — optional, off by default, and it costs money.** Gated behind
`GOOGLE_PLACES_ENABLED` plus a key; nothing else depends on it. It uses the
official Places API with a narrow field mask, since Places bills per field and
asking for everything multiplies the cost of every run. Scraping Google *Search*
result pages is a terms violation and is done nowhere in this codebase.

## Running

Production runs go through the queue — **Campaigns → Run a scrape** in the CRM
enqueues a BullMQ job this worker consumes:

```bash
pnpm --filter @lead/scraper dev      # worker
```

The CLI is for debugging a selector change, not for production:

```bash
pnpm --filter @lead/scraper check-geo
pnpm --filter @lead/scraper scrape -- \
  --source indiamart --category "Dry Fruit Wholesaler" --city Patna --tier 2 --max 20
```

## Automatic scheduling

Off by default. Set `SCRAPER_SCHEDULE_ENABLED=true` with a cron in
`SCRAPER_SCHEDULE_CRON` once you trust the output. Until then trigger runs by
hand and watch the run table — an unattended scraper whose selectors went stale
is exactly what the audit trail exists for.

## The audit trail

Every run writes a `ScraperRun` row **before** the job is enqueued, and updates
it on every exit path: success, cap reached, geo-block, parser break, crash. The
row records what was searched, how many listings were parsed, how many were new
versus duplicate, how many requests were spent, and the error with a truncated
stack.

A run that finds nothing always leaves a record saying why. See
**Campaigns → Scrape runs**.

## De-duplication

Leads are keyed on normalised `name|city` (`buildDedupeKey` in `@lead/shared`),
which strips legal suffixes and the `M/s` prefix so "M/s Sharma Traders Pvt Ltd"
collides with "Sharma Traders". The scraper de-duplicates within a run to avoid
spending requests, but the database's unique index is the authority — a 409 from
the API counts as a duplicate, not a failure.

## Testing

```bash
pnpm --filter @lead/scraper test
```

55 tests covering throttle pacing and the request cap, the IndiaMART blob walker
(including circular references and depth limits), address and outbound-link
cleanup, and every geo-detection path — including the case that must *not* fire:
a genuinely empty result page.
