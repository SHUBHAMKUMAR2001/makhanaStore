/**
 * Run orchestration.
 *
 * Every path out of here — success, geo-block, parser break, crash — updates
 * the ScraperRun row before returning. That is the whole point of the audit
 * table: a run that finds nothing must leave a record saying why.
 */

import type { Browser } from 'puppeteer';
import type { LeadSource, ScraperRunStatus } from '@lead/shared';
import { env } from './config.js';
import { logger } from './lib/logger.js';
import { closeBrowser, launchBrowser, newPage } from './lib/browser.js';
import { GeoBlockedError, detectCountry } from './lib/geo.js';
import { RequestBudgetExhausted, Throttle } from './lib/throttle.js';
import { submitLead, updateRun, type ScrapedLead } from './lib/api-client.js';
import { scrapeIndiamart } from './sources/indiamart.js';
import { scrapeSelectorSite } from './sources/selector-site.js';
import { scrapeGooglePlaces, isEnabled as placesEnabled } from './sources/google-places.js';
import { SITE_SELECTORS } from './sources/selectors.js';

export interface RunParams {
  scraperRunId: string;
  source: LeadSource;
  category: string;
  city: string;
  regionTier?: number | undefined;
  maxRequests?: number | undefined;
}

export interface RunOutcome {
  status: ScraperRunStatus;
  leadsFound: number;
  leadsCreated: number;
  leadsDuplicate: number;
  requestsMade: number;
  error?: string;
}

/** Pages to attempt. The throttle's request cap is the real limit. */
const MAX_PAGES = 25;

export async function executeRun(params: RunParams): Promise<RunOutcome> {
  const regionTier = params.regionTier ?? 3;
  const maxRequests = Math.min(
    params.maxRequests ?? env.SCRAPER_MAX_REQUESTS_PER_RUN,
    env.SCRAPER_MAX_REQUESTS_PER_RUN,
  );

  const throttle = new Throttle({
    minDelayMs: env.SCRAPER_MIN_DELAY_MS,
    maxDelayMs: env.SCRAPER_MAX_DELAY_MS,
    batchSize: env.SCRAPER_BATCH_SIZE,
    batchPauseMs: env.SCRAPER_BATCH_PAUSE_MS,
    maxRequests,
  });

  const log = logger.child({ runId: params.scraperRunId, source: params.source });

  await updateRun(params.scraperRunId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });

  log.info({ category: params.category, city: params.city, maxRequests }, 'Scrape run starting');

  let browser: Browser | null = null;

  try {
    // Fail fast on the geo-wall rather than burning throttled requests to
    // discover the same thing five minutes in.
    if (env.SCRAPER_GEO_CHECK_ENABLED && params.source !== 'google_maps') {
      const { country, checked } = await detectCountry();
      if (checked && country && country !== 'IN') {
        throw new GeoBlockedError(
          `This host appears to be in ${country}, not India. IndiaMART and Justdial ` +
            'serve non-Indian traffic a blocked page. Deploy to an Indian region ' +
            '(Oracle Cloud Hyderabad or Mumbai) — see services/scraper/README.md.',
          `ipapi country_code=${country}`,
        );
      }
      if (!checked) {
        // Not evidence either way — the lookup service could simply be down.
        log.warn('Could not determine the host country; continuing without the pre-flight check');
      } else {
        log.info({ country }, 'Pre-flight geo check passed');
      }
    }

    let result: { leads: ScrapedLead[]; pagesFetched: number };
    const scrapeParams = {
      category: params.category,
      city: params.city,
      regionTier,
      maxPages: MAX_PAGES,
    };

    if (params.source === 'google_maps') {
      if (!placesEnabled()) {
        throw new Error(
          'Google Places is not enabled. It is an optional, billed source — set ' +
            'GOOGLE_PLACES_ENABLED=true and GOOGLE_PLACES_API_KEY to use it.',
        );
      }
      result = await scrapeGooglePlaces(scrapeParams, throttle);
    } else {
      browser = await launchBrowser();
      const page = await newPage(browser);

      if (params.source === 'indiamart') {
        result = await scrapeIndiamart(page, scrapeParams, throttle);
      } else if (params.source === 'justdial' || params.source === 'tradeindia') {
        result = await scrapeSelectorSite(
          page,
          SITE_SELECTORS[params.source],
          scrapeParams,
          throttle,
        );
      } else {
        throw new Error(`Source "${params.source}" is not scrapable`);
      }
    }

    log.info({ found: result.leads.length }, 'Submitting leads to the API');

    let created = 0;
    let duplicate = 0;
    let failed = 0;

    for (const lead of result.leads) {
      const outcome = await submitLead(lead, params.source, params.scraperRunId);
      if (outcome === 'created') created += 1;
      else if (outcome === 'duplicate') duplicate += 1;
      else failed += 1;
    }

    // Hitting the cap is a distinct, expected outcome — it means there was
    // more to find, not that the run was complete.
    const status: ScraperRunStatus = throttle.exhausted ? 'capped' : 'completed';

    const outcome: RunOutcome = {
      status,
      leadsFound: result.leads.length,
      leadsCreated: created,
      leadsDuplicate: duplicate,
      requestsMade: throttle.requestsMade,
    };

    await updateRun(params.scraperRunId, {
      ...outcome,
      finishedAt: new Date().toISOString(),
      error: failed > 0 ? `${failed} listing(s) were rejected by the API` : null,
    });

    log.info({ ...outcome, failed }, 'Scrape run finished');
    return outcome;
  } catch (error) {
    const isGeo = error instanceof GeoBlockedError;
    const isCapped = error instanceof RequestBudgetExhausted;
    const message = error instanceof Error ? error.message : String(error);

    const status: ScraperRunStatus = isGeo ? 'geo_blocked' : isCapped ? 'capped' : 'failed';

    // Geo-blocking is the failure most likely to be misdiagnosed as "the
    // scraper found nothing", so it is logged at error level with the remedy.
    if (isGeo) {
      log.error({ evidence: (error as GeoBlockedError).evidence }, `GEO-BLOCKED: ${message}`);
    } else {
      log.error({ err: error }, 'Scrape run failed');
    }

    await updateRun(params.scraperRunId, {
      status,
      finishedAt: new Date().toISOString(),
      requestsMade: throttle.requestsMade,
      error: message.slice(0, 500),
      errorDetail:
        error instanceof Error ? (error.stack ?? '').slice(0, 2000) : String(error).slice(0, 2000),
    });

    return {
      status,
      leadsFound: 0,
      leadsCreated: 0,
      leadsDuplicate: 0,
      requestsMade: throttle.requestsMade,
      error: message,
    };
  } finally {
    await closeBrowser(browser);
  }
}
