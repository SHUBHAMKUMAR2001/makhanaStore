import { pino, type LoggerOptions } from 'pino';
import { env } from '../config.js';

/**
 * Structured logging.
 *
 * The brief calls out silent scraper failure as the most likely production
 * bug, so this logs generously around navigation, geo-wall detection and
 * parse counts — a run that finds nothing should leave a trail explaining why.
 */
const options: LoggerOptions = {
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: ['*.INTERNAL_API_TOKEN', '*.GOOGLE_PLACES_API_KEY', 'headers["x-internal-token"]'],
    censor: '[redacted]',
  },
  ...(env.NODE_ENV === 'production'
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }),
};

export const logger = pino(options);
