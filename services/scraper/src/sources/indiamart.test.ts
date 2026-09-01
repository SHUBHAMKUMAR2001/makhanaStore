/**
 * IndiaMART state-blob parsing.
 *
 * The extractor walks an undocumented, unstable JSON shape looking for
 * listing-shaped objects. These tests pin the behaviours that matter: it finds
 * listings at varying depths and under varying key names, and it does NOT
 * mistake navigation or ad objects for businesses.
 */

import { describe, expect, it } from 'vitest';
import { extractListings, normalizeListing, searchUrl } from './indiamart.js';

const fallback = { category: 'Makhana', city: 'Patna', regionTier: 2 };

describe('searchUrl', () => {
  it('encodes the search term and city', () => {
    const url = searchUrl('Dry Fruit Wholesaler', 'New Delhi', 2);
    expect(url).toContain('ss=Dry%20Fruit%20Wholesaler');
    expect(url).toContain('cq=New%20Delhi');
    expect(url).toContain('page=2');
  });
});

describe('extractListings', () => {
  it('finds listings nested inside the state tree', () => {
    const state = {
      pageProps: {
        searchResults: {
          data: {
            items: [
              { companyname: 'Sharma Traders', city: 'Patna', mobile: '9876543210' },
              { companyname: 'Verma Exports', cityname: 'Delhi', mob: '9811111111' },
            ],
          },
        },
      },
    };

    expect(extractListings(state)).toHaveLength(2);
  });

  it('accepts the several key spellings IndiaMART uses for a company name', () => {
    const state = {
      a: [{ name: 'A', city: 'Patna' }],
      b: [{ compname: 'B', city: 'Patna' }],
      c: [{ glusrCompanyName: 'C', city: 'Patna' }],
      d: [{ companyname: 'D', city: 'Patna' }],
    };

    expect(extractListings(state)).toHaveLength(4);
  });

  it('ignores objects that only have a name — those are menu entries, not businesses', () => {
    const state = { nav: [{ name: 'Home' }, { name: 'Categories' }, { name: 'Sell' }] };
    expect(extractListings(state)).toHaveLength(0);
  });

  it('accepts a listing identified by name plus a phone but no city', () => {
    const state = { results: [{ name: 'Sharma Traders', mobile: '9876543210' }] };
    expect(extractListings(state)).toHaveLength(1);
  });

  it('does not descend into a listing and double-count its nested objects', () => {
    const state = {
      results: [
        {
          name: 'Sharma Traders',
          city: 'Patna',
          // A nested object that would itself look like a listing.
          contact: { name: 'Rakesh Sharma', city: 'Patna', mobile: '9876543210' },
        },
      ],
    };

    expect(extractListings(state)).toHaveLength(1);
  });

  it('survives a circular reference without hanging', () => {
    const node: Record<string, unknown> = { name: 'Sharma Traders', city: 'Patna' };
    const state: Record<string, unknown> = { results: [node] };
    node['parent'] = state;

    expect(extractListings(state)).toHaveLength(1);
  });

  it('respects the depth limit rather than walking forever', () => {
    // Bury a listing deeper than the limit; it should not be found.
    let deep: unknown = { name: 'Buried Traders', city: 'Patna' };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };

    expect(extractListings(deep, 5)).toHaveLength(0);
  });

  it('returns nothing for an empty or absent state', () => {
    expect(extractListings(null)).toHaveLength(0);
    expect(extractListings({})).toHaveLength(0);
    expect(extractListings([])).toHaveLength(0);
  });
});

describe('normalizeListing', () => {
  it('maps a full listing onto the lead shape', () => {
    const lead = normalizeListing(
      {
        companyname: 'Sharma Dry Fruits',
        city: 'Muzaffarpur',
        mobile: '9876543210',
        website: 'https://sharma.example.in',
        productName: 'Makhana Wholesaler',
      },
      fallback,
    );

    expect(lead).toEqual({
      name: 'Sharma Dry Fruits',
      category: 'Makhana Wholesaler',
      city: 'Muzaffarpur',
      regionTier: 2,
      phone: '9876543210',
      website: 'https://sharma.example.in',
      email: null,
      notes: null,
    });
  });

  it('falls back to the searched city and category when the listing omits them', () => {
    const lead = normalizeListing({ name: 'Sharma Traders', mobile: '9876543210' }, fallback);
    expect(lead?.city).toBe('Patna');
    expect(lead?.category).toBe('Makhana');
  });

  it('tolerates a masked phone number — IndiaMART hides these from logged-out users', () => {
    const lead = normalizeListing({ name: 'Sharma Traders', city: 'Patna' }, fallback);
    expect(lead?.phone).toBeNull();
    expect(lead?.name).toBe('Sharma Traders');
  });

  it('accepts a numeric phone value', () => {
    const lead = normalizeListing({ name: 'A', city: 'Patna', mobile: 9876543210 }, fallback);
    expect(lead?.phone).toBe('9876543210');
  });

  it('returns null when there is no usable name', () => {
    expect(normalizeListing({ city: 'Patna', mobile: '9876543210' }, fallback)).toBeNull();
    expect(normalizeListing({ name: '   ', city: 'Patna' }, fallback)).toBeNull();
  });
});
