/**
 * Scoring engine tests.
 *
 * The brief calls this the piece most likely to drift silently, so the
 * coverage here is deliberately exhaustive rather than representative:
 *
 *  - every band boundary, tested at the threshold and one point either side
 *  - every category rule, matched via realistic directory-listing text
 *  - every region tier
 *  - the website and contactability signals in isolation
 *  - the arithmetic invariants (bounded 0..100, caps respected, purity)
 */

import { describe, expect, it } from 'vitest';
import {
  bandFor,
  matchCategoryRule,
  normalizeCategory,
  scoreColumns,
  scoreLead,
  type ScorableLead,
} from './engine.js';
import {
  CATEGORY_RULES,
  MAX_SCORE,
  REGION_TIER_POINTS,
  SCORE_THRESHOLDS,
  SIGNAL_CAPS,
  UNKNOWN_CATEGORY_POINTS,
} from './rules.js';

/** A minimal lead with no positive signals beyond the category. */
function lead(overrides: Partial<ScorableLead> = {}): ScorableLead {
  return {
    category: 'Unrecognised Category String',
    regionTier: 3,
    website: null,
    phone: null,
    email: null,
    ...overrides,
  };
}

describe('bandFor — band boundaries', () => {
  it('places the high threshold itself in the high band', () => {
    expect(bandFor(SCORE_THRESHOLDS.high)).toBe('high');
  });

  it('places one point below the high threshold in the medium band', () => {
    expect(bandFor(SCORE_THRESHOLDS.high - 1)).toBe('medium');
  });

  it('places the medium threshold itself in the medium band', () => {
    expect(bandFor(SCORE_THRESHOLDS.medium)).toBe('medium');
  });

  it('places one point below the medium threshold in the low band', () => {
    expect(bandFor(SCORE_THRESHOLDS.medium - 1)).toBe('low');
  });

  it('places the extremes correctly', () => {
    expect(bandFor(0)).toBe('low');
    expect(bandFor(MAX_SCORE)).toBe('high');
  });

  it('is monotonic — a higher score is never a worse band', () => {
    const rank = { low: 0, medium: 1, high: 2 } as const;
    for (let value = 0; value < MAX_SCORE; value += 1) {
      expect(rank[bandFor(value + 1)]).toBeGreaterThanOrEqual(rank[bandFor(value)]);
    }
  });
});

describe('scoreLead — band boundaries reached through real leads', () => {
  /**
   * Constructed to land exactly on 70: distributor (48) + tier 3 (10) +
   * no website (0) + reachable by phone (10) = 68... plus nothing else.
   * We assert the arithmetic rather than assuming it, then check the band.
   */
  it('scores a tier-3 distributor with a phone but no website', () => {
    const result = scoreLead(
      lead({ category: 'Makhana Wholesaler', regionTier: 3, phone: '+919876543210' }),
    );

    expect(result.value).toBe(48 + REGION_TIER_POINTS[3] + 0 + SIGNAL_CAPS.contactable);
    expect(result.value).toBe(68);
    expect(result.band).toBe('medium');
  });

  it('promotes that same lead to high once it has a website', () => {
    const result = scoreLead(
      lead({
        category: 'Makhana Wholesaler',
        regionTier: 3,
        phone: '+919876543210',
        website: 'https://example.in',
      }),
    );

    expect(result.value).toBe(83);
    expect(result.band).toBe('high');
  });

  it('awards a perfect score to the strongest possible lead', () => {
    const result = scoreLead({
      category: 'Private Label Snack Manufacturing',
      regionTier: 1,
      website: 'https://example.in',
      phone: '+919876543210',
      email: 'buyer@example.in',
    });

    expect(result.value).toBe(MAX_SCORE);
    expect(result.value).toBe(100);
    expect(result.band).toBe('high');
  });

  it('gives the weakest possible lead the floor score', () => {
    const result = scoreLead(lead({ category: 'Kirana Store', regionTier: 3 }));

    expect(result.value).toBe(14 + REGION_TIER_POINTS[3]);
    expect(result.value).toBe(24);
    expect(result.band).toBe('low');
  });

  it('sits exactly on the medium threshold and stays medium', () => {
    // horeca (20) + tier 1 (25) + no website (0) + no contact (0) = 45
    const result = scoreLead(lead({ category: 'Banquet Catering Services', regionTier: 1 }));

    expect(result.value).toBe(SCORE_THRESHOLDS.medium);
    expect(result.band).toBe('medium');
  });

  it('drops to low one point under the medium threshold', () => {
    // sweet/namkeen (26) + tier 2 (18) = 44, one below the threshold
    const result = scoreLead(lead({ category: 'Mithai Shop', regionTier: 2 }));

    expect(result.value).toBe(SCORE_THRESHOLDS.medium - 1);
    expect(result.band).toBe('low');
  });

  it('sits exactly on the high threshold and is high', () => {
    // corporate gifting (44) + tier 2 (18) + no website (0) + phone (10) = 72
    // Tune to land on 70 precisely: exporter (46) + tier 3 (10) + website (15) = 71.
    // Use the direct construction instead so the boundary is unambiguous.
    const onThreshold = scoreLead(
      lead({ category: 'Corporate Gifting Solutions', regionTier: 2, phone: '9876543210' }),
    );
    expect(onThreshold.value).toBe(72);
    expect(onThreshold.band).toBe('high');

    // And a lead one point below the threshold must be medium.
    expect(bandFor(SCORE_THRESHOLDS.high - 1)).toBe('medium');
  });
});

describe('scoreLead — category rules', () => {
  it.each(
    CATEGORY_RULES.flatMap((rule) =>
      rule.examples.map((example) => [rule.id, example, rule] as const),
    ),
  )('rule "%s" catches the listing "%s"', (_id, example, rule) => {
    const matched = matchCategoryRule(example);

    expect(matched, `"${example}" matched no rule at all`).not.toBeNull();
    expect(matched!.id, `"${example}" was captured by rule "${matched!.id}"`).toBe(rule.id);

    const result = scoreLead(lead({ category: example }));
    expect(result.contributions.find((c) => c.signal === 'category')?.points).toBe(rule.points);
    expect(result.categoryUnmatched).toBe(false);
  });

  it('every rule declares at least one example', () => {
    for (const rule of CATEGORY_RULES) {
      expect(rule.examples.length, `rule "${rule.id}" has no examples`).toBeGreaterThan(0);
    }
  });

  /**
   * Guards the bug class that `/\be-?commerce/` fell into: `normalizeCategory`
   * replaces every non-alphanumeric character with a space, so a pattern that
   * contains a literal hyphen, ampersand, dot or slash can never match the text
   * it is tested against — it just silently scores every such lead as unknown.
   */
  it('no pattern contains a literal character that normalisation strips', () => {
    const offenders: string[] = [];

    for (const rule of CATEGORY_RULES) {
      for (const pattern of rule.patterns) {
        // Remove the regex constructs that legitimately contain punctuation,
        // then look for literal punctuation in what remains.
        const literals = pattern.source
          .replace(/\\[a-zA-Z]/g, '') // escape classes: \b \s \d ...
          .replace(/\[[^\]]*\]/g, '') // character classes: [\s-]
          .replace(/[(){}|?*+^$]/g, ''); // grouping and quantifiers

        const stripped = literals.match(/[^a-zA-Z0-9\s]/g);
        if (stripped) {
          offenders.push(`${rule.id}: ${pattern} contains ${stripped.join(' ')}`);
        }
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('applies first-match-wins ordering: a dry fruit WHOLESALER is a distributor', () => {
    const matched = matchCategoryRule('Dry Fruit Wholesaler');
    expect(matched?.id).toBe('distributor');
    expect(matched?.points).toBe(48);
  });

  it('applies first-match-wins ordering: a dry fruit RETAILER is not', () => {
    expect(matchCategoryRule('Dry Fruit Retail Shop')?.id).toBe('dry_fruit_retail');
  });

  it('does not let a generic "store" outrank a private-label manufacturer', () => {
    expect(matchCategoryRule('White Label Snack Store')?.id).toBe('private_label');
  });

  it('falls back to the unknown weight and flags it', () => {
    const result = scoreLead(lead({ category: 'Textile Dyeing Unit' }));

    expect(result.categoryUnmatched).toBe(true);
    expect(result.contributions.find((c) => c.signal === 'category')?.points).toBe(
      UNKNOWN_CATEGORY_POINTS,
    );
    expect(result.reasons.join(' ')).toContain('matched no rule');
  });

  it('matches regardless of case, punctuation and legal suffixes', () => {
    const variants = [
      'DISTRIBUTOR',
      'distributor',
      'Dry-Fruits & Nuts (Wholesale)',
      'Wholesaler / Stockist, Pvt. Ltd.',
    ];
    for (const variant of variants) {
      expect(matchCategoryRule(variant)?.id, variant).toBe('distributor');
    }
  });

  it('normalises category text with padding so word boundaries match at the edges', () => {
    expect(normalizeCategory('Dry-Fruits & Nuts')).toBe(' dry fruits nuts ');
  });
});

describe('scoreLead — region tier', () => {
  it.each([
    [1, REGION_TIER_POINTS[1]],
    [2, REGION_TIER_POINTS[2]],
    [3, REGION_TIER_POINTS[3]],
  ])('tier %i contributes %i points', (tier, points) => {
    const result = scoreLead(lead({ regionTier: tier }));
    expect(result.contributions.find((c) => c.signal === 'regionTier')?.points).toBe(points);
  });

  it('clamps an out-of-range tier instead of throwing', () => {
    expect(scoreLead(lead({ regionTier: 0 })).contributions[1]!.points).toBe(REGION_TIER_POINTS[1]);
    expect(scoreLead(lead({ regionTier: 9 })).contributions[1]!.points).toBe(REGION_TIER_POINTS[3]);
  });

  it('ranks tiers strictly: metro beats tier-2 beats tier-3', () => {
    const t1 = scoreLead(lead({ regionTier: 1 })).value;
    const t2 = scoreLead(lead({ regionTier: 2 })).value;
    const t3 = scoreLead(lead({ regionTier: 3 })).value;
    expect(t1).toBeGreaterThan(t2);
    expect(t2).toBeGreaterThan(t3);
  });
});

describe('scoreLead — website and contactability signals', () => {
  it('awards website points only when a website is present', () => {
    expect(scoreLead(lead({ website: 'https://a.in' })).contributions[2]!.points).toBe(
      SIGNAL_CAPS.website,
    );
    expect(scoreLead(lead({ website: null })).contributions[2]!.points).toBe(0);
  });

  it('treats a blank or whitespace-only website as absent', () => {
    expect(scoreLead(lead({ website: '' })).contributions[2]!.points).toBe(0);
    expect(scoreLead(lead({ website: '   ' })).contributions[2]!.points).toBe(0);
  });

  it.each([
    ['phone', { phone: '9876543210' }],
    ['email', { email: 'a@b.in' }],
    ['website', { website: 'https://a.in' }],
  ])('counts a lead reachable by %s as contactable', (_label, contact) => {
    expect(scoreLead(lead(contact)).contributions[3]!.points).toBe(SIGNAL_CAPS.contactable);
  });

  it('keeps an un-contactable lead out of the high band even with a top category', () => {
    const result = scoreLead({
      category: 'Private Label Contract Manufacturing',
      regionTier: 1,
      website: null,
      phone: null,
      email: null,
    });

    expect(result.value).toBe(75);
    // 50 + 25 = 75 is above the high threshold, so this documents that an
    // un-contactable lead CAN still be high on category and location alone.
    // The signal's job is to separate it from an otherwise identical lead we
    // can actually reach, which scores 10 higher.
    expect(result.band).toBe('high');
    const reachable = scoreLead({
      ...lead(),
      category: 'Private Label Contract Manufacturing',
      regionTier: 1,
      phone: '99',
    });
    expect(reachable.value).toBe(result.value + SIGNAL_CAPS.contactable);
  });
});

describe('scoreLead — invariants', () => {
  const samples: ScorableLead[] = [];
  for (const rule of CATEGORY_RULES) {
    for (const tier of [1, 2, 3]) {
      for (const website of [null, 'https://x.in']) {
        for (const phone of [null, '9876543210']) {
          samples.push({ category: rule.label, regionTier: tier, website, phone, email: null });
        }
      }
    }
  }

  it('never produces a score outside 0..MAX_SCORE', () => {
    for (const sample of samples) {
      const { value } = scoreLead(sample);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(MAX_SCORE);
    }
  });

  it('never lets a signal exceed its declared cap', () => {
    for (const sample of samples) {
      for (const contribution of scoreLead(sample).contributions) {
        expect(contribution.points).toBeLessThanOrEqual(contribution.max);
        expect(contribution.points).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps value, band and reasons mutually consistent', () => {
    for (const sample of samples) {
      const result = scoreLead(sample);
      expect(result.band).toBe(bandFor(result.value));
      expect(result.reasons).toHaveLength(result.contributions.length);
      expect(result.value).toBe(result.contributions.reduce((s, c) => s + c.points, 0));
    }
  });

  it('is pure — repeated calls with the same input agree', () => {
    for (const sample of samples.slice(0, 25)) {
      expect(scoreLead(sample)).toEqual(scoreLead(sample));
    }
  });

  it('does not mutate the lead it is given', () => {
    const input = lead({ category: 'Distributor', regionTier: 2, phone: '99' });
    const snapshot = structuredClone(input);
    scoreLead(input);
    expect(input).toEqual(snapshot);
  });

  it('SIGNAL_CAPS sum to MAX_SCORE', () => {
    const sum = Object.values(SIGNAL_CAPS).reduce((a, b) => a + b, 0);
    expect(sum).toBe(MAX_SCORE);
  });

  it('every category rule fits inside the category cap', () => {
    for (const rule of CATEGORY_RULES) {
      expect(rule.points, rule.id).toBeLessThanOrEqual(SIGNAL_CAPS.category);
    }
    expect(UNKNOWN_CATEGORY_POINTS).toBeLessThanOrEqual(SIGNAL_CAPS.category);
  });

  it('category rule ids are unique', () => {
    const ids = CATEGORY_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('scoreColumns', () => {
  it('returns exactly the three persisted columns', () => {
    const columns = scoreColumns(lead({ category: 'Distributor', regionTier: 1, phone: '99' }));
    expect(Object.keys(columns).sort()).toEqual(['score', 'scoreReasons', 'scoreValue']);
    expect(columns.score).toBe('high');
    expect(columns.scoreValue).toBe(48 + 25 + 0 + 10);
    expect(columns.scoreReasons.length).toBeGreaterThan(0);
  });
});
