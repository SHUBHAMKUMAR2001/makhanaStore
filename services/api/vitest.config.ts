import { defineConfig } from 'vitest/config';

function testDatabaseUrl(): string {
  const explicit = process.env['TEST_DATABASE_URL'];
  if (explicit) return explicit;

  const base = process.env['DATABASE_URL'];
  if (!base) return 'postgresql://lead:lead@localhost:5432/lead_engine_test?schema=public';

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '');
  if (!/test/.test(name)) url.pathname = `/${name}_test`;
  return url.toString();
}

export default defineConfig({
  test: {
    // The suite truncates tables, and resetDatabase() refuses to run unless
    // this is set — so set it here rather than relying on the caller to
    // remember an env var that protects their real data.
    // The suite TRUNCATEs every table, so it must never point at the
    // development database. TEST_DATABASE_URL wins if set; otherwise derive a
    // "<name>_test" sibling of DATABASE_URL rather than reusing it.
    env: {
      NODE_ENV: 'test',
      DISABLE_QUEUE: 'true',
      DATABASE_URL: testDatabaseUrl(),
    },
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Route tests share one Postgres database; running files in parallel would
    // have them truncating tables out from under each other.
    fileParallelism: false,
  },
});
