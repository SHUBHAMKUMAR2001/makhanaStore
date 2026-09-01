/**
 * Lead business logic.
 *
 * The rule this module exists to enforce: **a lead's score is written here and
 * nowhere else.** Every create and every update that touches a scored field
 * recomputes it from `scoreColumns`. Callers cannot supply a score — the shared
 * zod schemas do not accept one, and even if a field slipped through, the
 * spreads below overwrite it.
 */

import {
  buildDedupeKey,
  type LeadListQuery,
  type LeadCreateInput,
  type LeadUpdateInput,
  type StageTransitionInput,
} from '@lead/shared';
import { numberToDecimal, prisma, type Lead, type Prisma } from '@lead/db';
import { scoreColumns } from '../scoring/index.js';
import { ApiError } from '../lib/errors.js';

/** Fields whose change invalidates an existing score. */
const SCORED_FIELDS = ['category', 'regionTier', 'website', 'phone', 'email'] as const;

export function requiresRescore(update: LeadUpdateInput): boolean {
  return SCORED_FIELDS.some((field) => field in update);
}

export async function createLead(input: LeadCreateInput): Promise<Lead> {
  const dedupeKey = buildDedupeKey(input.name, input.city);

  return prisma.lead.create({
    data: {
      name: input.name,
      category: input.category,
      city: input.city,
      regionTier: input.regionTier,
      phone: input.phone ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
      source: input.source,
      stage: input.stage,
      dealValue: numberToDecimal(input.dealValue ?? null),
      notes: input.notes ?? null,
      campaignId: input.campaignId ?? null,
      scraperRunId: input.scraperRunId ?? null,
      dedupeKey,
      // Computed last so it cannot be overridden by anything above.
      ...scoreColumns({
        category: input.category,
        regionTier: input.regionTier,
        website: input.website ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
      }),
    },
  });
}

/**
 * Create, or return the existing lead when name+city already exists.
 *
 * This is the path the scraper and the CSV importer use. It reports which
 * happened so a scrape run can record `leadsCreated` against `leadsDuplicate`
 * rather than guessing.
 */
export async function createOrGetLead(
  input: LeadCreateInput,
  options: { updateExisting?: boolean } = {},
): Promise<{ lead: Lead; created: boolean; updated: boolean }> {
  const dedupeKey = buildDedupeKey(input.name, input.city);
  const existing = await prisma.lead.findUnique({ where: { dedupeKey } });

  if (existing) {
    if (!options.updateExisting) {
      return { lead: existing, created: false, updated: false };
    }

    // Enrich rather than overwrite: a re-scrape that found a phone number for a
    // lead we only had a name for is useful; one that nulls out a number a
    // human typed in is not. Only fill fields that are currently empty.
    const enrichment: Prisma.LeadUpdateInput = {};
    if (!existing.phone && input.phone) enrichment.phone = input.phone;
    if (!existing.email && input.email) enrichment.email = input.email;
    if (!existing.website && input.website) enrichment.website = input.website;
    if (!existing.notes && input.notes) enrichment.notes = input.notes;

    if (Object.keys(enrichment).length === 0) {
      return { lead: existing, created: false, updated: false };
    }

    const merged = {
      category: existing.category,
      regionTier: existing.regionTier,
      website: (enrichment.website as string | undefined) ?? existing.website,
      phone: (enrichment.phone as string | undefined) ?? existing.phone,
      email: (enrichment.email as string | undefined) ?? existing.email,
    };

    const lead = await prisma.lead.update({
      where: { id: existing.id },
      data: { ...enrichment, ...scoreColumns(merged) },
    });
    return { lead, created: false, updated: true };
  }

  try {
    return { lead: await createLead(input), created: true, updated: false };
  } catch (error) {
    // Lost a race with a concurrent insert of the same business — the unique
    // index did its job; treat it as the duplicate it is.
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    ) {
      const raced = await prisma.lead.findUnique({ where: { dedupeKey } });
      if (raced) return { lead: raced, created: false, updated: false };
    }
    throw error;
  }
}

export async function getLeadOrThrow(id: string): Promise<Lead> {
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead) throw ApiError.notFound('Lead');
  return lead;
}

export async function updateLead(id: string, input: LeadUpdateInput): Promise<Lead> {
  const existing = await getLeadOrThrow(id);

  const data: Prisma.LeadUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.category !== undefined) data.category = input.category;
  if (input.city !== undefined) data.city = input.city;
  if (input.regionTier !== undefined) data.regionTier = input.regionTier;
  if (input.phone !== undefined) data.phone = input.phone ?? null;
  if (input.email !== undefined) data.email = input.email ?? null;
  if (input.website !== undefined) data.website = input.website ?? null;
  if (input.source !== undefined) data.source = input.source;
  if (input.notes !== undefined) data.notes = input.notes ?? null;
  if (input.dealValue !== undefined) data.dealValue = numberToDecimal(input.dealValue ?? null);
  if (input.campaignId !== undefined) {
    data.campaign = input.campaignId ? { connect: { id: input.campaignId } } : { disconnect: true };
  }

  // Renaming or moving a lead changes its identity, so the dedupe key moves too.
  if (input.name !== undefined || input.city !== undefined) {
    data.dedupeKey = buildDedupeKey(input.name ?? existing.name, input.city ?? existing.city);
  }

  if (requiresRescore(input)) {
    Object.assign(
      data,
      scoreColumns({
        category: input.category ?? existing.category,
        regionTier: input.regionTier ?? existing.regionTier,
        website: input.website !== undefined ? input.website : existing.website,
        phone: input.phone !== undefined ? input.phone : existing.phone,
        email: input.email !== undefined ? input.email : existing.email,
      }),
    );
  }

  return prisma.lead.update({ where: { id }, data });
}

export async function deleteLead(id: string): Promise<void> {
  await getLeadOrThrow(id);
  // Interactions and documents cascade via the schema.
  await prisma.lead.delete({ where: { id } });
}

/**
 * Move a lead to a new stage.
 *
 * Transitions are not restricted to a forward-only path — real sales work goes
 * backwards, and someone who mis-clicked needs to be able to correct it. What
 * is enforced:
 *
 *  - a won deal must carry a value, or the pipeline and revenue figures lie
 *  - every move is recorded on the interaction timeline, so the history of a
 *    lead is auditable even though the transition itself was permissive
 */
export async function transitionStage(
  id: string,
  input: StageTransitionInput,
  userId: string | null,
): Promise<Lead> {
  const existing = await getLeadOrThrow(id);

  if (existing.stage === input.stage && input.dealValue === undefined) {
    return existing;
  }

  const dealValue =
    input.dealValue !== undefined ? numberToDecimal(input.dealValue) : existing.dealValue;

  if (input.stage === 'closed_won' && (dealValue === null || dealValue.equals(0))) {
    throw ApiError.unprocessable(
      'A won deal needs a deal value — revenue and close-rate reporting depend on it',
      [{ path: 'dealValue', message: 'Required when marking a deal won' }],
    );
  }

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.update({
      where: { id },
      data: { stage: input.stage, dealValue },
    });

    const movement =
      existing.stage === input.stage
        ? `Deal value updated at stage ${input.stage}`
        : `Stage changed: ${existing.stage} -> ${input.stage}`;

    await tx.interaction.create({
      data: {
        leadId: id,
        type: 'note',
        direction: 'internal',
        content: input.note ? `${movement}. ${input.note}` : movement,
        userId,
      },
    });

    return lead;
  });
}

// --- listing ---------------------------------------------------------------

function asArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  const arr = Array.isArray(value) ? value : [value];
  return arr.length > 0 ? arr : undefined;
}

export function buildLeadWhere(query: LeadListQuery): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {};

  const stages = asArray(query.stage);
  if (stages) where.stage = { in: stages };

  const sources = asArray(query.source);
  if (sources) where.source = { in: sources };

  const scores = asArray(query.score);
  if (scores) where.score = { in: scores };

  const tiers = asArray(query.regionTier);
  if (tiers) where.regionTier = { in: tiers };

  if (query.city) where.city = { equals: query.city, mode: 'insensitive' };
  if (query.campaignId) where.campaignId = query.campaignId;

  if (query.q) {
    const term = query.q.trim();
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { category: { contains: term, mode: 'insensitive' } },
      { city: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { website: { contains: term, mode: 'insensitive' } },
      { notes: { contains: term, mode: 'insensitive' } },
    ];
  }

  return where;
}

/**
 * Sort order.
 *
 * `score` needs special handling: the column is an enum whose Postgres sort
 * order is declaration order (high, medium, low), which happens to read
 * correctly descending but not ascending. Sorting by the numeric `scoreValue`
 * instead gives a stable, intuitive ordering in both directions.
 */
export function buildLeadOrderBy(query: LeadListQuery): Prisma.LeadOrderByWithRelationInput[] {
  const dir = query.sortDir;
  const primary: Prisma.LeadOrderByWithRelationInput =
    query.sortBy === 'score'
      ? { scoreValue: dir }
      : query.sortBy === 'dealValue'
        ? { dealValue: { sort: dir, nulls: 'last' } }
        : { [query.sortBy]: dir };

  // A deterministic tiebreak keeps pagination stable when many rows share a
  // sort value — without it, page 2 can repeat a row from page 1.
  return [primary, { id: 'asc' }];
}

export async function listLeads(query: LeadListQuery): Promise<{ items: Lead[]; total: number }> {
  const where = buildLeadWhere(query);

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: buildLeadOrderBy(query),
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.lead.count({ where }),
  ]);

  return { items, total };
}

/**
 * Recompute every lead's score against the current rules.
 *
 * Run after editing `scoring/rules.ts` — otherwise old leads keep the band they
 * were given under the old rules and the table becomes a mix of two schemes.
 */
export async function rescoreAllLeads(
  onProgress?: (done: number, total: number) => void,
): Promise<{ total: number; changed: number }> {
  const total = await prisma.lead.count();
  let done = 0;
  let changed = 0;
  const batchSize = 500;

  for (let skip = 0; skip < total; skip += batchSize) {
    const batch = await prisma.lead.findMany({
      skip,
      take: batchSize,
      orderBy: { id: 'asc' },
    });

    for (const lead of batch) {
      const next = scoreColumns(lead);
      if (next.score !== lead.score || next.scoreValue !== lead.scoreValue) {
        await prisma.lead.update({ where: { id: lead.id }, data: next });
        changed += 1;
      }
      done += 1;
    }

    onProgress?.(done, total);
  }

  return { total, changed };
}
