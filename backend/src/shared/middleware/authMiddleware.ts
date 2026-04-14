import * as jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { AppError } from '../errors/AppError';
import type { AppContext, AppEnv, AppNext } from '../context';

/**
 * Hono auth middleware — verifies Bearer JWT and populates c.get('user').
 * Also enforces tenant isolation: token tenant must match X-Tenant-ID header.
 */
export async function authMiddleware(c: AppContext, next: AppNext) {
  const authHeader = c.req.header('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new AppError('No authorization token provided', 401);
  }

  const token = authHeader.substring(7);

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as {
      sub: string; email: string; role: string; tenantId: string;
    };

    const tenantId = c.get('tenantId');
    if (tenantId) {
      if (payload.tenantId !== tenantId) {
        throw new AppError('Token tenant mismatch', 401);
      }
    } else {
      c.set('tenantId',   payload.tenantId);
      c.set('tenantSlug', '');
    }

    c.set('user', {
      id:       payload.sub,
      email:    payload.email,
      role:     payload.role,
      tenantId: payload.tenantId,
    });

    await next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid or expired token', 401);
  }
}

/**
 * Role guard factory.
 * Usage: app.post('/admin', authMiddleware, requireRole('admin'), handler)
 */
export function requireRole(...roles: string[]) {
  return async (c: AppContext, next: AppNext) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      throw new AppError('Insufficient permissions', 403);
    }
    await next();
  };
}
