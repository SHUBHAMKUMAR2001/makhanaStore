import { pino, type LoggerOptions } from 'pino';
import { env } from './config.js';

const options: LoggerOptions = {
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      '*.RESEND_API_KEY',
      '*.SMTP_PASSWORD',
      '*.INTERNAL_API_TOKEN',
      'headers["x-internal-token"]',
    ],
    censor: '[redacted]',
  },
  ...(env.NODE_ENV === 'production'
    ? {}
    : {
        transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
      }),
};

export const logger = pino(options);
