/**
 * The single place an error becomes an HTTP response.
 *
 * Anything that is not an explicit `ApiError` is treated as a bug: it is logged
 * with its stack and reported as a generic 500. Internal error text never
 * reaches the client in production, where it could disclose query structure or
 * file paths.
 */

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@lead/db';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@lead/shared';
import { env } from '../config/env.js';
import { ApiError, zodIssues } from '../lib/errors.js';

function body(code: string, message: string, details?: ApiErrorBody['error']['details']): ApiErrorBody {
  return { error: details ? { code, message, details } : { code, message } };
}

/** Map the Prisma errors that represent a client mistake rather than a bug. */
function fromPrisma(error: Prisma.PrismaClientKnownRequestError): ApiError | null {
  switch (error.code) {
    case 'P2002': {
      const target = error.meta?.['target'];
      const fields = Array.isArray(target) ? target.join(', ') : String(target ?? 'field');
      // dedupeKey is the interesting one: it means "this lead already exists".
      if (fields.includes('dedupeKey')) {
        return ApiError.conflict(
          'A lead with this name already exists in this city',
          [{ path: 'name', message: 'Duplicate of an existing lead' }],
        );
      }
      return ApiError.conflict(`A record with this ${fields} already exists`, [
        { path: fields, message: 'Must be unique' },
      ]);
    }
    case 'P2003':
      return ApiError.badRequest('Referenced record does not exist');
    case 'P2025':
      return ApiError.notFound('Record');
    default:
      return null;
  }
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    void reply
      .status(404)
      .send(body('not_found', `Route ${request.method} ${request.url} does not exist`));
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) {
      void reply.status(error.statusCode).send(body(error.code, error.message, error.details));
      return;
    }

    if (error instanceof ZodError) {
      void reply.status(400).send(body('bad_request', 'Validation failed', zodIssues(error)));
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = fromPrisma(error);
      if (mapped) {
        void reply.status(mapped.statusCode).send(body(mapped.code, mapped.message, mapped.details));
        return;
      }
    }

    if (error instanceof Prisma.PrismaClientValidationError) {
      request.log.error({ err: error }, 'Prisma rejected a query — this is a bug');
      void reply.status(400).send(body('bad_request', 'The request could not be processed'));
      return;
    }

    // Fastify's own 4xx (bad JSON, payload too large, rate limit) carry a
    // usable statusCode and a safe message.
    const status = error.statusCode ?? 500;
    if (status < 500) {
      void reply.status(status).send(body(error.code ?? 'bad_request', error.message));
      return;
    }

    request.log.error({ err: error }, 'Unhandled error');
    void reply
      .status(500)
      .send(
        body(
          'internal_error',
          env.IS_PRODUCTION ? 'Something went wrong' : `Internal error: ${error.message}`,
        ),
      );
  });
}
