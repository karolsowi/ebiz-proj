/**
 * Structured logger using pino.
 *
 * In production (NODE_ENV=production) logs are emitted as newline-delimited JSON.
 * In development they are pretty-printed via pino-pretty.
 *
 * Usage:
 *   import { logger } from './logger.js';
 *   logger.info({ symbol: 'AAPL' }, 'Fetching quote');
 *   logger.error({ err }, 'Something went wrong');
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
    base: { service: 'inwest-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      // Never log secrets even if they accidentally end up in log objects
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'body.password',
        'body.token',
        '*.password',
        '*.secret',
        '*.apiKey',
      ],
      censor: '[REDACTED]',
    },
  },
  isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } })
    : undefined
);
