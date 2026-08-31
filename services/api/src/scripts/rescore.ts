/**
 * Recompute every lead's score against the current rules.
 *
 * Run this after editing `scoring/rules.ts`. Without it, leads scored under the
 * old rules keep their old band and the table silently mixes two schemes —
 * which is exactly the drift the brief warns about.
 *
 * Run: pnpm --filter @lead/api rescore
 */

import { disconnectPrisma } from '@lead/db';
import { rescoreAllLeads } from '../services/leads.js';
import { logger } from '../lib/logger.js';

async function main(): Promise<void> {
  logger.info('Rescoring all leads against the current rules...');

  const { total, changed } = await rescoreAllLeads((done, all) => {
    if (done % 500 === 0 || done === all) logger.info(`  ${done}/${all}`);
  });

  logger.info({ total, changed }, changed === 0 ? 'All scores already current' : 'Rescore complete');
}

main()
  .catch((error: unknown) => {
    logger.error({ err: error }, 'Rescore failed');
    process.exitCode = 1;
  })
  .finally(() => void disconnectPrisma());
