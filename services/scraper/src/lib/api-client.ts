/**
 * Client for the Lead Engine API.
 *
 * The scraper never touches the database directly. Every lead goes through the
 * API so it passes the same validation and gets scored by the same engine as a
 * hand-entered one — a second write path would be a second source of truth.
 */

import type { LeadSource, ScraperRunStatus } from '@lead/shared';
import { env } from '../config.js';
import { logger } from './logger.js';

export interface ScrapedLead {
  name: string;
  category: string;
  city: string;
  regionTier: number;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  notes?: string | null;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${env.API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': env.INTERNAL_API_TOKEN,
      ...init.headers,
    },
  });

  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ?? response.statusText;
    const error = new Error(`API ${response.status}: ${message}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return body as T;
}

/**
 * Push one scraped lead.
 *
 * Returns whether it was new. A 409 is the expected answer for a business we
 * already have — it is a duplicate, not a failure, and must not abort the run.
 */
export async function submitLead(
  lead: ScrapedLead,
  source: LeadSource,
  scraperRunId: string,
): Promise<'created' | 'duplicate' | 'failed'> {
  try {
    await call('/leads', {
      method: 'POST',
      body: JSON.stringify({ ...lead, source, scraperRunId }),
    });
    return 'created';
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 409) return 'duplicate';

    // A validation failure on one listing (a name that normalises to nothing,
    // say) should cost that listing, not the whole run.
    logger.warn({ err: error, lead: lead.name }, 'Lead rejected by the API');
    return 'failed';
  }
}

export interface RunUpdate {
  status?: ScraperRunStatus;
  startedAt?: string;
  finishedAt?: string;
  leadsFound?: number;
  leadsCreated?: number;
  leadsDuplicate?: number;
  requestsMade?: number;
  error?: string | null;
  errorDetail?: string | null;
}

export async function updateRun(runId: string, update: RunUpdate): Promise<void> {
  try {
    await call(`/scraper-runs/${runId}`, { method: 'PATCH', body: JSON.stringify(update) });
  } catch (error) {
    // Losing the audit update is bad but must not take the run down with it —
    // the leads already submitted are still worth keeping.
    logger.error({ err: error, runId }, 'Could not update the scraper run record');
  }
}
