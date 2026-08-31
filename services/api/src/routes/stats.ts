import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseQuery } from '../lib/validate.js';
import { requireAuth } from '../plugins/auth.js';
import { getDashboardStats } from '../services/stats.js';

const statsQuerySchema = z.object({
  /** Trailing window for the leads-over-time series. */
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export function registerStatsRoutes(app: FastifyInstance): void {
  app.addHook('onRequest', requireAuth);

  app.get('/stats/dashboard', async (request) => {
    const { days } = parseQuery(statsQuerySchema, request.query);
    return getDashboardStats({ days });
  });
}
