/**
 * API entrypoint.
 *
 * Boot order matters: the database is checked before the port opens, so a
 * misconfigured DATABASE_URL fails immediately and visibly instead of
 * producing a server that accepts requests and 500s all of them.
 */

import { assertDatabaseReachable, disconnectPrisma } from '@lead/db';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { closeQueue, syncScrapeSchedule } from './lib/queue.js';
import { purgeExpiredSessions } from './plugins/auth.js';

async function main(): Promise<void> {
  await assertDatabaseReachable();

  const purged = await purgeExpiredSessions();
  if (purged > 0) logger.info({ purged }, 'Purged expired sessions');

  await syncScrapeSchedule();

  const app = await buildApp();
  await app.listen({ port: env.API_PORT, host: env.API_HOST });

  logger.info(
    { port: env.API_PORT, env: env.NODE_ENV, corsOrigins: env.CORS_ORIGINS },
    'API listening',
  );

  /** Drain in-flight requests before exiting so a deploy does not drop them. */
  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    void (async () => {
      try {
        await app.close();
        await closeQueue();
        await disconnectPrisma();
        process.exit(0);
      } catch (error) {
        logger.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'API failed to start');
  process.exit(1);
});
