/**
 * Address and outbound-link handling for the selector-driven sites.
 *
 * Both of these turn messy directory text into something the API will accept,
 * and both fail in ways that are easy to miss: a wrong city silently splits
 * one business into two leads, and an un-cleaned redirect stores the
 * directory's own URL as the prospect's website.
 */

import { describe, expect, it } from 'vitest';
import { cityFromAddress, cleanWebsite } from './selector-site.js';
import { JUSTDIAL, SITE_SELECTORS, TRADEINDIA } from './selectors.js';

describe('cityFromAddress', () => {
  it('takes the city from a typical Indian directory address', () => {
    expect(cityFromAddress('12 Station Road, Kankarbagh, Patna', 'Delhi')).toBe('Patna');
  });

  it('strips a trailing PIN code', () => {
    expect(cityFromAddress('12 Station Road, Kankarbagh, Patna - 800020', 'Delhi')).toBe('Patna');
    expect(cityFromAddress('12 Station Road, Patna 800020', 'Delhi')).toBe('Patna');
  });

  it('falls back when the address is missing', () => {
    expect(cityFromAddress(null, 'Delhi')).toBe('Delhi');
    expect(cityFromAddress('', 'Delhi')).toBe('Delhi');
  });

  it('falls back rather than returning something that is plainly not a city', () => {
    expect(cityFromAddress('Shop 4, Sector 22', 'Delhi')).toBe('Delhi');
    expect(cityFromAddress('XY', 'Delhi')).toBe('Delhi');
  });

  it('handles a single-component address', () => {
    expect(cityFromAddress('Darbhanga', 'Delhi')).toBe('Darbhanga');
  });
});

describe('cleanWebsite', () => {
  it('unwraps a directory redirect', () => {
    expect(
      cleanWebsite('https://www.justdial.com/redirect?url=https://acme.in/', 'justdial.com'),
    ).toBe('https://acme.in/');
  });

  it('unwraps the other common redirect parameter names', () => {
    expect(cleanWebsite('https://x.justdial.com/go?u=https://acme.in', 'justdial.com')).toBe(
      'https://acme.in',
    );
    expect(cleanWebsite('https://x.justdial.com/go?target=https://acme.in', 'justdial.com')).toBe(
      'https://acme.in',
    );
  });

  it('rejects a link back to the directory itself — that is a profile, not a website', () => {
    expect(cleanWebsite('https://www.justdial.com/Patna/Sharma-Traders', 'justdial.com')).toBeNull();
  });

  it('passes a genuine external website through', () => {
    expect(cleanWebsite('https://acmefoods.in/about', 'justdial.com')).toBe(
      'https://acmefoods.in/about',
    );
  });

  it('returns null for missing or unparseable input', () => {
    expect(cleanWebsite(null, 'justdial.com')).toBeNull();
    expect(cleanWebsite('not a url', 'justdial.com')).toBeNull();
  });
});

describe('site selector configs', () => {
  it.each(Object.entries(SITE_SELECTORS))('%s declares every field', (_name, config) => {
    // Each field needs at least one candidate, or extraction silently yields
    // null for it on every listing.
    for (const field of ['resultItem', 'name', 'phone', 'website', 'address', 'category'] as const) {
      expect(config[field].length, `${config.label}.${field}`).toBeGreaterThan(0);
    }
    expect(config.noResults.length).toBeGreaterThan(0);
  });

  it('builds a Justdial search URL with a slugged category', () => {
    const url = JUSTDIAL.searchUrl({ category: 'Dry Fruit Wholesaler', city: 'Patna', page: 2 });
    expect(url).toBe('https://www.justdial.com/Patna/dry-fruit-wholesaler/page-2');
  });

  it('builds a TradeIndia search URL', () => {
    const url = TRADEINDIA.searchUrl({ category: 'Makhana', city: 'Patna', page: 1 });
    expect(url).toContain('keyword=Makhana');
    expect(url).toContain('city=Patna');
  });
});
