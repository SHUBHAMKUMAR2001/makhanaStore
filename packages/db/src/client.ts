import { PrismaClient } from '../generated/client/index.js';

export * from '../generated/client/index.js';

/**
 * A single PrismaClient per process.
 *
 * The `globalThis` cache exists for dev only: `tsx watch` reloads the module
 * graph on every save, and without it each reload opens a fresh connection
 * pool until Postgres refuses new connections.
 */
const globalForPrisma = globalThis as unknown as { __leadPrisma?: PrismaClient };

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['warn', 'error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.__leadPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__leadPrisma = prisma;
}

/** Fail fast at boot with a clear message rather than on the first query. */
export async function assertDatabaseReachable(): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (cause) {
    throw new Error(
      'Cannot reach the database. Check DATABASE_URL and that Postgres is running ' +
        '(`docker compose up postgres`).',
      { cause },
    );
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
