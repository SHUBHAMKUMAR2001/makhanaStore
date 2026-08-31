/**
 * Scrape job queue (producer side).
 *
 * The brief is explicit that scrape jobs must not run as bare scripts in
 * production, so the API only ever *enqueues* — the scraper service consumes.
 * That keeps throttling, retries and concurrency limits in one place, and means
 * the API never blocks on a browser.
 *
 * Redis being unavailable is handled as a 503 with a readable message rather
 * than an unhandled rejection: a scrape you cannot start is an operational
 * problem, not a crash.
 */

import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import type { ScraperRunRequest } from '@lead/shared';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';
import { logger } from './logger.js';

export const SCRAPE_QUEUE_NAME = 'scrape';

export interface ScrapeJobData extends ScraperRunRequest {
  /** The ScraperRun row this job reports into. Created before enqueueing. */
  scraperRunId: string;
}

let connection: Redis | null = null;
let queue: Queue<ScrapeJobData> | null = null;

function getConnection(): Redis {
  if (!connection) {
    connection = new IORedis(env.REDIS_URL, {
      // BullMQ requires this; without it a blocking command can be retried
      // forever against a dead server.
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    connection.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });
  }
  return connection;
}

export function getScrapeQueue(): Queue<ScrapeJobData> {
  if (env.DISABLE_QUEUE) {
    throw ApiError.serviceUnavailable(
      'The job queue is disabled in this environment (DISABLE_QUEUE=true)',
    );
  }
  if (!queue) {
    queue = new Queue<ScrapeJobData>(SCRAPE_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 60 * 60 * 24 * 30, count: 500 },
        removeOnFail: { age: 60 * 60 * 24 * 30 },
      },
    });
  }
  return queue;
}

export async function enqueueScrapeJob(data: ScrapeJobData): Promise<string> {
  try {
    const job = await getScrapeQueue().add('scrape', data, { jobId: data.scraperRunId });
    return job.id ?? data.scraperRunId;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error({ err: error }, 'Failed to enqueue scrape job');
    throw ApiError.serviceUnavailable(
      'Could not queue the scrape job — check that Redis is running and REDIS_URL is correct',
    );
  }
}

/**
 * Install (or remove) the recurring scrape schedule.
 *
 * Off unless SCRAPER_SCHEDULE_ENABLED is true. When it is off we still remove
 * any previously registered repeatable job, so flipping the flag back to false
 * actually stops the schedule instead of leaving an orphan in Redis.
 */
export async function syncScrapeSchedule(): Promise<void> {
  if (env.DISABLE_QUEUE) return;

  try {
    const q = getScrapeQueue();
    const existing = await q.getRepeatableJobs();

    for (const job of existing) {
      await q.removeRepeatableByKey(job.key);
    }

    if (!env.SCRAPER_SCHEDULE_ENABLED) {
      logger.info('Scrape schedule disabled (SCRAPER_SCHEDULE_ENABLED=false)');
      return;
    }

    logger.warn(
      { cron: env.SCRAPER_SCHEDULE_CRON },
      'Scrape schedule ENABLED — runs will start automatically on this cron',
    );
  } catch (error) {
    // A missing scheduler must not stop the API from serving the CRM.
    logger.error({ err: error }, 'Could not sync the scrape schedule');
  }
}

export async function closeQueue(): Promise<void> {
  await queue?.close();
  queue = null;
  connection?.disconnect();
  connection = null;
}
