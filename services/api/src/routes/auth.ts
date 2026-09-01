import type { FastifyInstance } from 'fastify';
import { changePasswordSchema, loginSchema } from '@lead/shared';
import { prisma } from '@lead/db';
import { ApiError } from '../lib/errors.js';
import { parseBody } from '../lib/validate.js';
import { serializeUser } from '../lib/serialize.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from '../plugins/auth.js';

export function registerAuthRoutes(app: FastifyInstance): void {
  /**
   * Login is rate limited harder than the rest of the API. Even a single-user
   * tool is worth protecting from a credential-stuffing script that finds the
   * host.
   */
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const { email, password } = parseBody(loginSchema, request.body);

      const user = await prisma.user.findUnique({ where: { email } });

      // Verify against a dummy hash when the user does not exist so the
      // response time does not reveal which emails are registered.
      const ok = user
        ? await verifyPassword(user.passwordHash, password)
        : await verifyPassword(
            '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            password,
          );

      if (!user || !ok) {
        request.log.warn({ email }, 'Failed login attempt');
        throw ApiError.unauthorized('Email or password is incorrect');
      }

      const session = await createSession(user.id);
      setSessionCookie(reply, session.id, session.expiresAt);

      return { user: serializeUser(user) };
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      if (unsigned.valid && unsigned.value) {
        await destroySession(unsigned.value);
      }
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  /** Who am I — used by the frontend to decide whether to show the login page. */
  app.get('/auth/me', async (request) => {
    if (request.actor?.kind !== 'user') {
      throw ApiError.unauthorized();
    }
    return { user: serializeUser(request.actor.user) };
  });

  app.post('/auth/change-password', async (request, reply) => {
    const user = requireUser(request);
    const { currentPassword, newPassword } = parseBody(changePasswordSchema, request.body);

    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw ApiError.unauthorized('Current password is incorrect');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    // Changing a password invalidates every existing session, including this
    // one — that is the point of changing it.
    await prisma.session.deleteMany({ where: { userId: user.id } });
    clearSessionCookie(reply);

    return { ok: true, message: 'Password changed. Please sign in again.' };
  });
}
