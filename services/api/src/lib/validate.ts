/**
 * Request parsing helpers.
 *
 * Every endpoint runs its input through a zod schema from @lead/shared before
 * touching the database — a malformed CSV row or a hand-rolled curl call is
 * rejected at the boundary, not halfway through a write.
 *
 * These are thin wrappers rather than a Fastify type-provider so the failure
 * body matches `ApiErrorBody` exactly, including per-field `details`, which is
 * what the frontend's form error rendering depends on.
 */

import type { z } from 'zod';
import { validationError } from './errors.js';

export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw validationError(result.error, 'Request body is invalid');
  }
  return result.data;
}

export function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw validationError(result.error, 'Query parameters are invalid');
  }
  return result.data;
}

export function parseParams<T extends z.ZodTypeAny>(schema: T, params: unknown): z.infer<T> {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw validationError(result.error, 'URL parameters are invalid');
  }
  return result.data;
}

/**
 * Normalise a query value that may arrive once or many times.
 * `?stage=quoted` and `?stage=quoted&stage=replied` both become an array.
 */
export function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}
