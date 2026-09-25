import type { Context } from 'hono';
import { Prisma } from '@prisma/client';
import type { AppEnv } from '../context';
import { AppError } from '../errors/AppError';
import { logger } from '../logger';

/**
 * The Prisma request errors a user can cause with valid-looking input, mapped to
 * the HTTP answer that describes them. Anything else stays a 500: a validation
 * error from the Prisma client is a coding bug and must not look like user error.
 *
 * The duplicate message names the fields, never the values, so a unique index on
 * an email or tax id cannot be used to probe another record's data.
 */
function prismaKnownError(err: Prisma.PrismaClientKnownRequestError):
  { status: 404 | 409 | 422; code: string; message: string } | null {
  switch (err.code) {
    case 'P2002': {
      const target = (err.meta?.target as string[] | string | undefined) ?? [];
      const fields = (Array.isArray(target) ? target : [target])
        .filter((f) => f !== 'tenant_id')
        .join(', ');
      return {
        status: 409,
        code: 'DUPLICATE',
        message: fields
          ? `A record with the same ${fields} already exists.`
          : 'A record with the same identifying values already exists.',
      };
    }
    case 'P2003':
      return { status: 422, code: 'INVALID_REFERENCE', message: 'A referenced record does not exist.' };
    case 'P2025':
      return { status: 404, code: 'NOT_FOUND', message: 'The record was not found.' };
    default:
      return null;
  }
}

/** PostgreSQL 40P01 (deadlock) or 40001 (serialization), however Prisma wraps it. */
export function isConcurrencyFailure(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code === 'P2034') return true;
  const meta = err.meta as { code?: string } | undefined;
  return err.code === 'P2010' && (meta?.code === '40P01' || meta?.code === '40001');
}

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

  // A deadlock or serialization failure means two requests raced for the same rows;
  // one of them lost and nothing it wrote was kept. Retrying is the answer.
  if (isConcurrencyFailure(err)) {
    logger.warn({ requestId: c.get('requestId'), path: c.req.path }, 'CONCURRENT_UPDATE_RETRY');
    return c.json({
      success: false,
      error: { message: 'Another change to the same stock or document happened at the same moment. Please try again.', code: 'CONCURRENT_UPDATE_RETRY' },
    }, 409);
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = prismaKnownError(err);
    if (mapped) {
      logger.info({ requestId: c.get('requestId'), prismaCode: err.code, path: c.req.path }, mapped.code);
      return c.json({ success: false, error: { message: mapped.message, code: mapped.code } }, mapped.status);
    }
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
