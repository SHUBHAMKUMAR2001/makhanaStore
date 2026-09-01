/**
 * Geo-wall detection.
 *
 * IndiaMART redirects non-Indian traffic to a separate host that returns 403.
 * The failure mode this module exists to prevent is the quiet one: a scraper
 * deployed to a US or EU server runs cleanly, finds zero listings, and reports
 * success — so nobody notices for weeks that the pipeline stopped filling.
 *
 * A run that trips any of these checks is marked `geo_blocked`, not
 * `completed`.
 */

import type { Page } from 'puppeteer';

export class GeoBlockedError extends Error {
  constructor(
    message: string,
    readonly evidence: string,
  ) {
    super(message);
    this.name = 'GeoBlockedError';
  }
}

/** Hosts IndiaMART bounces foreign traffic to. */
const GEO_REDIRECT_HOSTS = ['indiamart.com/international', 'www.indiamart.com/international'];

/** Body text that means "we blocked you", not "no results". */
const BLOCK_MARKERS = [
  'access denied',
  'access to this page has been denied',
  'your ip address has been blocked',
  'not available in your country',
  'not available in your region',
  'this service is only available in india',
  'request unsuccessful. incapsula',
  'attention required! | cloudflare',
  'checking your browser before accessing',
  'please verify you are a human',
  'unusual traffic from your computer network',
];

/**
 * Inspect a loaded page for signs we are being walled rather than genuinely
 * seeing no results.
 *
 * @throws GeoBlockedError when the evidence is unambiguous.
 */
export async function assertNotGeoBlocked(page: Page, expectedHost: string): Promise<void> {
  const url = page.url();

  if (GEO_REDIRECT_HOSTS.some((host) => url.includes(host))) {
    throw new GeoBlockedError(
      `Redirected to ${url} — this is IndiaMART's non-Indian traffic path. ` +
        'The scraper must run from an Indian IP; see services/scraper/README.md.',
      url,
    );
  }

  // A redirect away from the expected host entirely is also suspicious.
  try {
    const actualHost = new URL(url).host;
    if (!actualHost.includes(expectedHost.replace(/^www\./, ''))) {
      throw new GeoBlockedError(
        `Expected to be on ${expectedHost} but landed on ${actualHost}`,
        url,
      );
    }
  } catch (error) {
    if (error instanceof GeoBlockedError) throw error;
    // An unparseable URL is not itself evidence of a block.
  }

  const bodyText = await page
    .evaluate(() => document.body?.innerText?.slice(0, 4000).toLowerCase() ?? '')
    .catch(() => '');

  const marker = BLOCK_MARKERS.find((m) => bodyText.includes(m));
  if (marker) {
    throw new GeoBlockedError(
      `The page says "${marker}" — we are being blocked, not seeing an empty result set.`,
      bodyText.slice(0, 500),
    );
  }
}

/** HTTP statuses that mean "blocked" rather than "no such page". */
export function assertNotBlockedStatus(status: number, url: string): void {
  if (status === 403) {
    throw new GeoBlockedError(
      `${url} returned 403. For IndiaMART this almost always means the request ` +
        'did not come from an Indian IP address.',
      `HTTP ${status}`,
    );
  }
  if (status === 429) {
    throw new GeoBlockedError(
      `${url} returned 429 (rate limited). Increase SCRAPER_MIN_DELAY_MS / ` +
        'SCRAPER_BATCH_PAUSE_MS and try again later.',
      `HTTP ${status}`,
    );
  }
}

/**
 * Best-effort country check before a run starts.
 *
 * Uses a plain IP-geolocation lookup. A failure here is NOT treated as a block
 * — the lookup service being down is not evidence about our IP — but a
 * confident "you are not in India" is worth failing fast on, before spending
 * five minutes of throttled requests to discover the same thing.
 */
export async function detectCountry(
  fetchImpl: typeof fetch = fetch,
): Promise<{ country: string | null; checked: boolean }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetchImpl('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) return { country: null, checked: false };

    const data = (await response.json()) as { country_code?: string };
    return { country: data.country_code ?? null, checked: true };
  } catch {
    return { country: null, checked: false };
  }
}
