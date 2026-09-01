/**
 * BullMQ worker.
 *
 * Concurrency is 1 by design. Two browsers hammering the same directory from
 * one IP is precisely the behaviour that gets that IP blocked, and this system
 * has no proxy pool to fall back on.
 */

import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { env } from './config.js';
import { logger } from './lib/logger.js';
import { executeRun, type RunParams } from './runner.js';

const SCRAPE_QUEUE_NAME = 'scrape';

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

connection.on('error', (err) => logger.error({ err }, 'Redis connection error'));

const worker = new Worker<RunParams>(
  SCRAPE_QUEUE_NAME,
  async (job: Job<RunParams>) => {
    logger.info({ jobId: job.id, data: job.data }, 'Picked up scrape job');
    const outcome = await executeRun(job.data);

    // A geo-block is not retryable — retrying from the same host produces the
    // same block and just burns time. Fail the job loudly instead.
    if (outcome.status === 'geo_blocked') {
      throw new Error(`Geo-blocked: ${outcome.error ?? 'the target refused this host'}`);
    }

    return outcome;
  },
  {
    connection,
    concurrency: env.SCRAPER_CONCURRENCY,
    // A slow, polite run can legitimately take a long time; do not let BullMQ
    // decide it stalled and hand it to another worker.
    lockDuration: 30 * 60 * 1000,
    stalledInterval: 5 * 60 * 1000,
  },
);

worker.on('completed', (job, result) => {
  logger.info({ jobId: job.id, result }, 'Scrape job completed');
});

worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, err: error }, 'Scrape job failed');
});

logger.info(
  {
    queue: SCRAPE_QUEUE_NAME,
    concurrency: env.SCRAPER_CONCURRENCY,
    maxRequests: env.SCRAPER_MAX_REQUESTS_PER_RUN,
    delayMs: [env.SCRAPER_MIN_DELAY_MS, env.SCRAPER_MAX_DELAY_MS],
    geoCheck: env.SCRAPER_GEO_CHECK_ENABLED,
  },
  'Scraper worker ready',
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down worker');
  // Let an in-flight run finish rather than leaving a half-scraped run row.
  await worker.close();
  connection.disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
