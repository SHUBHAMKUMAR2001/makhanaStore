/**
 * Zod schemas shared by the API (request validation) and the web app
 * (form validation). The API is the enforcement point — every endpoint parses
 * its input through one of these before touching the database.
 *
 * Note what is deliberately absent from `leadCreateSchema` /
 * `leadUpdateSchema`: `score`, `scoreValue` and `scoreReasons`. Those are
 * computed by the scoring engine server-side. A client that submits them is
 * ignored rather than rejected, so a stale frontend cannot corrupt scores.
 */

import { z } from 'zod';
import {
  CAMPAIGN_CHANNELS,
  DOCUMENT_TYPES,
  INTERACTION_TYPES,
  LEAD_SCORES,
  LEAD_SOURCES,
  LEAD_STAGES,
  OUTREACH_CHANNELS,
  SCRAPABLE_SOURCES,
} from './enums.js';

// --- primitives ------------------------------------------------------------

const trimmed = (max: number) => z.string().trim().max(max);
const requiredText = (max: number, field: string) =>
  trimmed(max).min(1, `${field} is required`);

/**
 * Indian phone numbers arrive from scrapers in a dozen shapes:
 * "+91 98765 43210", "09876543210", "098765-43210". We store the digits and
 * let the display layer format. Anything with fewer than 8 digits is noise.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/[^\d+]/g, ''))
  .refine((v) => v.replace(/\D/g, '').length >= 8, 'Phone number looks too short')
  .refine((v) => v.replace(/\D/g, '').length <= 15, 'Phone number looks too long');

/**
 * Scraped websites are frequently bare hosts ("acmefoods.in") or tracking
 * redirects. Normalise to an absolute http(s) URL or reject.
 */
export const websiteSchema = z
  .string()
  .trim()
  .transform((raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`))
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
    } catch {
      return false;
    }
  }, 'Must be a valid website URL');

export const emailSchema = z.string().trim().toLowerCase().email('Must be a valid email address');

export const regionTierSchema = z.coerce
  .number()
  .int()
  .min(1, 'Region tier must be 1, 2 or 3')
  .max(3, 'Region tier must be 1, 2 or 3');

export const dealValueSchema = z.coerce
  .number()
  .nonnegative('Deal value cannot be negative')
  .max(1_000_000_000, 'Deal value is implausibly large');

const cuid = z.string().cuid();

// --- lead ------------------------------------------------------------------

export const leadCreateSchema = z.object({
  name: requiredText(200, 'Business name'),
  category: requiredText(120, 'Category'),
  city: requiredText(120, 'City'),
  regionTier: regionTierSchema.default(3),
  phone: phoneSchema.nullish(),
  email: emailSchema.nullish(),
  website: websiteSchema.nullish(),
  source: z.enum(LEAD_SOURCES),
  stage: z.enum(LEAD_STAGES).default('sourced'),
  dealValue: dealValueSchema.nullish(),
  notes: trimmed(10_000).nullish(),
  campaignId: cuid.nullish(),
  scraperRunId: cuid.nullish(),
});
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

/**
 * Update is a partial of create minus `stage` — stage moves go through the
 * dedicated transition endpoint so every move can be validated and logged.
 */
export const leadUpdateSchema = leadCreateSchema
  .omit({ stage: true, scraperRunId: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No fields to update');
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;

export const stageTransitionSchema = z.object({
  stage: z.enum(LEAD_STAGES),
  /** Optional note recorded as an Interaction alongside the move. */
  note: trimmed(2_000).optional(),
  /** Won deals should carry a value; enforced in the service layer. */
  dealValue: dealValueSchema.nullish(),
});
export type StageTransitionInput = z.infer<typeof stageTransitionSchema>;

export const leadSortFields = [
  'createdAt',
  'updatedAt',
  'name',
  'city',
  'score',
  'stage',
  'dealValue',
] as const;

export const leadListQuerySchema = z.object({
  q: trimmed(200).optional(),
  stage: z.union([z.enum(LEAD_STAGES), z.array(z.enum(LEAD_STAGES))]).optional(),
  source: z.union([z.enum(LEAD_SOURCES), z.array(z.enum(LEAD_SOURCES))]).optional(),
  score: z.union([z.enum(LEAD_SCORES), z.array(z.enum(LEAD_SCORES))]).optional(),
  regionTier: z.union([regionTierSchema, z.array(regionTierSchema)]).optional(),
  city: trimmed(120).optional(),
  campaignId: cuid.optional(),
  sortBy: z.enum(leadSortFields).default('createdAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type LeadListQuery = z.infer<typeof leadListQuerySchema>;

// --- interactions ----------------------------------------------------------

export const interactionCreateSchema = z.object({
  type: z.enum(INTERACTION_TYPES),
  content: requiredText(10_000, 'Content'),
  direction: z.enum(['outbound', 'inbound', 'internal']).default('internal'),
  subject: trimmed(300).nullish(),
});
export type InteractionCreateInput = z.infer<typeof interactionCreateSchema>;

// --- bulk import -----------------------------------------------------------

/**
 * A single CSV row. Intentionally lenient about column presence but strict
 * about values: a row that fails here is reported back with its line number
 * and skipped, rather than being coerced into a half-empty lead.
 */
export const csvLeadRowSchema = z.object({
  name: requiredText(200, 'name'),
  category: requiredText(120, 'category'),
  city: requiredText(120, 'city'),
  regionTier: regionTierSchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  website: websiteSchema.optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  stage: z.enum(LEAD_STAGES).optional(),
  dealValue: dealValueSchema.optional(),
  notes: trimmed(10_000).optional(),
});
export type CsvLeadRow = z.infer<typeof csvLeadRowSchema>;

export const csvImportOptionsSchema = z.object({
  /** Fallback source for rows that don't specify one. */
  defaultSource: z.enum(LEAD_SOURCES).default('manual'),
  /** When false, rows matching an existing name+city are skipped, not updated. */
  updateExisting: z.coerce.boolean().default(false),
  /** Parse and report without writing. */
  dryRun: z.coerce.boolean().default(false),
});
export type CsvImportOptions = z.infer<typeof csvImportOptionsSchema>;

// --- campaigns -------------------------------------------------------------

export const campaignCreateSchema = z.object({
  name: requiredText(200, 'Campaign name'),
  channel: z.enum(CAMPAIGN_CHANNELS),
  sourceConfig: z.record(z.unknown()).default({}),
  spend: dealValueSchema.nullish(),
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().nullish(),
});
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const campaignUpdateSchema = campaignCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No fields to update');

// --- scraper ---------------------------------------------------------------

export const scraperRunRequestSchema = z.object({
  source: z.enum(SCRAPABLE_SOURCES),
  category: requiredText(120, 'Category'),
  city: requiredText(120, 'City'),
  regionTier: regionTierSchema.optional(),
  /** Per-run override of the global request cap. Never allowed to exceed it. */
  maxRequests: z.coerce.number().int().min(1).max(1000).optional(),
  campaignId: cuid.optional(),
});
export type ScraperRunRequest = z.infer<typeof scraperRunRequestSchema>;

export const scraperRunListQuerySchema = z.object({
  source: z.enum(LEAD_SOURCES).optional(),
  status: trimmed(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// --- auth ------------------------------------------------------------------

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password is too long');

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

// --- docgen ----------------------------------------------------------------

export const quotationLineItemSchema = z.object({
  productId: cuid.optional(),
  /** Free-text fallback for one-off items not in the catalogue. */
  description: requiredText(300, 'Description'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unit: trimmed(20).default('kg'),
  /** Omit to have docgen resolve the price from the product's tier table. */
  pricePerUnit: z.coerce.number().nonnegative().optional(),
  hsnCode: trimmed(20).optional(),
});
export type QuotationLineItem = z.infer<typeof quotationLineItemSchema>;

export const quotationRequestSchema = z.object({
  leadId: cuid,
  items: z.array(quotationLineItemSchema).min(1, 'At least one line item is required'),
  /** GST percentage applied to the subtotal. */
  taxPercent: z.coerce.number().min(0).max(50).default(5),
  /** Freight / packaging, added after tax. */
  freight: z.coerce.number().nonnegative().default(0),
  notes: trimmed(2_000).optional(),
  validityDays: z.coerce.number().int().min(1).max(365).optional(),
});
export type QuotationRequest = z.infer<typeof quotationRequestSchema>;

export const presentationRequestSchema = z.object({
  /** Optional: personalises the title slide and links the file to the lead. */
  leadId: cuid.optional(),
  title: trimmed(200).optional(),
  /** Include the price-tier slide. Off for cold first-touch decks. */
  includePricing: z.coerce.boolean().default(false),
});
export type PresentationRequest = z.infer<typeof presentationRequestSchema>;

export const documentListQuerySchema = z.object({
  leadId: cuid.optional(),
  type: z.enum(DOCUMENT_TYPES).optional(),
});

// --- outreach --------------------------------------------------------------

export const outreachSendSchema = z.object({
  leadId: cuid,
  channel: z.enum(OUTREACH_CHANNELS),
  subject: trimmed(300).optional(),
  body: requiredText(20_000, 'Message body'),
  /** Skip the provider and only record the interaction. */
  dryRun: z.coerce.boolean().default(false),
});
export type OutreachSendInput = z.infer<typeof outreachSendSchema>;

// --- business config -------------------------------------------------------

export const businessProfileUpdateSchema = z.object({
  legalName: requiredText(200, 'Legal name').optional(),
  brandName: requiredText(200, 'Brand name').optional(),
  fssaiNumber: trimmed(30).optional(),
  gstin: trimmed(20).nullish(),
  addressLine1: trimmed(200).optional(),
  addressLine2: trimmed(200).nullish(),
  city: trimmed(120).optional(),
  state: trimmed(120).optional(),
  pincode: trimmed(12).optional(),
  phone: trimmed(30).optional(),
  email: emailSchema.optional(),
  website: websiteSchema.nullish(),
  bankName: trimmed(120).nullish(),
  accountName: trimmed(200).nullish(),
  accountNumber: trimmed(40).nullish(),
  ifsc: trimmed(20).nullish(),
  quotationTerms: z.array(trimmed(500)).max(20).optional(),
  quotationValidityDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const productCreateSchema = z.object({
  sku: requiredText(40, 'SKU'),
  name: requiredText(200, 'Product name'),
  grade: trimmed(80).nullish(),
  description: trimmed(2_000).nullish(),
  hsnCode: trimmed(20).nullish(),
  unit: trimmed(20).default('kg'),
  active: z.coerce.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
  priceTiers: z
    .array(
      z.object({
        minQty: z.coerce.number().int().nonnegative(),
        maxQty: z.coerce.number().int().positive().nullish(),
        pricePerUnit: z.coerce.number().nonnegative(),
      }),
    )
    .optional(),
});

export const productUpdateSchema = productCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No fields to update');

// --- misc ------------------------------------------------------------------

export const idParamSchema = z.object({ id: cuid });
