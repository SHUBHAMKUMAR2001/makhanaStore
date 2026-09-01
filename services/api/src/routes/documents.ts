/**
 * Document routes.
 *
 * The API is the only thing the browser talks to, so it proxies generation to
 * the docgen service and streams downloads back. Docgen itself is never
 * exposed publicly.
 */

import type { FastifyInstance } from 'fastify';
import {
  documentListQuerySchema,
  idParamSchema,
  presentationRequestSchema,
  quotationRequestSchema,
} from '@lead/shared';
import { prisma } from '@lead/db';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import { serializeDocument } from '../lib/serialize.js';
import { requireAuth } from '../plugins/auth.js';

/** Forward a request to docgen, translating its failures into ours. */
async function callDocgen<T>(path: string, body: unknown): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${env.DOCGEN_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': env.INTERNAL_API_TOKEN,
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw ApiError.serviceUnavailable(
      'The document service is not reachable. Check that the docgen container is running.',
    );
  }

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = (parsed as { error?: { message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(
      response.status < 500 ? response.status : 502,
      'docgen_error',
      error?.message ?? 'Document generation failed',
      error?.details as { path: string; message: string }[] | undefined,
    );
  }

  return parsed as T;
}

export function registerDocumentRoutes(app: FastifyInstance): void {
  app.addHook('onRequest', requireAuth);

  app.get('/documents', async (request) => {
    const query = parseQuery(documentListQuerySchema, request.query);
    const documents = await prisma.document.findMany({
      where: {
        ...(query.leadId ? { leadId: query.leadId } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return documents.map(serializeDocument);
  });

  app.post('/documents/quotation', async (request, reply) => {
    const input = parseBody(quotationRequestSchema, request.body);
    const result = await callDocgen('/documents/quotation', input);
    return reply.status(201).send(result);
  });

  app.post('/documents/presentation', async (request, reply) => {
    const input = parseBody(presentationRequestSchema, request.body);
    const result = await callDocgen('/documents/presentation', input);
    return reply.status(201).send(result);
  });

  /**
   * Stream a generated file back through the API, so the browser never needs a
   * route to docgen and the download inherits the session check above.
   */
  app.get('/documents/:id/download', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);

    const document = await prisma.document.findUnique({ where: { id } });
    if (!document) throw ApiError.notFound('Document');

    let upstream: Response;
    try {
      upstream = await fetch(`${env.DOCGEN_URL}/documents/${id}/download`, {
        headers: { 'x-internal-token': env.INTERNAL_API_TOKEN },
      });
    } catch {
      throw ApiError.serviceUnavailable('The document service is not reachable');
    }

    if (!upstream.ok) {
      throw new ApiError(
        upstream.status === 410 ? 410 : 502,
        'document_unavailable',
        upstream.status === 410
          ? 'The generated file is no longer on disk. Regenerate it.'
          : 'Could not retrieve the document',
      );
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    return reply
      .header('Content-Type', document.mimeType)
      .header('Content-Disposition', `attachment; filename="${document.filename}"`)
      .send(buffer);
  });

  app.delete('/documents/:id', async (request, reply) => {
    const { id } = parseParams(idParamSchema, request.params);
    await prisma.document.delete({ where: { id } });
    return reply.status(204).send();
  });
}
