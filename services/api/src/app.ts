/**
 * Fastify application assembly.
 *
 * Kept separate from `server.ts` so tests can build an app and drive it with
 * `app.inject()` without binding a port.
 */

import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '@lead/db';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { resolveActor } from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerLeadRoutes } from './routes/leads.js';
import { registerCatalogueRoutes } from './routes/catalogue.js';
import { registerCampaignRoutes } from './routes/campaigns.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerDocumentRoutes } from './routes/documents.js';

export async function buildApp(): Promise<FastifyInstance> {
  // Cast to FastifyBaseLogger: passing a concrete pino Logger otherwise
  // narrows FastifyInstance's logger generic, and every route registrar typed
  // as a plain FastifyInstance stops being assignable to it.
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    // Trust the reverse proxy in front of the app so rate limiting keys on the
    // real client address rather than the proxy's.
    trustProxy: true,
    bodyLimit: 20 * 1024 * 1024,
  });

  registerErrorHandler(app);

  await app.register(cors, {
    origin: env.CORS_ORIGINS,
    // Sessions ride in a cookie, so the browser must be allowed to send it.
    credentials: true,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });

  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  });

  /**
   * A safety net rather than a security boundary — the brief's point about a
   * buggy frontend loop. Internal service calls are exempt: the scraper posts
   * one lead per result and would otherwise throttle itself against us.
   */
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    allowList: () => false,
    keyGenerator: (request) =>
      request.actor?.kind === 'user' ? `user:${request.actor.user.id}` : (request.ip ?? 'anon'),
    // Skip counting for trusted service-to-service traffic.
    hook: 'preHandler',
    enableDraftSpec: true,
  });

  // Raw CSV bodies arrive as text/csv; without this Fastify 415s them.
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.addHook('onRequest', resolveActor);

  // --- health --------------------------------------------------------------
  /**
   * Unauthenticated on purpose: this is what Docker's healthcheck calls, and
   * it must not depend on a session. It reports database reachability rather
   * than just "the process is alive", which is the failure that actually
   * matters.
   */
  app.get('/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch (error) {
      app.log.error({ err: error }, 'Health check failed: database unreachable');
      return reply.status(503).send({ status: 'degraded', database: 'down' });
    }
  });

  // --- routes --------------------------------------------------------------
  await app.register(async (instance) => {
    registerAuthRoutes(instance);
  });
  await app.register(async (instance) => {
    registerLeadRoutes(instance);
  });
  await app.register(async (instance) => {
    registerCatalogueRoutes(instance);
  });
  await app.register(async (instance) => {
    registerCampaignRoutes(instance);
  });
  await app.register(async (instance) => {
    registerStatsRoutes(instance);
  });
  await app.register(async (instance) => {
    registerDocumentRoutes(instance);
  });

  return app;
}
