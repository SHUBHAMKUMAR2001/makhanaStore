import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The suite truncates tables, and resetDatabase() refuses to run unless
    // this is set — so set it here rather than relying on the caller to
    // remember an env var that protects their real data.
    env: { NODE_ENV: 'test', DISABLE_QUEUE: 'true' },
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Route tests share one Postgres database; running files in parallel would
    // have them truncating tables out from under each other.
    fileParallelism: false,
  },
});
