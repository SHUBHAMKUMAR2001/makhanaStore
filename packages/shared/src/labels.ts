/** Display strings. Kept out of components so the API and docgen can reuse them. */

import type {
  CampaignChannel,
  DeliveryStatus,
  InteractionType,
  LeadScore,
  LeadSource,
  LeadStage,
  RegionTier,
  ScraperRunStatus,
} from './enums.js';

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  google_maps: 'Google Maps',
  indiamart: 'IndiaMART',
  tradeindia: 'TradeIndia',
  justdial: 'Justdial',
  fssai: 'FSSAI Registry',
  meta_ads: 'Meta Ads',
  referral: 'Referral',
  manual: 'Manual Entry',
};

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  sourced: 'Sourced',
  contacted: 'Contacted',
  replied: 'Replied',
  sample_sent: 'Sample Sent',
  quoted: 'Quoted',
  negotiating: 'Negotiating',
  closed_won: 'Closed — Won',
  closed_lost: 'Closed — Lost',
};

export const LEAD_SCORE_LABELS: Record<LeadScore, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const REGION_TIER_LABELS: Record<RegionTier, string> = {
  1: 'Tier 1 — Metro',
  2: 'Tier 2 — Large city',
  3: 'Tier 3 — Smaller city / town',
};

export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  call: 'Call',
  email: 'Email',
  whatsapp: 'WhatsApp',
  note: 'Note',
};

export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  meta_ads: 'Meta Ads',
  scraper_run: 'Scraper Run',
  manual: 'Manual',
};

export const SCRAPER_RUN_STATUS_LABELS: Record<ScraperRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  capped: 'Stopped at cap',
  geo_blocked: 'Geo-blocked',
  cancelled: 'Cancelled',
};

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  na: '—',
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  bounced: 'Bounced',
  failed: 'Failed',
};
