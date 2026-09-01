import type { FastifyInstance } from 'fastify';
import {
  campaignCreateSchema,
  campaignUpdateSchema,
  idParamSchema,
  scraperRunListQuerySchema,
  scraperRunRequestSchema,
  scraperRunUpdateSchema,
  SCRAPER_RUN_STATUSES,
  type ScraperRunStatus,
} from '@lead/shared';
import { numberToDecimal, prisma, type Prisma } from '@lead/db';
import { ApiError } from '../lib/errors.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import { serializeCampaign, serializeScraperRun } from '../lib/serialize.js';
import { requireAuth } from '../plugins/auth.js';
import { getCampaignStats } from '../services/stats.js';
import { enqueueScrapeJob } from '../lib/queue.js';
import { env } from '../config/env.js';

export function registerCampaignRoutes(app: FastifyInstance): void {
  app.addHook('onRequest', requireAuth);

  // --- campaigns -----------------------------------------------------------
  app.get('/campaigns', async () => {
    const campaigns = await prisma.campaign.findMany({ orderBy: { startedAt: 'desc' } });
    return Promise.all(
      campaigns.map(async (c) => serializeCampaign(c, await getCampaignStats(c.id))),
    );
  });

  app.post('/campaigns', async (request, reply) => {
    const input = parseBody(campaignCreateSchema, request.body);
    const campaign = await prisma.campaign.create({
      data: {
        name: input.name,
        channel: input.channel,
        sourceConfig: input.sourceConfig as Prisma.InputJsonValue,
        spend: numberToDecimal(input.spend ?? null),
        ...(input.startedAt ? { startedAt: input.startedAt } : {}),
        endedAt: input.endedAt ?? null,
      },
    });
    return reply.status(201).send(serializeCampaign(campaign, await getCampaignStats(campaign.id)));
  });

  app.patch('/campaigns/:id', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(campaignUpdateSchema, request.body);

    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
        ...(input.sourceConfig !== undefined
          ? { sourceConfig: input.sourceConfig as Prisma.InputJsonValue }
          : {}),
        ...(input.spend !== undefined ? { spend: numberToDecimal(input.spend) } : {}),
        ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
        ...(input.endedAt !== undefined ? { endedAt: input.endedAt } : {}),
      },
    });

    return serializeCampaign(campaign, await getCampaignStats(campaign.id));
  });

  app.delete('/campaigns/:id', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    // Leads keep existing; the schema sets their campaignId to null.
    await prisma.campaign.delete({ where: { id } });
    return reply.status(204).send();
  });

  // --- scraper runs --------------------------------------------------------
  app.get('/scraper-runs', async (request) => {
    const query = parseQuery(scraperRunListQuerySchema, request.query);

    const where: { source?: typeof query.source; status?: ScraperRunStatus } = {};
    if (query.source) where.source = query.source;
    if (query.status) {
      if (!(SCRAPER_RUN_STATUSES as readonly string[]).includes(query.status)) {
        throw ApiError.badRequest(`Unknown status "${query.status}"`);
      }
      where.status = query.status as ScraperRunStatus;
    }

    const [items, total] = await Promise.all([
      prisma.scraperRun.findMany({
        where,
        orderBy: { requestedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.scraperRun.count({ where }),
    ]);

    return {
      items: items.map(serializeScraperRun),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  });

  app.get('/scraper-runs/:id', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    const run = await prisma.scraperRun.findUnique({ where: { id } });
    if (!run) throw ApiError.notFound('Scraper run');
    return serializeScraperRun(run);
  });

  /**
   * Request a scrape.
   *
   * Creates the audit row first, then enqueues — so a job that never reaches
   * the worker still leaves a `queued` row explaining what was asked for,
   * rather than vanishing.
   */
  app.post('/scraper-runs', async (request, reply) => {
    const input = parseBody(scraperRunRequestSchema, request.body);

    const run = await prisma.scraperRun.create({
      data: {
        source: input.source,
        category: input.category,
        city: input.city,
        status: 'queued',
        campaignId: input.campaignId ?? null,
        config: {
          requestedBy: request.actor?.kind === 'user' ? request.actor.user.email : 'internal',
          maxRequests: input.maxRequests ?? null,
          regionTier: input.regionTier ?? null,
        },
      },
    });

    try {
      const jobId = await enqueueScrapeJob({ ...input, scraperRunId: run.id });
      const updated = await prisma.scraperRun.update({
        where: { id: run.id },
        data: { jobId },
      });
      return reply.status(202).send(serializeScraperRun(updated));
    } catch (error) {
      // The run row must reflect that this never started.
      await prisma.scraperRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Could not queue the job',
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  });

  /**
   * Progress update from the scraper worker.
   *
   * Restricted to internal service calls: this is the audit trail, and a
   * browser session has no business rewriting how a run turned out.
   */
  app.patch('/scraper-runs/:id', async (request) => {
    if (request.actor?.kind !== 'internal') {
      throw ApiError.forbidden('Scraper runs are updated by the scraper service, not by users');
    }

    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(scraperRunUpdateSchema, request.body);

    const run = await prisma.scraperRun.update({ where: { id }, data: input });
    return serializeScraperRun(run);
  });

  /** Operational visibility into whether the automatic schedule is on. */
  app.get('/scraper-runs/schedule', async () => ({
    enabled: env.SCRAPER_SCHEDULE_ENABLED,
    cron: env.SCRAPER_SCHEDULE_CRON,
    note: env.SCRAPER_SCHEDULE_ENABLED
      ? 'Scrapes start automatically on this schedule.'
      : 'Scrapes only run when you trigger them. Set SCRAPER_SCHEDULE_ENABLED=true to automate.',
  }));
}
