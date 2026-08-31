/**
 * The scoring engine.
 *
 * This is the single source of truth for `Lead.score`. It runs on lead create,
 * on any update that touches a scored field, and in bulk via the `rescore`
 * script when the rules change. Nothing else — not the frontend, not the
 * scraper, not the CSV importer — is allowed to compute a score.
 *
 * The engine is pure: same input, same output, no database access and no
 * clock. That is what makes it exhaustively testable, which matters because
 * scoring is the piece most likely to drift silently as categories evolve.
 */

import type { LeadScore, RegionTier } from '@lead/shared';
import {
  CATEGORY_RULES,
  MAX_SCORE,
  REGION_TIER_POINTS,
  SCORE_THRESHOLDS,
  SIGNAL_CAPS,
  UNKNOWN_CATEGORY_POINTS,
  type CategoryRule,
} from './rules.js';

/** The subset of a lead the score depends on. */
export interface ScorableLead {
  category: string;
  regionTier: number;
  website?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ScoreContribution {
  signal: keyof typeof SIGNAL_CAPS;
  points: number;
  max: number;
  reason: string;
}

export interface ScoreResult {
  /** 0-100. */
  value: number;
  band: LeadScore;
  contributions: ScoreContribution[];
  /** Flat strings persisted to `Lead.scoreReasons` and shown in the UI. */
  reasons: string[];
  /** True when no category rule matched — a prompt to add one. */
  categoryUnmatched: boolean;
}

/**
 * Normalise free-text category before matching: lowercase, punctuation to
 * spaces, collapsed whitespace. "Dry-Fruits & Nuts (Wholesale)" becomes
 * "dry fruits nuts wholesale " so the `\bwholesal` pattern matches.
 */
export function normalizeCategory(category: string): string {
  return ` ${category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/** First matching rule wins — order in CATEGORY_RULES is significant. */
export function matchCategoryRule(category: string): CategoryRule | null {
  const normalized = normalizeCategory(category);
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule;
    }
  }
  return null;
}

/** Clamp an out-of-range tier to the nearest valid one rather than throwing. */
function coerceRegionTier(tier: number): RegionTier {
  if (tier <= 1) return 1;
  if (tier >= 3) return 3;
  return 2;
}

function hasUsableValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Map a numeric score to its band. */
export function bandFor(value: number): LeadScore {
  if (value >= SCORE_THRESHOLDS.high) return 'high';
  if (value >= SCORE_THRESHOLDS.medium) return 'medium';
  return 'low';
}

export function scoreLead(lead: ScorableLead): ScoreResult {
  const contributions: ScoreContribution[] = [];

  // --- category ------------------------------------------------------------
  const rule = matchCategoryRule(lead.category);
  const categoryUnmatched = rule === null;
  contributions.push({
    signal: 'category',
    points: rule?.points ?? UNKNOWN_CATEGORY_POINTS,
    max: SIGNAL_CAPS.category,
    reason: rule
      ? `${rule.label} (+${rule.points})`
      : `Category "${lead.category}" matched no rule, scored as unknown (+${UNKNOWN_CATEGORY_POINTS})`,
  });

  // --- region tier ---------------------------------------------------------
  const tier = coerceRegionTier(lead.regionTier);
  const tierPoints = REGION_TIER_POINTS[tier];
  contributions.push({
    signal: 'regionTier',
    points: tierPoints,
    max: SIGNAL_CAPS.regionTier,
    reason: `Tier ${tier} location (+${tierPoints})`,
  });

  // --- website -------------------------------------------------------------
  // A website means the business is established enough to be worth a formal
  // quotation, and it gives us somewhere to research them before calling.
  const hasWebsite = hasUsableValue(lead.website);
  contributions.push({
    signal: 'website',
    points: hasWebsite ? SIGNAL_CAPS.website : 0,
    max: SIGNAL_CAPS.website,
    reason: hasWebsite ? `Has a website (+${SIGNAL_CAPS.website})` : 'No website (+0)',
  });

  // --- contactability ------------------------------------------------------
  // A lead with no phone, email or website cannot be actioned at all, however
  // attractive its category. This keeps un-contactable rows out of the high
  // band instead of sending someone to chase a dead end.
  const contactable =
    hasUsableValue(lead.phone) || hasUsableValue(lead.email) || hasWebsite;
  contributions.push({
    signal: 'contactable',
    points: contactable ? SIGNAL_CAPS.contactable : 0,
    max: SIGNAL_CAPS.contactable,
    reason: contactable
      ? `Reachable by phone, email or web (+${SIGNAL_CAPS.contactable})`
      : 'No contact channel on record (+0)',
  });

  const value = contributions.reduce((sum, c) => sum + c.points, 0);

  return {
    value,
    band: bandFor(value),
    contributions,
    reasons: contributions.map((c) => c.reason),
    categoryUnmatched,
  };
}

/** Convenience for callers that only need the persisted columns. */
export function scoreColumns(lead: ScorableLead): {
  score: LeadScore;
  scoreValue: number;
  scoreReasons: string[];
} {
  const result = scoreLead(lead);
  return { score: result.band, scoreValue: result.value, scoreReasons: result.reasons };
}

export { MAX_SCORE, SCORE_THRESHOLDS };
