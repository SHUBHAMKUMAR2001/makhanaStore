/**
 * Geo-block detection.
 *
 * The failure this guards against is the silent one: a scraper deployed
 * outside India running cleanly, finding nothing, and reporting success.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  GeoBlockedError,
  assertNotBlockedStatus,
  assertNotGeoBlocked,
  detectCountry,
} from './geo.js';

/** Minimal Page stand-in — only url() and evaluate() are used. */
function fakePage(url: string, bodyText = 'Showing 42 results for makhana'): never {
  return {
    url: () => url,
    evaluate: async () => bodyText.toLowerCase(),
  } as never;
}

describe('assertNotBlockedStatus', () => {
  it('treats 403 as a geo-block with an actionable message', () => {
    expect(() => assertNotBlockedStatus(403, 'https://dir.indiamart.com/x')).toThrow(GeoBlockedError);
    expect(() => assertNotBlockedStatus(403, 'https://dir.indiamart.com/x')).toThrow(/Indian IP/);
  });

  it('treats 429 as a throttling problem and names the knobs to turn', () => {
    expect(() => assertNotBlockedStatus(429, 'https://x')).toThrow(/SCRAPER_MIN_DELAY_MS/);
  });

  it('lets normal statuses through', () => {
    expect(() => assertNotBlockedStatus(200, 'https://x')).not.toThrow();
    expect(() => assertNotBlockedStatus(404, 'https://x')).not.toThrow();
  });
});

describe('assertNotGeoBlocked', () => {
  it('detects the IndiaMART international redirect', async () => {
    await expect(
      assertNotGeoBlocked(fakePage('https://www.indiamart.com/international/'), 'indiamart.com'),
    ).rejects.toThrow(/non-Indian traffic/);
  });

  it('detects a redirect off the expected host entirely', async () => {
    await expect(
      assertNotGeoBlocked(fakePage('https://blocked.example.com/denied'), 'indiamart.com'),
    ).rejects.toThrow(GeoBlockedError);
  });

  it.each([
    'Access Denied',
    'This service is only available in India',
    'Attention Required! | Cloudflare',
    'Checking your browser before accessing',
    'We have detected unusual traffic from your computer network',
  ])('detects the block marker %s in the page body', async (marker) => {
    await expect(
      assertNotGeoBlocked(fakePage('https://dir.indiamart.com/search.mp', marker), 'indiamart.com'),
    ).rejects.toThrow(GeoBlockedError);
  });

  it('does NOT flag a genuinely empty result page', async () => {
    await expect(
      assertNotGeoBlocked(
        fakePage('https://dir.indiamart.com/search.mp', 'No results found for your search'),
        'indiamart.com',
      ),
    ).resolves.toBeUndefined();
  });

  it('accepts a normal results page', async () => {
    await expect(
      assertNotGeoBlocked(fakePage('https://dir.indiamart.com/search.mp?ss=makhana'), 'indiamart.com'),
    ).resolves.toBeUndefined();
  });
});

describe('detectCountry', () => {
  it('reports the country when the lookup succeeds', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ country_code: 'IN' }),
    });

    await expect(detectCountry(fetchImpl as never)).resolves.toEqual({ country: 'IN', checked: true });
  });

  it('reports "not checked" when the lookup fails — that is not evidence of a block', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(detectCountry(fetchImpl as never)).resolves.toEqual({
      country: null,
      checked: false,
    });
  });

  it('reports "not checked" on a non-OK response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    await expect(detectCountry(fetchImpl as never)).resolves.toEqual({
      country: null,
      checked: false,
    });
  });
});
