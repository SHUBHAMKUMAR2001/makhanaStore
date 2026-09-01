import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DOCGEN_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  DOCGEN_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  /** Where generated .docx / .pptx files are written. */
  STORAGE_DIR: z.string().default('/data/storage'),
  INTERNAL_API_TOKEN: z.string().min(32),
});

function load() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid docgen environment configuration:\n${problems}`);
  }
  return parsed.data;
}

export const env = load();
