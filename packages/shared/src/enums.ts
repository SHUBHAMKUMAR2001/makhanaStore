/**
 * Enum values shared between the API, the scraper and the browser.
 *
 * These are declared as plain const tuples rather than imported from the
 * Prisma client so the frontend can use them without pulling a database
 * driver into the browser bundle. They must stay in lockstep with
 * `packages/db/prisma/schema.prisma` — the round-trip tests in
 * `packages/db/src/enum-parity.test.ts` fail the build if they drift.
 */

export const LEAD_SOURCES = [
  'google_maps',
  'indiamart',
  'tradeindia',
  'justdial',
  'fssai',
  'meta_ads',
  'referral',
  'manual',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SCORES = ['high', 'medium', 'low'] as const;
export type LeadScore = (typeof LEAD_SCORES)[number];

export const LEAD_STAGES = [
  'sourced',
  'contacted',
  'replied',
  'sample_sent',
  'quoted',
  'negotiating',
  'closed_won',
  'closed_lost',
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Stages that represent an open opportunity (counted in pipeline value). */
export const OPEN_STAGES: readonly LeadStage[] = [
  'sourced',
  'contacted',
  'replied',
  'sample_sent',
  'quoted',
  'negotiating',
];

/** Stages a lead can never leave. */
export const TERMINAL_STAGES: readonly LeadStage[] = ['closed_won', 'closed_lost'];

/**
 * The funnel, in order. Used for the dashboard funnel chart and to decide
 * whether a stage change is a progression or a regression.
 */
export const FUNNEL_ORDER: readonly LeadStage[] = [
  'sourced',
  'contacted',
  'replied',
  'sample_sent',
  'quoted',
  'negotiating',
  'closed_won',
];

export const INTERACTION_TYPES = ['call', 'email', 'whatsapp', 'note'] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTERACTION_DIRECTIONS = ['outbound', 'inbound', 'internal'] as const;
export type InteractionDirection = (typeof INTERACTION_DIRECTIONS)[number];

export const DELIVERY_STATUSES = [
  'na',
  'queued',
  'sent',
  'delivered',
  'bounced',
  'failed',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const CAMPAIGN_CHANNELS = ['meta_ads', 'scraper_run', 'manual'] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export const SCRAPER_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'capped',
  'geo_blocked',
  'cancelled',
] as const;
export type ScraperRunStatus = (typeof SCRAPER_RUN_STATUSES)[number];

export const USER_ROLES = ['admin', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DOCUMENT_TYPES = ['quotation', 'presentation'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Sources the scraper service can actually collect from. */
export const SCRAPABLE_SOURCES = [
  'indiamart',
  'justdial',
  'tradeindia',
  'google_maps',
] as const;
export type ScrapableSource = (typeof SCRAPABLE_SOURCES)[number];

export const REGION_TIERS = [1, 2, 3] as const;
export type RegionTier = (typeof REGION_TIERS)[number];

/** Channels the outreach service can send on. */
export const OUTREACH_CHANNELS = ['email', 'whatsapp'] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];
