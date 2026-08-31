/**
 * Prisma row -> API DTO conversion.
 *
 * Two things happen at this boundary and nowhere else:
 *
 *  1. `Decimal` becomes `number`. Prisma's Decimal serialises to a JSON object,
 *     which silently breaks every arithmetic operation in the browser.
 *  2. `Date` becomes an ISO string, so the wire format does not depend on
 *     whatever JSON serialiser happens to be in use.
 */

import { decimalToNumber, type Prisma } from '@lead/db';
import type {
  BusinessProfileDto,
  CampaignDto,
  DocumentDto,
  InteractionDto,
  LeadDto,
  PriceTierDto,
  ProductDto,
  ScraperRunDto,
  UserDto,
} from '@lead/shared';

type LeadRow = Prisma.LeadGetPayload<Record<string, never>>;
type InteractionRow = Prisma.InteractionGetPayload<{ include: { user: true } }>;
type DocumentRow = Prisma.DocumentGetPayload<Record<string, never>>;
type ScraperRunRow = Prisma.ScraperRunGetPayload<Record<string, never>>;
type ProductRow = Prisma.ProductGetPayload<{ include: { priceTiers: true } }>;
type PriceTierRow = Prisma.PriceTierGetPayload<Record<string, never>>;
type BusinessProfileRow = Prisma.BusinessProfileGetPayload<Record<string, never>>;
type UserRow = Prisma.UserGetPayload<Record<string, never>>;

export function serializeLead(lead: LeadRow): LeadDto {
  return {
    id: lead.id,
    name: lead.name,
    category: lead.category,
    city: lead.city,
    regionTier: lead.regionTier,
    phone: lead.phone,
    email: lead.email,
    website: lead.website,
    source: lead.source,
    stage: lead.stage,
    score: lead.score,
    scoreValue: lead.scoreValue,
    scoreReasons: lead.scoreReasons,
    dealValue: decimalToNumber(lead.dealValue),
    notes: lead.notes,
    campaignId: lead.campaignId,
    scraperRunId: lead.scraperRunId,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

export function serializeInteraction(row: InteractionRow): InteractionDto {
  return {
    id: row.id,
    leadId: row.leadId,
    type: row.type,
    content: row.content,
    direction: row.direction,
    status: row.status,
    subject: row.subject,
    externalId: row.externalId,
    userId: row.userId,
    userName: row.user?.name ?? row.user?.email ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeDocument(row: DocumentRow): DocumentDto {
  return {
    id: row.id,
    type: row.type,
    leadId: row.leadId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    downloadUrl: `/documents/${row.id}/download`,
  };
}

export function serializeScraperRun(row: ScraperRunRow): ScraperRunDto {
  return {
    id: row.id,
    source: row.source,
    category: row.category,
    city: row.city,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    leadsFound: row.leadsFound,
    leadsCreated: row.leadsCreated,
    leadsDuplicate: row.leadsDuplicate,
    requestsMade: row.requestsMade,
    error: row.error,
    jobId: row.jobId,
  };
}

export function serializePriceTier(row: PriceTierRow): PriceTierDto {
  return {
    id: row.id,
    minQty: row.minQty,
    maxQty: row.maxQty,
    pricePerUnit: decimalToNumber(row.pricePerUnit) ?? 0,
    currency: row.currency,
  };
}

export function serializeProduct(row: ProductRow): ProductDto {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    grade: row.grade,
    description: row.description,
    hsnCode: row.hsnCode,
    unit: row.unit,
    active: row.active,
    sortOrder: row.sortOrder,
    priceTiers: [...row.priceTiers]
      .sort((a, b) => a.minQty - b.minQty)
      .map(serializePriceTier),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function serializeBusinessProfile(row: BusinessProfileRow): BusinessProfileDto {
  return {
    legalName: row.legalName,
    brandName: row.brandName,
    fssaiNumber: row.fssaiNumber,
    gstin: row.gstin,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    country: row.country,
    phone: row.phone,
    email: row.email,
    website: row.website,
    bankName: row.bankName,
    accountName: row.accountName,
    accountNumber: row.accountNumber,
    ifsc: row.ifsc,
    quotationTerms: row.quotationTerms,
    quotationValidityDays: row.quotationValidityDays,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Never serialises `passwordHash` — the type makes leaking it a compile error. */
export function serializeUser(row: UserRow): UserDto {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export function serializeCampaign(
  row: Prisma.CampaignGetPayload<Record<string, never>>,
  stats: { leadCount: number; wonCount: number; pipelineValue: number; revenue: number },
): CampaignDto {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    sourceConfig: (row.sourceConfig ?? {}) as Record<string, unknown>,
    spend: decimalToNumber(row.spend),
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    ...stats,
  };
}
