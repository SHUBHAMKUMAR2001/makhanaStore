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
    .min(
      32,
      'SESSION_SECRET must be at least 32 characters — generate one with `openssl rand -hex 32`',
    ),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .default(720),

  INTERNAL_API_TOKEN: z
    .string()
    .min(
      32,
      'INTERNAL_API_TOKEN must be at least 32 characters — generate one with `openssl rand -hex 32`',
    ),

  /**
   * The origin users actually reach the app on — e.g. https://leads.example.com
   * in production, or http://203.0.113.10 for an IP-only deployment.
   *
   * This drives the session cookie's Secure flag. Tying it to the real origin
   * rather than to NODE_ENV avoids the failure that flag otherwise causes: with
   * `secure: true` on a plain-HTTP deployment the browser silently discards the
   * cookie, so login appears to succeed and every subsequent request 401s,
   * which reads as "auth is broken" rather than "you need TLS".
   */
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),

  /** Comma-separated. Credentialed CORS forbids `*`, so this must be explicit. */
  CORS_ORIGINS: z.string().default(''),

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
  /** True when PUBLIC_URL is https — see the note on PUBLIC_URL above. */
  COOKIE_SECURE: boolean;
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

  // Default CORS to the public origin. Behind the bundled reverse proxy the
  // browser only ever sees one origin, so this list is usually empty in
  // practice — but a same-origin entry is the safe default, not '*'.
  const origins = value.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    ...value,
    CORS_ORIGINS: origins.length > 0 ? origins : [value.PUBLIC_URL.replace(/\/$/, '')],
    IS_PRODUCTION: value.NODE_ENV === 'production',
    IS_TEST: value.NODE_ENV === 'test',
    COOKIE_SECURE: value.PUBLIC_URL.startsWith('https://'),
  };
}

export const env: Env = load();
