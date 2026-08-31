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

export async function resetDatabase(): Promise<void> {
  // This TRUNCATEs every table. Running the suite against a database holding
  // real leads would destroy them, and the only thing standing between those
  // two outcomes is which DATABASE_URL happened to be exported — so refuse
  // outright unless the environment says it is a test run.
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error(
      'resetDatabase() refused to run: NODE_ENV is ' +
        `"${process.env['NODE_ENV'] ?? 'unset'}", not "test". This function truncates every ` +
        'table. Run the suite with NODE_ENV=test and a throwaway DATABASE_URL.',
    );
  }

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
