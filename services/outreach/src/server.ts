/**
 * Outreach service.
 *
 * Not exposed to browsers — the API proxies to it, and every route requires
 * the internal token.
 */

import Fastify, { type FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { assertDatabaseReachable, disconnectPrisma, prisma } from '@lead/db';
import { outreachSendSchema, OUTREACH_CHANNELS } from '@lead/shared';
import { env } from './config.js';
import { logger } from './logger.js';
import { describeProviders } from './providers/index.js';
import { LeadNotFoundError, recordReply, sendOutreach } from './send.js';

const replySchema = z.object({
  leadId: z.string().cuid(),
  channel: z.enum(OUTREACH_CHANNELS).default('email'),
  content: z.string().trim().min(1).max(20_000),
});

export async function buildOutreachApp() {
  const app = Fastify({ loggerInstance: logger as FastifyBaseLogger });

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    if (request.headers['x-internal-token'] !== env.INTERNAL_API_TOKEN) {
      await reply
        .status(401)
        .send({ error: { code: 'unauthorized', message: 'Internal token required' } });
    }
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof LeadNotFoundError) {
      void reply.status(404).send({ error: { code: 'not_found', message: error.message } });
      return;
    }
    if (error instanceof z.ZodError) {
      void reply.status(400).send({
        error: {
          code: 'bad_request',
          message: 'Validation failed',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    request.log.error({ err: error }, 'Outreach request failed');
    void reply.status(500).send({
      error: {
        code: 'internal_error',
        message: error instanceof Error ? error.message : 'Something went wrong',
      },
    });
  });

  app.get('/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return reply.status(503).send({ status: 'degraded', database: 'down' });
    }
  });

  /** What can actually send right now, and why not if it cannot. */
  app.get('/providers', async () => ({ providers: describeProviders() }));

  app.post('/outreach/send', async (request, reply) => {
    const input = outreachSendSchema.parse(request.body);
    const outcome = await sendOutreach(input);
    return reply.status(202).send(outcome);
  });

  app.post('/outreach/reply', async (request, reply) => {
    const input = replySchema.parse(request.body);
    const outcome = await recordReply(input.leadId, input.content, input.channel);
    return reply.status(201).send(outcome);
  });

  return app;
}

async function main(): Promise<void> {
  await assertDatabaseReachable();
  const app = await buildOutreachApp();
  await app.listen({ port: env.OUTREACH_PORT, host: env.OUTREACH_HOST });

  for (const p of describeProviders()) {
    if (p.configured) {
      logger.info({ channel: p.channel, provider: p.provider }, 'Outreach channel ready');
    } else {
      // Warn, loudly and at boot: a provider that silently cannot send is the
      // failure you discover a week later when nobody has replied.
      logger.warn({ channel: p.channel, provider: p.provider, reason: p.reason }, 'Outreach channel NOT available');
    }
  }

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    void app.close().then(disconnectPrisma).then(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (process.env['OUTREACH_NO_LISTEN'] !== 'true') {
  main().catch((error: unknown) => {
    logger.fatal({ err: error }, 'Outreach failed to start');
    process.exit(1);
  });
}
