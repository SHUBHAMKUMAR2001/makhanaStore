/**
 * Ensure the account the smoke tests sign in as actually exists.
 *
 * These tests share a database with the API's integration suite, which
 * TRUNCATEs every table — so running `pnpm -r test` and then the smoke tests
 * left them signing in against an empty User table and failing with a 401 that
 * looked like an auth bug.
 *
 * Seeding here makes the suite self-sufficient: it no longer depends on what
 * ran before it, in CI or locally.
 */

import { execFileSync } from 'node:child_process';

export default function globalSetup(): void {
  const email = process.env['E2E_ADMIN_EMAIL'] ?? process.env['ADMIN_EMAIL'];
  const password = process.env['E2E_ADMIN_PASSWORD'] ?? process.env['ADMIN_PASSWORD'];

  if (!email || !password) {
    throw new Error('E2E needs ADMIN_EMAIL and ADMIN_PASSWORD (or the E2E_ equivalents) set.');
  }

  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('E2E needs DATABASE_URL set.');

  // Refuse to seed a database that is not obviously disposable — the same
  // guard the API's test helper uses, for the same reason.
  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!/test/.test(databaseName) && process.env['ALLOW_DESTRUCTIVE_TESTS'] !== 'true') {
    throw new Error(
      `E2E refused to seed "${databaseName}". Point DATABASE_URL at a database ` +
        'whose name contains "test".',
    );
  }

  execFileSync('pnpm', ['--filter', '@lead/db', 'seed'], {
    stdio: 'inherit',
    env: { ...process.env, ADMIN_EMAIL: email, ADMIN_PASSWORD: password },
  });
}
