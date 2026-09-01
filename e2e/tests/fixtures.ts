/**
 * A worker-scoped signed-in API context.
 *
 * The first version of these tests signed in inside `beforeEach`, which tripped
 * the API's login rate limiter (10 attempts per 5 minutes) partway through the
 * run and failed three tests with a 429. That limiter is doing its job — a real
 * operator signs in once and reuses the session, so the tests should too.
 *
 * Worker-scoped means one sign-in per worker process, and the returned context
 * carries the session cookie for every request made through it.
 */

import {
  request as playwrightRequest,
  test as base,
  type APIRequestContext,
} from '@playwright/test';

interface Fixtures {
  /** An API context that is already signed in. */
  api: APIRequestContext;
}

interface WorkerFixtures {
  signedInContext: APIRequestContext;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  signedInContext: [
    async ({ playwright: _playwright }, use, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL!;
      const context = await playwrightRequest.newContext({
        baseURL,
        extraHTTPHeaders: { 'Content-Type': 'application/json' },
      });

      const email = process.env['E2E_ADMIN_EMAIL'] ?? process.env['ADMIN_EMAIL'];
      const password = process.env['E2E_ADMIN_PASSWORD'] ?? process.env['ADMIN_PASSWORD'];

      if (!email || !password) {
        throw new Error(
          'E2E needs credentials. Set ADMIN_EMAIL and ADMIN_PASSWORD (or the E2E_ ' +
            'equivalents) and make sure `pnpm db:seed` has created that account.',
        );
      }

      const response = await context.post('/auth/login', { data: { email, password } });

      if (!response.ok()) {
        throw new Error(
          `Sign-in failed (${response.status()}). ` +
            (response.status() === 429
              ? 'The login rate limiter is still cooling down from a previous run; wait a few minutes.'
              : 'Has `pnpm db:seed` run against the database this API is pointed at?'),
        );
      }

      await use(context);
      await context.dispose();
    },
    { scope: 'worker' },
  ],

  api: async ({ signedInContext }, use) => {
    await use(signedInContext);
  },
});

export { expect } from '@playwright/test';
