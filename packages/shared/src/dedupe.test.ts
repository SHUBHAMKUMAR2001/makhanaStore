/**
 * De-duplication key tests.
 *
 * This function decides whether a re-scrape creates a second row for a business
 * we already have. Getting it wrong in one direction fills the CRM with
 * duplicates; in the other, it silently merges two genuinely different
 * businesses. Both are worth testing explicitly.
 */

import { describe, expect, it } from 'vitest';
import { buildDedupeKey, isSameLead } from './dedupe.js';

describe('buildDedupeKey', () => {
  it('produces a name|city key', () => {
    expect(buildDedupeKey('Sharma Traders', 'Patna')).toBe('sharma traders|patna');
  });

  it('ignores case and surrounding whitespace', () => {
    expect(buildDedupeKey('  SHARMA Traders ', ' PATNA ')).toBe('sharma traders|patna');
  });

  it('ignores punctuation', () => {
    expect(buildDedupeKey('Sharma & Sons, Traders.', 'Patna')).toBe(
      buildDedupeKey('Sharma and Sons Traders', 'Patna'),
    );
  });

  it.each([
    ['Sharma Traders Pvt Ltd', 'Sharma Traders'],
    ['Sharma Traders Private Limited', 'Sharma Traders'],
    ['M/s Sharma Traders', 'Sharma Traders'],
    ['M/S. Sharma Traders Pvt. Ltd.', 'Sharma Traders'],
    ['Messrs Sharma Traders', 'Sharma Traders'],
    ['Sharma Traders LLP', 'Sharma Traders'],
    ['The Sharma Traders Company', 'Sharma Traders'],
    ['Sharma Traders Enterprises', 'Sharma Traders'],
  ])('treats "%s" as the same business as "%s"', (a, b) => {
    expect(buildDedupeKey(a, 'Patna')).toBe(buildDedupeKey(b, 'Patna'));
  });

  it('does NOT merge genuinely different businesses', () => {
    expect(buildDedupeKey('Sharma Traders', 'Patna')).not.toBe(
      buildDedupeKey('Verma Traders', 'Patna'),
    );
  });

  it('does NOT merge the same name in different cities', () => {
    expect(buildDedupeKey('Sharma Traders', 'Patna')).not.toBe(
      buildDedupeKey('Sharma Traders', 'Delhi'),
    );
  });

  it('keeps an all-noise name distinguishable instead of collapsing to empty', () => {
    const a = buildDedupeKey('The Company', 'Patna');
    const b = buildDedupeKey('The Enterprises', 'Patna');
    expect(a).not.toBe('|patna');
    expect(a).not.toBe(b);
  });

  it('keeps a single-letter initial that is not the M/s prefix', () => {
    // "S Kumar Traders" must not lose the S the way "M/s ..." loses its prefix.
    expect(buildDedupeKey('S Kumar Traders', 'Patna')).toContain('s kumar traders');
  });

  it('throws rather than producing a junk key for an unusable name', () => {
    expect(() => buildDedupeKey('...', 'Patna')).toThrow(/normalises to empty/);
    expect(() => buildDedupeKey('Sharma', '  ')).toThrow(/normalises to empty/);
  });
});

describe('isSameLead', () => {
  it('matches equivalent spellings', () => {
    expect(
      isSameLead(
        { name: 'M/s Sharma Traders Pvt Ltd', city: 'Patna' },
        { name: 'Sharma Traders', city: 'patna' },
      ),
    ).toBe(true);
  });

  it('returns false rather than throwing on unusable input', () => {
    expect(isSameLead({ name: '', city: 'Patna' }, { name: '', city: 'Patna' })).toBe(false);
  });
});
