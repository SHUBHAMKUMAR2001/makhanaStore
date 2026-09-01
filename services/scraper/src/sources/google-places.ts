/**
 * Google Places — OPTIONAL and OFF BY DEFAULT.
 *
 * This is the one source that costs money (Places Text Search is billed per
 * request). It is gated behind GOOGLE_PLACES_ENABLED and a key, and nothing
 * else in the system depends on it. If the key is absent the source simply
 * refuses to run rather than degrading silently.
 *
 * It uses the official API, not scraped search-result pages — scraping Google
 * Search is a terms violation and was explicitly ruled out.
 */

import { env } from '../config.js';
import { logger } from '../lib/logger.js';
import type { ScrapedLead } from '../lib/api-client.js';
import type { Throttle } from '../lib/throttle.js';
import type { ScrapeResult } from './indiamart.js';

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';

interface PlacesResponse {
  places?: {
    displayName?: { text?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    websiteUri?: string;
    primaryTypeDisplayName?: { text?: string };
    addressComponents?: { longText?: string; types?: string[] }[];
  }[];
  nextPageToken?: string;
}

export function isEnabled(): boolean {
  return env.GOOGLE_PLACES_ENABLED && env.GOOGLE_PLACES_API_KEY.length > 0;
}

function cityFrom(
  components: { longText?: string; types?: string[] }[] | undefined,
  fallback: string,
): string {
  const locality = components?.find((c) => c.types?.includes('locality'));
  return locality?.longText ?? fallback;
}

export async function scrapeGooglePlaces(
  params: { category: string; city: string; regionTier: number; maxPages: number },
  throttle: Throttle,
  fetchImpl: typeof fetch = fetch,
): Promise<ScrapeResult> {
  if (!isEnabled()) {
    throw new Error(
      'Google Places is disabled. Set GOOGLE_PLACES_ENABLED=true and GOOGLE_PLACES_API_KEY ' +
        'to use it — note that it is a billed API.',
    );
  }

  const leads: ScrapedLead[] = [];
  const seen = new Set<string>();
  let pagesFetched = 0;
  let pageToken: string | undefined;

  for (let pageNumber = 1; pageNumber <= params.maxPages; pageNumber += 1) {
    if (throttle.exhausted) break;
    await throttle.beforeRequest();

    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
        // Request only the fields we use — Places bills by field mask, so
        // asking for everything would multiply the cost of every run.
        'X-Goog-FieldMask': [
          'places.displayName',
          'places.formattedAddress',
          'places.nationalPhoneNumber',
          'places.websiteUri',
          'places.primaryTypeDisplayName',
          'places.addressComponents',
          'nextPageToken',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: `${params.category} in ${params.city}, India`,
        regionCode: 'IN',
        maxResultCount: 20,
        ...(pageToken ? { pageToken } : {}),
      }),
    });

    pagesFetched += 1;

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google Places returned ${response.status}: ${detail.slice(0, 300)}`);
    }

    const data = (await response.json()) as PlacesResponse;
    const places = data.places ?? [];
    logger.info({ page: pageNumber, found: places.length }, 'Google Places results');

    for (const place of places) {
      const name = place.displayName?.text?.trim();
      if (!name) continue;

      const city = cityFrom(place.addressComponents, params.city);
      const key = `${name.toLowerCase()}|${city.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      leads.push({
        name,
        category: place.primaryTypeDisplayName?.text ?? params.category,
        city,
        regionTier: params.regionTier,
        phone: place.nationalPhoneNumber ?? null,
        website: place.websiteUri ?? null,
        email: null,
        notes: place.formattedAddress ? `Address: ${place.formattedAddress}` : null,
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }

  return { leads, pagesFetched };
}
