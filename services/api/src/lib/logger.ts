import { pino, type LoggerOptions } from 'pino';
import { env } from '../config/env.js';

/**
 * Structured logging.
 *
 * Production emits newline-delimited JSON so the VM's journal stays greppable;
 * development pretty-prints. `redact` exists because request logging would
 * otherwise write session cookies and the internal service token into the log
 * file in plain text.
 */
const options: LoggerOptions = {
  level: env.IS_TEST ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-internal-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.SESSION_SECRET',
      '*.INTERNAL_API_TOKEN',
      '*.RESEND_API_KEY',
      '*.GOOGLE_PLACES_API_KEY',
    ],
    censor: '[redacted]',
  },
  ...(env.IS_PRODUCTION
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
};

export const logger = pino(options);
