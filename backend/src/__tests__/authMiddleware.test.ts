/**
 * AUTH MIDDLEWARE TESTS
 * Tests JWT verification and requireRole() guard without hitting the DB.
 *
 * These run against a real one-route Hono app wired the way the production
 * routers wire it, because the middleware's contract IS the Hono contract:
 * it reads `c.req.header()`, writes `c.set('user')` / `c.set('tenantId')`, and
 * signals failure by THROWING an AppError. It never receives an Express
 * `(req, res, next)` triple and never calls `next(error)` — an earlier version
 * of this file asserted that, which is why it stopped compiling when the
 * backend moved to Hono.
 *
 * The thrown error is captured through `app.onError`, which is where a real
 * request's error would land.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import * as jwt from 'jsonwebtoken';
import { authMiddleware, requireRole } from '../shared/middleware/authMiddleware';
import { AppError } from '../shared/errors/AppError';
import type { AppEnv, AppUser } from '../shared/context';

const SECRET = process.env.JWT_SECRET!;

function makeToken(payload: object, expiresIn = '1h') {
  return jwt.sign(payload, SECRET, { expiresIn } as any);
}

/** What the route saw, and what the middleware threw. */
interface Captured {
  error:      unknown;
  handlerRan: boolean;
  user?:      AppUser;
  tenantId?:  string;
}

/**
 * `tenantId` mirrors what the tenant middleware would have set before auth runs.
 * Passing `undefined` reproduces the case where no X-Tenant-ID header arrived.
 */
function buildAuthApp(tenantId: string | undefined) {
  const captured: Captured = { error: undefined, handlerRan: false };
  const app = new Hono<AppEnv>();

  const setTenant: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (tenantId !== undefined) c.set('tenantId', tenantId);
    await next();
  };

  app.get('/protected', setTenant, authMiddleware, (c) => {
    captured.handlerRan = true;
    captured.user       = c.get('user');
    captured.tenantId   = c.get('tenantId');
    return c.json({ ok: true });
  });

  app.onError((err, c) => {
    captured.error = err;
    return c.json({ ok: false }, 500);
  });

  return { app, captured };
}

function get(app: Hono<AppEnv>, authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization) headers.authorization = authorization;
  return app.request('/protected', { headers });
}

// ── authMiddleware ─────────────────────────────────────────────────────────────

describe('authMiddleware', () => {
  it('throws AppError 401 when no Authorization header', async () => {
    const { app, captured } = buildAuthApp('tenant-abc');

    await get(app);

    expect(captured.error).toBeInstanceOf(AppError);
    expect(captured.error).toMatchObject({ statusCode: 401 });
    expect(captured.handlerRan).toBe(false);
  });

  it('throws AppError 401 for non-Bearer token', async () => {
    const { app, captured } = buildAuthApp('tenant-abc');

    await get(app, 'Basic abc123');

    expect(captured.error).toBeInstanceOf(AppError);
    expect(captured.error).toMatchObject({ statusCode: 401 });
    expect(captured.handlerRan).toBe(false);
  });

  it('throws AppError 401 for an expired token', async () => {
    const token = makeToken(
      { sub: 'u1', email: 'a@a.com', role: 'admin', tenantId: 'tenant-abc' },
      '-1s' // already expired
    );
    const { app, captured } = buildAuthApp('tenant-abc');

    await get(app, `Bearer ${token}`);

    expect(captured.error).toBeInstanceOf(AppError);
    expect(captured.error).toMatchObject({ statusCode: 401 });
    expect(captured.handlerRan).toBe(false);
  });

  it('throws AppError 401 for wrong tenant', async () => {
    const token = makeToken({
      sub: 'u1', email: 'a@a.com', role: 'admin', tenantId: 'DIFFERENT-TENANT',
    });
    const { app, captured } = buildAuthApp('tenant-abc');

    await get(app, `Bearer ${token}`);

    expect(captured.error).toBeInstanceOf(AppError);
    expect(captured.error).toMatchObject({ statusCode: 401 });
    // The tenant guard must fire on its own terms, not as a generic token failure.
    expect((captured.error as AppError).message).toBe('Token tenant mismatch');
    expect(captured.handlerRan).toBe(false);
  });

  it('populates c.get("user") and continues for a valid token', async () => {
    const token = makeToken({
      sub: 'user-123', email: 'admin@test.com', role: 'admin', tenantId: 'tenant-abc',
    });
    const { app, captured } = buildAuthApp('tenant-abc');

    const res = await get(app, `Bearer ${token}`);

    expect(captured.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(captured.handlerRan).toBe(true);
    expect(captured.user).toMatchObject({
      id:    'user-123',
      email: 'admin@test.com',
      role:  'admin',
    });
  });

  it('fills the tenant from the token when the header is absent', async () => {
    const token = makeToken({
      sub: 'u1', email: 'a@a.com', role: 'admin', tenantId: 'token-tenant',
    });
    const { app, captured } = buildAuthApp(undefined);

    const res = await get(app, `Bearer ${token}`);

    expect(captured.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(captured.tenantId).toBe('token-tenant');
  });
});

// ── requireRole() ──────────────────────────────────────────────────────────────

/** `role: undefined` reproduces requireRole running without authMiddleware in front. */
function buildRoleApp(role: string | undefined, roles: string[]) {
  const captured: Captured = { error: undefined, handlerRan: false };
  const app = new Hono<AppEnv>();

  const setUser: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (role !== undefined) {
      c.set('user', { id: 'u1', email: 'a@a.com', role, tenantId: 'tenant-abc' });
    }
    await next();
  };

  app.get('/guarded', setUser, requireRole(...roles), (c) => {
    captured.handlerRan = true;
    return c.json({ ok: true });
  });

  app.onError((err, c) => {
    captured.error = err;
    return c.json({ ok: false }, 500);
  });

  return { app, captured };
}

describe('requireRole()', () => {
  it('continues when the user has the matching role', async () => {
    const { app, captured } = buildRoleApp('admin', ['admin']);

    const res = await app.request('/guarded');

    expect(captured.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(captured.handlerRan).toBe(true);
  });

  it('continues when the user matches one of several roles', async () => {
    const { app, captured } = buildRoleApp('store_manager', ['admin', 'store_manager']);

    const res = await app.request('/guarded');

    expect(captured.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(captured.handlerRan).toBe(true);
  });

  it('throws AppError 403 when the role is not in the allowed list', async () => {
    const { app, captured } = buildRoleApp('cashier', ['admin']);

    await app.request('/guarded');

    expect(captured.error).toBeInstanceOf(AppError);
    expect(captured.error).toMatchObject({ statusCode: 403 });
    expect(captured.handlerRan).toBe(false);
  });

  it('throws AppError 403 when there is no user on the context', async () => {
    const { app, captured } = buildRoleApp(undefined, ['admin']);

    await app.request('/guarded');

    expect(captured.error).toBeInstanceOf(AppError);
    expect(captured.error).toMatchObject({ statusCode: 403 });
    expect(captured.handlerRan).toBe(false);
  });
});
