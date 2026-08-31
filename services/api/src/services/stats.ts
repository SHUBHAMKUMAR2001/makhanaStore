/**
 * Dashboard aggregates.
 *
 * All of these are computed in the database rather than by pulling leads into
 * memory. On a single small VM that matters less for speed than for
 * predictability: the cost of the dashboard stays flat as the leads table grows.
 */

import { LEAD_SOURCES, LEAD_STAGES, OPEN_STAGES, type DashboardStats, type LeadScore, type LeadSource, type LeadStage } from '@lead/shared';
import { prisma, decimalToNumberOrZero } from '@lead/db';
import { serializeScraperRun } from '../lib/serialize.js';

/** won / (won + lost). Null when nothing has closed — not zero, which would read as failure. */
export function closeRate(won: number, lost: number): number | null {
  const closed = won + lost;
  return closed === 0 ? null : won / closed;
}

export async function getDashboardStats(options: { days?: number } = {}): Promise<DashboardStats> {
  const days = options.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  since.setHours(0, 0, 0, 0);

  const [byStage, bySourceStage, byScoreStage, byTierStage, leadsPerDay, recentRuns] =
    await Promise.all([
      prisma.lead.groupBy({
        by: ['stage'],
        _count: { _all: true },
        _sum: { dealValue: true },
      }),
      prisma.lead.groupBy({
        by: ['source', 'stage'],
        _count: { _all: true },
        _sum: { dealValue: true },
      }),
      prisma.lead.groupBy({ by: ['score', 'stage'], _count: { _all: true } }),
      prisma.lead.groupBy({ by: ['regionTier', 'stage'], _count: { _all: true } }),
      prisma.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS date, COUNT(*)::bigint AS count
        FROM "Lead"
        WHERE "createdAt" >= ${since}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      prisma.scraperRun.findMany({ orderBy: { requestedAt: 'desc' }, take: 10 }),
    ]);

  const countByStage = new Map<LeadStage, number>();
  const valueByStage = new Map<LeadStage, number>();
  for (const row of byStage) {
    countByStage.set(row.stage, row._count._all);
    valueByStage.set(row.stage, decimalToNumberOrZero(row._sum.dealValue));
  }

  const totalLeads = [...countByStage.values()].reduce((a, b) => a + b, 0);
  const won = countByStage.get('closed_won') ?? 0;
  const lost = countByStage.get('closed_lost') ?? 0;
  const revenue = valueByStage.get('closed_won') ?? 0;
  const pipelineValue = OPEN_STAGES.reduce((sum, stage) => sum + (valueByStage.get(stage) ?? 0), 0);
  const openLeads = OPEN_STAGES.reduce((sum, stage) => sum + (countByStage.get(stage) ?? 0), 0);

  // --- per source ----------------------------------------------------------
  const sourceRows = new Map<
    LeadSource,
    { leads: number; contacted: number; replied: number; won: number; lost: number; revenue: number; pipelineValue: number }
  >();
  for (const source of LEAD_SOURCES) {
    sourceRows.set(source, {
      leads: 0,
      contacted: 0,
      replied: 0,
      won: 0,
      lost: 0,
      revenue: 0,
      pipelineValue: 0,
    });
  }

  /** Stages at or past "contacted" — a lead that reached them was worked. */
  const contactedOrBeyond = new Set<LeadStage>(
    LEAD_STAGES.slice(LEAD_STAGES.indexOf('contacted')),
  );
  const repliedOrBeyond = new Set<LeadStage>(LEAD_STAGES.slice(LEAD_STAGES.indexOf('replied')));

  for (const row of bySourceStage) {
    const entry = sourceRows.get(row.source);
    if (!entry) continue;
    const count = row._count._all;
    const value = decimalToNumberOrZero(row._sum.dealValue);

    entry.leads += count;
    if (contactedOrBeyond.has(row.stage)) entry.contacted += count;
    if (repliedOrBeyond.has(row.stage)) entry.replied += count;
    if (row.stage === 'closed_won') {
      entry.won += count;
      entry.revenue += value;
    }
    if (row.stage === 'closed_lost') entry.lost += count;
    if ((OPEN_STAGES as readonly LeadStage[]).includes(row.stage)) entry.pipelineValue += value;
  }

  // --- per score band ------------------------------------------------------
  const scoreRows = new Map<LeadScore, { count: number; won: number }>([
    ['high', { count: 0, won: 0 }],
    ['medium', { count: 0, won: 0 }],
    ['low', { count: 0, won: 0 }],
  ]);
  for (const row of byScoreStage) {
    const entry = scoreRows.get(row.score);
    if (!entry) continue;
    entry.count += row._count._all;
    if (row.stage === 'closed_won') entry.won += row._count._all;
  }

  // --- per region tier -----------------------------------------------------
  const tierRows = new Map<number, { count: number; won: number }>();
  for (const row of byTierStage) {
    const entry = tierRows.get(row.regionTier) ?? { count: 0, won: 0 };
    entry.count += row._count._all;
    if (row.stage === 'closed_won') entry.won += row._count._all;
    tierRows.set(row.regionTier, entry);
  }

  // --- leads over time -----------------------------------------------------
  // Fill the gaps so the chart shows a flat line on quiet days rather than
  // joining across them and implying activity that did not happen.
  const counts = new Map(
    leadsPerDay.map((r) => [r.date.toISOString().slice(0, 10), Number(r.count)]),
  );
  const leadsOverTime: { date: string; count: number }[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    leadsOverTime.push({ date: key, count: counts.get(key) ?? 0 });
  }

  return {
    totals: {
      leads: totalLeads,
      openLeads,
      won,
      lost,
      pipelineValue,
      revenue,
      closeRate: closeRate(won, lost),
      averageDealValue: won === 0 ? null : revenue / won,
    },
    funnel: LEAD_STAGES.map((stage) => ({
      stage,
      count: countByStage.get(stage) ?? 0,
      value: valueByStage.get(stage) ?? 0,
    })),
    bySource: LEAD_SOURCES.map((source) => {
      const entry = sourceRows.get(source)!;
      return { source, ...entry, closeRate: closeRate(entry.won, entry.lost) };
    }).filter((row) => row.leads > 0),
    byScore: (['high', 'medium', 'low'] as const).map((score) => ({
      score,
      ...scoreRows.get(score)!,
    })),
    byRegionTier: [...tierRows.entries()]
      .sort(([a], [b]) => a - b)
      .map(([regionTier, v]) => ({ regionTier, ...v })),
    leadsOverTime,
    recentRuns: recentRuns.map(serializeScraperRun),
  };
}

/** Per-campaign roll-up used by the campaigns page. */
export async function getCampaignStats(campaignId: string): Promise<{
  leadCount: number;
  wonCount: number;
  pipelineValue: number;
  revenue: number;
}> {
  const rows = await prisma.lead.groupBy({
    by: ['stage'],
    where: { campaignId },
    _count: { _all: true },
    _sum: { dealValue: true },
  });

  let leadCount = 0;
  let wonCount = 0;
  let pipelineValue = 0;
  let revenue = 0;

  for (const row of rows) {
    leadCount += row._count._all;
    const value = decimalToNumberOrZero(row._sum.dealValue);
    if (row.stage === 'closed_won') {
      wonCount += row._count._all;
      revenue += value;
    }
    if ((OPEN_STAGES as readonly LeadStage[]).includes(row.stage)) pipelineValue += value;
  }

  return { leadCount, wonCount, pipelineValue, revenue };
}
