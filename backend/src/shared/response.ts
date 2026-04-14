import type { AppContext } from './context';

/**
 * Typed response helpers — ensure every endpoint returns a consistent envelope:
 *   { success: true,  data: T }
 *   { success: true,  data: T[], meta: { total, page, limit } }
 *   { success: false, error: { message, code, details? } }
 *
 * Usage:
 *   return ok(c, order);
 *   return created(c, order);
 *   return paginated(c, orders, total, page, limit);
 */

export function ok<T>(c: AppContext, data: T) {
  return c.json({ success: true, data }, 200);
}

export function created<T>(c: AppContext, data: T) {
  return c.json({ success: true, data }, 201);
}

export function noContent(c: AppContext) {
  return c.body(null, 204);
}

export function paginated<T>(
  c:     AppContext,
  data:  T[],
  total: number,
  page:  number,
  limit: number
) {
  return c.json({
    success: true,
    data,
    meta: {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    },
  }, 200);
}

export function message(c: AppContext, msg: string, status: 200 | 201 | 202 = 200) {
  return c.json({ success: true, message: msg }, status);
}
