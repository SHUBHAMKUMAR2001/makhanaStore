/**
 * Environment configuration, validated once at boot.
 *
 * Everything the API needs is parsed here so a missing or malformed variable
 * fails immediately with a readable message, rather than surfacing as a
 * confusing runtime error on the first request that happens to need it.
 */

import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters — generate one with `openssl rand -hex 32`'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 365).default(720),

  INTERNAL_API_TOKEN: z
    .string()
    .min(32, 'INTERNAL_API_TOKEN must be at least 32 characters — generate one with `openssl rand -hex 32`'),

  /** Comma-separated. Credentialed CORS forbids `*`, so this must be explicit. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  DOCGEN_URL: z.string().default('http://localhost:4100'),
  OUTREACH_URL: z.string().default('http://localhost:4200'),
  STORAGE_DIR: z.string().default('/data/storage'),

  SCRAPER_SCHEDULE_ENABLED: booleanish,
  SCRAPER_SCHEDULE_CRON: z.string().default('0 3 1 * *'),

  /** Disables the Redis connection entirely — used by the test suite. */
  DISABLE_QUEUE: booleanish,
});

export type Env = Omit<z.infer<typeof envSchema>, 'CORS_ORIGINS'> & {
  CORS_ORIGINS: string[];
  IS_PRODUCTION: boolean;
  IS_TEST: boolean;
};

function load(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid API environment configuration:\n${problems}`);
  }

  const value = parsed.data;
  return {
    ...value,
    CORS_ORIGINS: value.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    IS_PRODUCTION: value.NODE_ENV === 'production',
    IS_TEST: value.NODE_ENV === 'test',
  };
}

export const env: Env = load();
