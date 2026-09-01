/**
 * Outreach routes — a thin proxy to the outreach service.
 *
 * The API stays the only thing the browser talks to, and the outreach service
 * stays off the public network.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { outreachSendSchema, OUTREACH_CHANNELS } from '@lead/shared';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import { requireAuth } from '../plugins/auth.js';

async function callOutreach<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${env.OUTREACH_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': env.INTERNAL_API_TOKEN,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw ApiError.serviceUnavailable(
      'The outreach service is not reachable. Check that the outreach container is running.',
    );
  }

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = (parsed as { error?: { message?: string } } | null)?.error;
    throw new ApiError(
      response.status < 500 ? response.status : 502,
      'outreach_error',
      error?.message ?? 'Outreach request failed',
    );
  }
  return parsed as T;
}

const replySchema = z.object({
  leadId: z.string().cuid(),
  channel: z.enum(OUTREACH_CHANNELS).default('email'),
  content: z.string().trim().min(1).max(20_000),
});

export function registerOutreachRoutes(app: FastifyInstance): void {
  app.addHook('onRequest', requireAuth);

  /** Which channels can actually send — the UI uses this to disable buttons. */
  app.get('/outreach/providers', async () => callOutreach('/providers', undefined, 'GET'));

  app.post('/outreach/send', async (request, reply) => {
    const input = parseBody(outreachSendSchema, request.body);
    const result = await callOutreach('/outreach/send', input);
    return reply.status(202).send(result);
  });

  app.post('/outreach/reply', async (request, reply) => {
    const input = parseBody(replySchema, request.body);
    const result = await callOutreach('/outreach/reply', input);
    return reply.status(201).send(result);
  });
}
