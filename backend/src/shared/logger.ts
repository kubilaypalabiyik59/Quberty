import pino from 'pino';

/**
 * Structured logger for the Skarpine backend.
 * - Development: pretty-printed, colorized output
 * - Production:  JSON lines (compatible with Datadog, CloudWatch, etc.)
 *
 * Usage:
 *   import { logger } from '../../shared/logger';
 *   logger.info({ orderId }, 'Sale completed');
 *   logger.error({ err }, 'GL journal creation failed');
 */

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    },
  }),
});
