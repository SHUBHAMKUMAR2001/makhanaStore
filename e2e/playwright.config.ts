import { defineConfig } from '@playwright/test';

/**
 * API smoke tests against a real running server.
 *
 * These use Playwright's `request` fixture rather than a browser: the flows the
 * brief calls critical — lead creation, stage transitions, scoring — are API
 * behaviours, and testing them over HTTP catches the things the in-process
 * vitest suite cannot: route registration, the auth hook order, cookie
 * handling, serialisation, and the rate limiter.
 *
 * No browser download is needed, so this stays fast enough for CI.
 */
const PORT = process.env['E2E_API_PORT'] ?? '4010';

export default defineConfig({
  testDir: './tests',
  // Seeds the sign-in account, so the suite does not depend on whatever ran
  // before it — the API integration tests truncate this same database.
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    extraHTTPHeaders: { 'Content-Type': 'application/json' },
  },

  // Boots the API itself, so `pnpm --filter @lead/e2e test` is one command.
  webServer: {
    command: 'pnpm --filter @lead/api dev',
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    env: {
      API_PORT: PORT,
      API_HOST: '127.0.0.1',
      NODE_ENV: 'test',
      DISABLE_QUEUE: 'true',
      LOG_LEVEL: 'silent',
    },
  },
});
