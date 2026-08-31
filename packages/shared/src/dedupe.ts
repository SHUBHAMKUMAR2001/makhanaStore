/**
 * Lead de-duplication key.
 *
 * Both the API (manual entry, CSV import) and the scraper derive the key with
 * this function, so a re-scrape of the same directory listing collides with
 * the existing row instead of creating a second copy. It is stored on
 * `Lead.dedupeKey` with a unique index — the database is the final arbiter,
 * this function just has to be deterministic.
 *
 * Normalisation is deliberately aggressive about the noise Indian B2B
 * directory listings carry: legal suffixes, honorifics and punctuation vary
 * between IndiaMART and Justdial for what is plainly the same business.
 */

/** Legal-form and courtesy suffixes stripped before comparison. */
const NOISE_TOKENS = new Set([
  'pvt',
  'private',
  'ltd',
  'limited',
  'llp',
  'inc',
  'co',
  'company',
  'corp',
  'corporation',
  'enterprises',
  'enterprise',
  'and',
  'the',
  'm/s',
  'ms',
  'messrs',
]);

function normalizeToken(value: string): string {
  return value
    .normalize('NFKD')
    // Strip combining marks so accented spellings collide with plain ones.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripNoise(value: string): string {
  // "M/s" is the common Indian prefix for "Messrs". Normalisation has already
  // turned the slash into a space by this point, so it arrives as two separate
  // single-letter tokens and never matches the NOISE_TOKENS entry — strip the
  // leading pair explicitly rather than adding "m" and "s" to the noise list,
  // which would also eat meaningful initials elsewhere in a name.
  const withoutMessrs = normalizeToken(value).replace(/^m s\b\s*/, '');

  const kept = withoutMessrs
    .split(' ')
    .filter((token) => token.length > 0 && !NOISE_TOKENS.has(token));

  // If a name is *entirely* noise ("The Company"), keep the normalised form
  // rather than producing an empty key that would collide with every other
  // all-noise name.
  return kept.length > 0 ? kept.join(' ') : normalizeToken(value);
}

/**
 * Build the unique key for a lead. Returns `name|city`, both normalised.
 *
 * @throws if either component normalises to an empty string — that indicates
 *         a parser bug upstream and must not silently produce a `"|"` key
 *         that every junk row would collide on.
 */
export function buildDedupeKey(name: string, city: string): string {
  const normalizedName = stripNoise(name);
  const normalizedCity = normalizeToken(city);

  if (!normalizedName) {
    throw new Error(`Cannot build dedupe key: name "${name}" normalises to empty`);
  }
  if (!normalizedCity) {
    throw new Error(`Cannot build dedupe key: city "${city}" normalises to empty`);
  }

  return `${normalizedName}|${normalizedCity}`;
}

/** True when two name/city pairs would occupy the same lead row. */
export function isSameLead(
  a: { name: string; city: string },
  b: { name: string; city: string },
): boolean {
  try {
    return buildDedupeKey(a.name, a.city) === buildDedupeKey(b.name, b.city);
  } catch {
    return false;
  }
}
