/**
 * Session authentication.
 *
 * Deliberately small: this is a single-business internal tool, so it uses an
 * opaque session id in an httpOnly signed cookie, backed by a `Session` row.
 * No JWTs, no refresh-token dance — a server-side session can be revoked
 * instantly, which is the property that actually matters here.
 *
 * Service-to-service calls (the scraper posting leads, docgen linking a file)
 * authenticate instead with `x-internal-token`. That path is checked in
 * constant time and never creates a session.
 */

import { timingSafeEqual } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma, type User } from '@lead/db';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';

export const SESSION_COOKIE = 'lead_session';

/** Who is making the request. `internal` is a trusted service, not a person. */
export type Actor =
  | { kind: 'user'; user: User }
  | { kind: 'internal' };

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }
}

export function hashPassword(plain: string): Promise<string> {
  return hash(plain);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    // A malformed hash in the database must read as "wrong password", not as a
    // 500 that tells an attacker something about the stored value.
    return false;
  }
}

/** Length-safe constant-time compare — `timingSafeEqual` throws on length mismatch. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so the failure is not measurably faster.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
  const session = await prisma.session.create({ data: { userId, expiresAt } });
  return { id: session.id, expiresAt: session.expiresAt };
}

export async function destroySession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Housekeeping so the Session table does not grow without bound. */
export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return count;
}

export function setSessionCookie(reply: FastifyReply, sessionId: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.IS_PRODUCTION,
    signed: true,
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Resolve the actor for a request without rejecting anonymous ones.
 * Attached as an onRequest hook so every handler and the rate limiter can see it.
 */
export async function resolveActor(request: FastifyRequest): Promise<void> {
  const internalToken = request.headers['x-internal-token'];
  if (typeof internalToken === 'string' && safeCompare(internalToken, env.INTERNAL_API_TOKEN)) {
    request.actor = { kind: 'internal' };
    return;
  }

  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return;

  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return;

  const session = await prisma.session.findUnique({
    where: { id: unsigned.value },
    include: { user: true },
  });

  if (!session) return;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Clean up as we go rather than relying solely on the periodic purge.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return;
  }

  request.actor = { kind: 'user', user: session.user };
}

/** Route guard: any authenticated actor, human or service. */
export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (!request.actor) {
    throw ApiError.unauthorized();
  }
}

/** Route guard: a signed-in human. Services cannot, for example, change a password. */
export function requireUser(request: FastifyRequest): User {
  if (request.actor?.kind !== 'user') {
    throw ApiError.unauthorized('This action requires a signed-in user');
  }
  return request.actor.user;
}

/** The acting user's id, or null for internal service calls. */
export function actorUserId(request: FastifyRequest): string | null {
  return request.actor?.kind === 'user' ? request.actor.user.id : null;
}
