/**
 * Justdial and TradeIndia.
 *
 * Selector-driven, with every selector living in `selectors.ts`. Each field
 * declares several candidates and the first match wins, so a partial redesign
 * costs one field rather than the whole scrape.
 *
 * The important behaviour here: a page that yields zero *parsed* listings but
 * has result containers is treated as a parser break and reported, not
 * silently accepted as "no results".
 */

import type { Page } from 'puppeteer';
import { assertNotBlockedStatus, assertNotGeoBlocked } from '../lib/geo.js';
import { logger } from '../lib/logger.js';
import type { ScrapedLead } from '../lib/api-client.js';
import type { Throttle } from '../lib/throttle.js';
import type { SiteSelectors } from './selectors.js';
import type { ScrapeResult } from './indiamart.js';

/** Raw strings pulled out of the DOM, before normalisation. */
interface RawRow {
  name: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  category: string | null;
}

/**
 * Runs inside the page. Must be self-contained — it is serialised across the
 * CDP boundary and cannot close over anything from this module.
 */
function extractInPage(selectors: SiteSelectors): { rows: RawRow[]; containers: number } {
  const firstMatch = (root: ParentNode, candidates: string[]): Element | null => {
    for (const selector of candidates) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  };

  const text = (root: ParentNode, candidates: string[]): string | null => {
    const el = firstMatch(root, candidates);
    const value = el?.textContent?.trim() ?? '';
    return value.length > 0 ? value : null;
  };

  const href = (root: ParentNode, candidates: string[]): string | null => {
    const el = firstMatch(root, candidates) as HTMLAnchorElement | null;
    const value = el?.href ?? '';
    return value.length > 0 ? value : null;
  };

  let containers: Element[] = [];
  for (const selector of selectors.resultItem) {
    const found = Array.from(document.querySelectorAll(selector));
    if (found.length > 0) {
      containers = found;
      break;
    }
  }

  const rows: RawRow[] = containers.map((container) => {
    // A phone can be in text or behind a tel: link.
    const telLink = container.querySelector('a[href^="tel:"]') as HTMLAnchorElement | null;
    const phoneFromLink = telLink?.href?.replace(/^tel:/, '') ?? null;

    return {
      name: text(container, selectors.name),
      phone: phoneFromLink ?? text(container, selectors.phone),
      website: href(container, selectors.website),
      address: text(container, selectors.address),
      category: text(container, selectors.category),
    };
  });

  return { rows, containers: containers.length };
}

/** Pull a city out of a free-text address, falling back to the searched city. */
export function cityFromAddress(address: string | null, fallback: string): string {
  if (!address) return fallback;

  // Indian directory addresses usually end "..., <City> - <PIN>" or "..., <City>".
  const withoutPin = address.replace(/[-,]?\s*\d{6}\s*$/, '').trim();
  const parts = withoutPin
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  const last = parts[parts.length - 1];
  if (!last) return fallback;

  // Reject a trailing state name or something that is plainly not a city.
  if (last.length < 3 || last.length > 40 || /\d/.test(last)) return fallback;
  return last;
}

/** Strip a directory's outbound-redirect wrapper to get the real site. */
export function cleanWebsite(url: string | null, siteHost: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);

    // Many directories wrap outbound links; the real URL is a query param.
    for (const key of ['url', 'u', 'redirect', 'target', 'link']) {
      const inner = parsed.searchParams.get(key);
      if (inner && /^https?:\/\//i.test(inner)) return inner;
    }

    // A link back to the directory itself is a profile page, not their website.
    if (parsed.host.includes(siteHost.replace(/^www\./, ''))) return null;

    return parsed.toString();
  } catch {
    return null;
  }
}

export async function scrapeSelectorSite(
  page: Page,
  selectors: SiteSelectors,
  params: { category: string; city: string; regionTier: number; maxPages: number },
  throttle: Throttle,
): Promise<ScrapeResult> {
  const leads: ScrapedLead[] = [];
  const seen = new Set<string>();
  let pagesFetched = 0;

  for (let pageNumber = 1; pageNumber <= params.maxPages; pageNumber += 1) {
    if (throttle.exhausted) {
      logger.info({ pagesFetched }, `Request budget exhausted, stopping ${selectors.label} scrape`);
      break;
    }

    const url = selectors.searchUrl({
      category: params.category,
      city: params.city,
      page: pageNumber,
    });

    await throttle.beforeRequest();
    logger.info({ url, page: pageNumber }, `Fetching ${selectors.label} results page`);

    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    pagesFetched += 1;

    if (response) assertNotBlockedStatus(response.status(), url);
    await assertNotGeoBlocked(page, selectors.host);

    // Give client-rendered results a moment to appear.
    await page
      .waitForSelector(selectors.resultItem.join(', '), { timeout: 8000 })
      .catch(() => undefined);

    const { rows, containers } = await page.evaluate(extractInPage, selectors);

    const named = rows.filter((r) => r.name);
    logger.info(
      { page: pageNumber, containers, parsed: named.length },
      `Parsed ${selectors.label} listings`,
    );

    if (containers === 0) {
      const explicitlyEmpty = await page.evaluate(
        (empty: string[]) => empty.some((s) => document.querySelector(s) !== null),
        selectors.noResults,
      );

      if (explicitlyEmpty) {
        logger.info({ page: pageNumber }, `${selectors.label} reported no results`);
      } else {
        // Neither results nor a no-results marker: the selectors no longer
        // match. Say so rather than reporting a clean empty run.
        logger.error(
          { url, selectors: selectors.resultItem },
          `${selectors.label} returned a page matching none of the result selectors. ` +
            'The site has probably been redesigned — update sources/selectors.ts.',
        );
        throw new Error(
          `${selectors.label} page ${pageNumber} matched no result containers and showed no ` +
            '"no results" marker. Selectors are likely stale — see sources/selectors.ts.',
        );
      }
      break;
    }

    if (named.length === 0 && containers > 0) {
      throw new Error(
        `${selectors.label} found ${containers} result containers but could not read a name from ` +
          'any of them. The name selectors in sources/selectors.ts are stale.',
      );
    }

    for (const row of named) {
      const name = row.name!;
      const city = cityFromAddress(row.address, params.city);
      const key = `${name.toLowerCase()}|${city.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      leads.push({
        name,
        category: row.category ?? params.category,
        city,
        regionTier: params.regionTier,
        phone: row.phone,
        website: cleanWebsite(row.website, selectors.host),
        email: null,
        notes: row.address ? `Address: ${row.address}` : null,
      });
    }

    if (named.length === 0) break;
  }

  return { leads, pagesFetched };
}
