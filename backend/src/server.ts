import 'dotenv/config';
import { serve } from '@hono/node-server';
import app        from './app';
import { config } from './config/env';
import { logger } from './shared/logger';
import { db }     from './infrastructure/database/client';

const server = serve({
  fetch: app.fetch,
  port:  config.PORT,
  hostname: '0.0.0.0',
});

logger.info({ port: config.PORT }, 'Quberty ERP API ready');

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// Railway, Docker, and Kubernetes all send SIGTERM before killing the process.
// This handler drains in-flight requests and closes the DB connection cleanly
// so no transactions are left hanging.

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received — draining connections');

  server.close(async () => {
    try {
      await db.$disconnect();
      logger.info('Database disconnected. Goodbye.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });

  // Force exit after 10 seconds if graceful shutdown stalls
  setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
