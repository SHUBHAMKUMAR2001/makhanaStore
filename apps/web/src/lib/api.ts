/**
 * API client.
 *
 * One place that knows how to talk to the backend, so error handling and the
 * credentials setting are not restated in every hook. `credentials: 'include'`
 * is what carries the session cookie.
 */

import type { ApiErrorBody } from '@lead/shared';

const BASE = import.meta.env['VITE_API_URL'] ?? '/api';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: { path: string; message: string }[];

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error?.message ?? fallback);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = body?.error?.code ?? 'unknown';
    this.details = body?.error?.details ?? [];
  }

  /** Message for a specific form field, if the API reported one. */
  fieldError(path: string): string | undefined {
    return this.details.find((d) => d.path === path)?.message;
  }
}

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiClientError && error.status === 401;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // A non-JSON body from a proxy or crash — fall through to the raw text.
    }
  }

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      parsed as ApiErrorBody | null,
      text || response.statusText,
    );
  }

  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Raw text upload, used by the CSV importer. */
  postCsv: <T>(path: string, csv: string) =>
    request<T>(path, { method: 'POST', body: csv, headers: { 'Content-Type': 'text/csv' } }),
};

/** Build a query string, dropping empty values and expanding arrays. */
export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, String(v));
    } else {
      search.set(key, String(value));
    }
  }
  const str = search.toString();
  return str ? `?${str}` : '';
}
