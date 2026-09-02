/**
 * Scraper configuration.
 *
 * The throttling defaults exist because this system deliberately uses no
 * proxies and no paid scraping API — politeness is the only thing keeping it
 * working. Raising these numbers is how you get the source IP blocked.
 */

import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .default('true')
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  API_URL: z.string().default('http://localhost:4000'),
  INTERNAL_API_TOKEN: z
    .string()
    .min(32, 'INTERNAL_API_TOKEN is required for the scraper to post leads'),

  /** Hard ceiling on page requests per run. The single most important limit. */
  SCRAPER_MAX_REQUESTS_PER_RUN: z.coerce.number().int().min(1).max(2000).default(300),
  SCRAPER_MIN_DELAY_MS: z.coerce.number().int().min(0).default(3500),
  SCRAPER_MAX_DELAY_MS: z.coerce.number().int().min(0).default(9000),
  /** Requests between long pauses. */
  SCRAPER_BATCH_SIZE: z.coerce.number().int().min(1).default(40),
  SCRAPER_BATCH_PAUSE_MS: z.coerce.number().int().min(0).default(90_000),

  SCRAPER_HEADLESS: booleanish,

  /**
   * Path to an existing Chromium, when you do not want Puppeteer's bundled
   * download. Needed on hosts where the postinstall was skipped, on ARM images
   * that ship their own build, and anywhere a system Chromium already exists.
   *
   * Falls back to PUPPETEER_EXECUTABLE_PATH, which is the variable most Docker
   * images already set, so an existing setup keeps working without new config.
   */
  SCRAPER_CHROME_PATH: z.string().default(''),
  PUPPETEER_EXECUTABLE_PATH: z.string().default(''),
  SCRAPER_NAV_TIMEOUT_MS: z.coerce.number().int().min(1000).default(45_000),
  SCRAPER_GEO_CHECK_ENABLED: booleanish,

  /** Concurrency is 1 by design — see worker.ts. */
  SCRAPER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),

  GOOGLE_PLACES_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  GOOGLE_PLACES_API_KEY: z.string().default(''),
});

export type ScraperEnv = z.infer<typeof envSchema>;

function load(): ScraperEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid scraper environment configuration:\n${problems}`);
  }

  const value = parsed.data;

  if (value.SCRAPER_MIN_DELAY_MS > value.SCRAPER_MAX_DELAY_MS) {
    throw new Error(
      `SCRAPER_MIN_DELAY_MS (${value.SCRAPER_MIN_DELAY_MS}) cannot exceed ` +
        `SCRAPER_MAX_DELAY_MS (${value.SCRAPER_MAX_DELAY_MS})`,
    );
  }

  if (value.GOOGLE_PLACES_ENABLED && !value.GOOGLE_PLACES_API_KEY) {
    throw new Error(
      'GOOGLE_PLACES_ENABLED is true but GOOGLE_PLACES_API_KEY is empty. ' +
        'Set the key or turn the source off — it is optional and costs money.',
    );
  }

  return value;
}

export const env: ScraperEnv = load();

/** A realistic desktop UA. Stealth patches the rest of the fingerprint. */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';
