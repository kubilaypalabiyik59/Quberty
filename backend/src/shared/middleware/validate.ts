import type { ZodSchema } from 'zod';
import { AppError } from '../errors/AppError';
import type { AppContext, AppNext } from '../context';

/**
 * Hono validation middleware — parses + validates the request body against a
 * Zod schema. On success the parsed data is stored in c.get('body') for the handler.
 *
 * Usage:
 *   app.post('/login', validate(LoginSchema), handler)
 *   // in handler: const body = c.get('body') as LoginDto
 */
export function validate(schema: ZodSchema) {
  return async (c: AppContext, next: AppNext) => {
    let raw: Record<string, any> = {};
    try {
      raw = await c.req.json();
    } catch {
      // Body may be empty on some requests — safeParse will catch required fields
    }

    const result = schema.safeParse(raw);

    if (!result.success) {
      const details = result.error.errors.map((e) => ({
        field:   e.path.join('.'),
        message: e.message,
      }));
      return c.json(
        { success: false, error: { message: 'Validation failed', code: 'VALIDATION_ERROR', details } },
        400
      );
    }

    c.set('body', result.data);
    await next();
  };
}
