/**
 * The API's error vocabulary.
 *
 * Every failure leaves a handler as an `ApiError` so the error handler can
 * produce one consistent body shape (`ApiErrorBody` in @lead/shared) rather
 * than leaking Fastify or Prisma internals to the client.
 */

import type { ZodError } from 'zod';

export interface FieldIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: FieldIssue[] | undefined;

  constructor(statusCode: number, code: string, message: string, details?: FieldIssue[]) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: FieldIssue[]): ApiError {
    return new ApiError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError(401, 'unauthorized', message);
  }

  static forbidden(message = 'You do not have access to this resource'): ApiError {
    return new ApiError(403, 'forbidden', message);
  }

  static notFound(what: string): ApiError {
    return new ApiError(404, 'not_found', `${what} not found`);
  }

  static conflict(message: string, details?: FieldIssue[]): ApiError {
    return new ApiError(409, 'conflict', message, details);
  }

  static unprocessable(message: string, details?: FieldIssue[]): ApiError {
    return new ApiError(422, 'unprocessable', message, details);
  }

  static serviceUnavailable(message: string): ApiError {
    return new ApiError(503, 'service_unavailable', message);
  }
}

/** Flatten a Zod failure into the field-level detail the frontend renders. */
export function zodIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export function validationError(error: ZodError, message = 'Validation failed'): ApiError {
  return ApiError.badRequest(message, zodIssues(error));
}
