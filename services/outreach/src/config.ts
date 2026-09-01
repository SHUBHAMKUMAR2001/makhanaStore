import { z } from 'zod';

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  OUTREACH_PORT: z.coerce.number().int().min(1).max(65535).default(4200),
  OUTREACH_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  INTERNAL_API_TOKEN: z.string().min(32),

  /**
   * `log` sends nothing and records the message — the safe default until a
   * sending domain is verified. Nothing in the system assumes a real provider.
   */
  OUTREACH_PROVIDER: z.enum(['resend', 'smtp', 'log']).default('log'),
  OUTREACH_FROM_EMAIL: z.string().default(''),
  OUTREACH_FROM_NAME: z.string().default(''),
  OUTREACH_REPLY_TO: z.string().default(''),

  RESEND_API_KEY: z.string().default(''),

  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: booleanish,
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),

  WHATSAPP_ENABLED: booleanish,
});

function load() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid outreach environment configuration:\n${problems}`);
  }
  return parsed.data;
}

export const env = load();
