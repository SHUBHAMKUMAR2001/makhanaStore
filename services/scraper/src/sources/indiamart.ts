/**
 * IndiaMART.
 *
 * Parsed from the embedded `window.__INITIAL_STATE__` JSON rather than CSS
 * selectors. IndiaMART restyles regularly; the state blob its own React app
 * hydrates from changes far less often, and when it does change it changes
 * structurally rather than cosmetically — which fails loudly instead of
 * silently returning empty strings.
 *
 * The shape of that blob is not documented and not stable, so the extractor
 * walks it looking for listing-shaped objects instead of assuming a fixed
 * path. That survives the key renames that do happen.
 */

import type { Page } from 'puppeteer';
import { assertNotBlockedStatus, assertNotGeoBlocked } from '../lib/geo.js';
import { logger } from '../lib/logger.js';
import type { ScrapedLead } from '../lib/api-client.js';
import type { Throttle } from '../lib/throttle.js';

export const INDIAMART_HOST = 'indiamart.com';

export function searchUrl(category: string, city: string, page: number): string {
  const term = encodeURIComponent(category.trim());
  const place = encodeURIComponent(city.trim());
  return `https://dir.indiamart.com/search.mp?ss=${term}&cq=${place}&page=${page}`;
}

/** A listing as it appears in the state blob, before normalisation. */
interface RawListing {
  name?: unknown;
  companyname?: unknown;
  compname?: unknown;
  glusrCompanyName?: unknown;
  city?: unknown;
  cityname?: unknown;
  glusrUsrCity?: unknown;
  mobile?: unknown;
  mob?: unknown;
  phone?: unknown;
  contactNumber?: unknown;
  website?: unknown;
  weburl?: unknown;
  url?: unknown;
  productName?: unknown;
  prdname?: unknown;
  category?: unknown;
  [key: string]: unknown;
}

const str = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
};

/** First non-empty string among several candidate keys. */
const pick = (obj: RawListing, keys: string[]): string | null => {
  for (const key of keys) {
    const value = str(obj[key]);
    if (value) return value;
  }
  return null;
};

/**
 * Does this object look like a business listing?
 *
 * The state blob contains navigation, ads and config alongside results, so
 * shape-matching is how we find the listings without hardcoding a path.
 */
function isListing(value: unknown): value is RawListing {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const obj = value as RawListing;

  const hasName = Boolean(
    pick(obj, ['name', 'companyname', 'compname', 'glusrCompanyName', 'company_name']),
  );
  const hasLocality = Boolean(pick(obj, ['city', 'cityname', 'glusrUsrCity', 'city_name']));
  const hasContact = Boolean(
    pick(obj, ['mobile', 'mob', 'phone', 'contactNumber', 'glusrUsrMobile']),
  );

  // Name plus at least one of city/contact — a bare `{name: "..."}` is more
  // likely a menu entry than a business.
  return hasName && (hasLocality || hasContact);
}

/** Depth-limited walk collecting every listing-shaped object. */
export function extractListings(state: unknown, maxDepth = 8): RawListing[] {
  const found: RawListing[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number): void => {
    if (depth > maxDepth || node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }

    if (isListing(node)) {
      found.push(node as RawListing);
      // Do not descend into a listing — its nested objects are its own fields.
      return;
    }

    for (const value of Object.values(node)) walk(value, depth + 1);
  };

  walk(state, 0);
  return found;
}

/** Turn a raw listing into the lead shape the API accepts. */
export function normalizeListing(
  raw: RawListing,
  fallback: { category: string; city: string; regionTier: number },
): ScrapedLead | null {
  const name = pick(raw, ['name', 'companyname', 'compname', 'glusrCompanyName', 'company_name']);
  if (!name) return null;

  const city = pick(raw, ['city', 'cityname', 'glusrUsrCity', 'city_name']) ?? fallback.city;

  const phone = pick(raw, ['mobile', 'mob', 'phone', 'contactNumber', 'glusrUsrMobile']);
  const website = pick(raw, ['website', 'weburl', 'companyUrl']);
  const category =
    pick(raw, ['productName', 'prdname', 'category', 'mcatname']) ?? fallback.category;

  return {
    name,
    category,
    city,
    regionTier: fallback.regionTier,
    // IndiaMART masks numbers behind a click for logged-out users, so `phone`
    // is frequently absent. That is expected, not an error.
    phone: phone ?? null,
    website: website ?? null,
    email: null,
    notes: null,
  };
}

export interface ScrapeResult {
  leads: ScrapedLead[];
  /** Pages actually fetched, for the audit record. */
  pagesFetched: number;
}

/**
 * Read `window.__INITIAL_STATE__` off a loaded results page.
 *
 * Returns null when the property is absent, which is itself diagnostic: it
 * usually means we were served a different page than expected (an interstitial
 * or a block), not that there were no results.
 */
async function readInitialState(page: Page): Promise<unknown | null> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return w['__INITIAL_STATE__'] ?? w['__NEXT_DATA__'] ?? w['__PRELOADED_STATE__'] ?? null;
  });
}

export async function scrapeIndiamart(
  page: Page,
  params: { category: string; city: string; regionTier: number; maxPages: number },
  throttle: Throttle,
): Promise<ScrapeResult> {
  const leads: ScrapedLead[] = [];
  const seenNames = new Set<string>();
  let pagesFetched = 0;

  for (let pageNumber = 1; pageNumber <= params.maxPages; pageNumber += 1) {
    if (throttle.exhausted) {
      logger.info({ pagesFetched }, 'Request budget exhausted, stopping IndiaMART scrape');
      break;
    }

    const url = searchUrl(params.category, params.city, pageNumber);
    await throttle.beforeRequest();

    logger.info({ url, page: pageNumber }, 'Fetching IndiaMART results page');
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    pagesFetched += 1;

    if (response) assertNotBlockedStatus(response.status(), url);
    await assertNotGeoBlocked(page, INDIAMART_HOST);

    const state = await readInitialState(page);
    if (!state) {
      // Loud, not silent: this is the signal that the page shape changed or we
      // were served something other than the results page.
      logger.error(
        { url, page: pageNumber },
        'No __INITIAL_STATE__ on the page. Either IndiaMART changed its markup or ' +
          'we were served an interstitial. Check services/scraper/README.md.',
      );
      throw new Error(
        `IndiaMART returned a page with no __INITIAL_STATE__ (page ${pageNumber}). ` +
          'This is a parser or blocking problem, not an empty result set.',
      );
    }

    const raw = extractListings(state);
    logger.info({ page: pageNumber, found: raw.length }, 'Parsed listings from state blob');

    if (raw.length === 0) {
      logger.info({ page: pageNumber }, 'No listings on this page — end of results');
      break;
    }

    for (const item of raw) {
      const lead = normalizeListing(item, params);
      if (!lead) continue;

      // Cheap in-run de-duplication. The API's dedupeKey is authoritative;
      // this just avoids spending requests re-submitting the same business.
      const key = `${lead.name.toLowerCase()}|${lead.city.toLowerCase()}`;
      if (seenNames.has(key)) continue;
      seenNames.add(key);

      leads.push(lead);
    }
  }

  return { leads, pagesFetched };
}
