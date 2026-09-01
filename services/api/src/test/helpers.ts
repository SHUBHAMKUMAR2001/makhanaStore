/**
 * Integration test harness.
 *
 * These tests run against a real Postgres database rather than a mock. Mocking
 * Prisma would not exercise the things most likely to break here: the unique
 * index behind lead de-duplication, enum constraints, and Decimal handling.
 *
 * Every test file truncates, so point DATABASE_URL at a throwaway database.
 */

import { prisma } from '@lead/db';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { createSession, hashPassword } from '../plugins/auth.js';

/**
 * Refuse to truncate anything that is not obviously a throwaway database.
 *
 * An earlier version only checked NODE_ENV, which vitest sets itself — so it
 * protected against nothing and the suite twice wiped the development
 * database. The database NAME is the thing the developer actually controls, so
 * that is what gets checked.
 */
function assertDisposableDatabase(): void {
  const url = process.env['DATABASE_URL'] ?? '';

  let databaseName = '';
  try {
    databaseName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error(`resetDatabase() refused to run: DATABASE_URL is not a valid URL (${url})`);
  }

  const looksDisposable = /(^|[_-])test($|[_-])|_test$|^test_/.test(databaseName);

  if (!looksDisposable && process.env['ALLOW_DESTRUCTIVE_TESTS'] !== 'true') {
    throw new Error(
      `resetDatabase() refused to run against database "${databaseName}".\n\n` +
        'This function TRUNCATEs every table. Point DATABASE_URL at a database whose\n' +
        'name contains "test" (e.g. lead_engine_test), or set\n' +
        'ALLOW_DESTRUCTIVE_TESTS=true if you really mean to wipe this one.',
    );
  }
}

export async function resetDatabase(): Promise<void> {
  assertDisposableDatabase();

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE "Interaction", "Document", "Lead", "ScraperRun", "Campaign",
                   "Session", "User", "PriceTier", "Product"
    RESTART IDENTITY CASCADE
  `);
}

export interface TestContext {
  app: FastifyInstance;
  /** Cookie header for an authenticated request. */
  auth: string;
  userId: string;
}

export async function createTestContext(): Promise<TestContext> {
  const app = await buildApp();
  await app.ready();

  const user = await prisma.user.create({
    data: {
      email: `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      passwordHash: await hashPassword('correct-horse-battery'),
      role: 'admin',
    },
  });

  const session = await createSession(user.id);

  // Sign the cookie the way the server would, so the round trip through
  // unsignCookie in resolveActor is genuinely exercised.
  const signed = app.signCookie(session.id);

  return { app, auth: `lead_session=${signed}`, userId: user.id };
}

export async function closeTestContext(ctx: TestContext): Promise<void> {
  await ctx.app.close();
}

/** A valid lead payload; override any field per test. */
export function leadPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Sharma Dry Fruits',
    category: 'Dry Fruit Wholesaler',
    city: 'Patna',
    regionTier: 2,
    phone: '+919876543210',
    source: 'manual',
    ...overrides,
  };
}
