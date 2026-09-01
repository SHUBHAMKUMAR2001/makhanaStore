/**
 * Manual scrape CLI, for testing a source without going through the queue.
 *
 *   pnpm --filter @lead/scraper check-geo
 *   pnpm --filter @lead/scraper scrape -- --source indiamart --category Makhana --city Patna
 *
 * Production runs should go through the queue (the CRM's "Run a scrape"
 * button). This exists for debugging a selector change.
 */

import { parseArgs } from 'node:util';
import { SCRAPABLE_SOURCES, type LeadSource } from '@lead/shared';
import { detectCountry } from './lib/geo.js';
import { logger } from './lib/logger.js';
import { executeRun } from './runner.js';

async function checkGeo(): Promise<void> {
  const { country, checked } = await detectCountry();

  if (!checked) {
    console.log('Could not reach the IP geolocation service. No conclusion either way.');
    return;
  }

  if (country === 'IN') {
    console.log(`This host geolocates to ${country}. IndiaMART scraping should work.`);
  } else {
    console.log(
      `This host geolocates to ${country ?? 'an unknown country'}, NOT India.\n\n` +
        'IndiaMART redirects non-Indian traffic to a host that returns 403, and Justdial\n' +
        'serves a degraded page. Deploy the scraper to an Indian region — Oracle Cloud\n' +
        'Hyderabad or Mumbai. See services/scraper/README.md.',
    );
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'check-geo': { type: 'boolean', default: false },
      source: { type: 'string' },
      category: { type: 'string' },
      city: { type: 'string' },
      tier: { type: 'string', default: '3' },
      max: { type: 'string' },
      'run-id': { type: 'string' },
    },
  });

  if (values['check-geo']) {
    await checkGeo();
    return;
  }

  const source = values.source as LeadSource | undefined;
  if (!source || !(SCRAPABLE_SOURCES as readonly string[]).includes(source)) {
    console.error(
      `--source is required and must be one of: ${SCRAPABLE_SOURCES.join(', ')}\n\n` +
        'Example:\n  pnpm --filter @lead/scraper scrape -- \\\n' +
        '    --source indiamart --category "Dry Fruit Wholesaler" --city Patna --tier 2',
    );
    process.exitCode = 1;
    return;
  }

  if (!values.category || !values.city) {
    console.error('--category and --city are both required');
    process.exitCode = 1;
    return;
  }

  // Without a run id there is no audit row to update; api-client logs the
  // failed PATCH and the scrape still runs, which is what we want for a
  // one-off debug invocation.
  const runId = values['run-id'] ?? 'cli-adhoc';

  const outcome = await executeRun({
    scraperRunId: runId,
    source,
    category: values.category,
    city: values.city,
    regionTier: Number(values.tier),
    ...(values.max ? { maxRequests: Number(values.max) } : {}),
  });

  logger.info(outcome, 'CLI run finished');
  if (outcome.status === 'failed' || outcome.status === 'geo_blocked') process.exitCode = 1;
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'CLI failed');
  process.exit(1);
});
