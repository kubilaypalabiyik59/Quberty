import type { Context } from 'hono';
import type { AppEnv } from '../context';
import { AppError } from '../errors/AppError';
import { logger } from '../logger';

/**
 * Hono global error handler.
 * Registered via app.onError() in app.ts.
 */
export function errorHandler(err: Error, c: Context<AppEnv>) {
  if (err instanceof AppError) {
    return c.json(
      { success: false, error: { message: err.message, code: err.code ?? 'APP_ERROR' } },
      err.statusCode as any
    );
  }

  // Log unexpected errors with request context
  logger.error({
    err,
    requestId: c.get('requestId'),
    method:    c.req.method,
    path:      c.req.path,
  }, 'Unexpected error');

  return c.json(
    { success: false, error: { message: 'Internal server error', code: 'INTERNAL_ERROR' } },
    500
  );
}
