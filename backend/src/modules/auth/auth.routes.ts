import { Hono }    from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import * as bcrypt  from 'bcryptjs';
import * as jwt     from 'jsonwebtoken';
import { db }       from '../../infrastructure/database/client';
import { config }   from '../../config/env';
import { AppError } from '../../shared/errors/AppError';
import { authMiddleware } from '../../shared/middleware/authMiddleware';
import { permissionsForRole } from '../../shared/middleware/permissions';
import { validate }       from '../../shared/middleware/validate';
import { ok, created }    from '../../shared/response';
import { LoginSchema, RegisterSchema } from '../../shared/schemas';
import { nextCustomerCode } from '../../shared/services/customerCode.service';
import type { AppEnv }    from '../../shared/context';

const REFRESH_COOKIE = 'refresh_token';
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function setRefreshCookie(c: any, token: string) {
  setCookie(c, REFRESH_COOKIE, token, {
    httpOnly: true,
    secure:   config.NODE_ENV === 'production',
    sameSite: 'Strict',
    maxAge:   REFRESH_TTL_SECONDS,
    path:     '/api/v1/auth',
  });
}

/** Sent with every token issue, so the client enforces the current policy. */
const sessionPolicy = () => ({ idle_timeout_minutes: config.SESSION_IDLE_TIMEOUT_MINUTES });

const app = new Hono<AppEnv>();

app.post('/login', validate(LoginSchema), async (c) => {
  const { email, password, tenant_id, tenant_slug } = c.get('body');

  let tenant;
  if (tenant_id) {
    tenant = await db.tenant.findUnique({ where: { id: tenant_id, is_active: true } });
  } else if (tenant_slug) {
    tenant = await db.tenant.findUnique({ where: { slug: tenant_slug, is_active: true } });
  } else {
    const user = await db.user.findFirst({ where: { email, is_active: true } });
    if (user) tenant = await db.tenant.findUnique({ where: { id: user.tenant_id, is_active: true } });
  }
  if (!tenant) throw new AppError('Invalid credentials', 401);

  const user = await db.user.findFirst({ where: { email, tenant_id: tenant.id, is_active: true } });
  if (!user) throw new AppError('Invalid credentials', 401);

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new AppError('Invalid credentials', 401);

  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, tenantId: tenant.id },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN } as any
  );
  const refreshToken = jwt.sign(
    { sub: user.id, tenantId: tenant.id },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_EXPIRES_IN } as any
  );

  await db.refreshToken.create({
    data: {
      user_id:    user.id,
      token_hash: await bcrypt.hash(refreshToken, 8),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  await db.user.update({ where: { id: user.id }, data: { last_login_at: new Date() } });

  setRefreshCookie(c, refreshToken);

  return ok(c, {
    access_token: accessToken,
    tenant_id:    tenant.id,
    user: {
      id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role,
      permissions: permissionsForRole(user.role),
    },
    session:      sessionPolicy(),
  });
});

/**
 * Storefront self-registration. Always creates a `customer` in the tenant the
 * caller names, never an admin (WORK-030a, D-3).
 *
 * Tenants and their administrators are created only by the operator CLI
 * (`scripts/createTenant.ts`). This route used to fall back to "the first active
 * tenant" and to make the first user of an empty tenant its admin, so an anonymous
 * visitor could obtain a token in someone else's company.
 */
app.post('/register', validate(RegisterSchema), async (c) => {
  const { email, password, first_name, last_name, tenant_id, tenant_slug, phone, address, city, country, date_of_birth } = c.get('body');

  const tenant = tenant_id
    ? await db.tenant.findUnique({ where: { id: tenant_id, is_active: true } })
    : await db.tenant.findUnique({ where: { slug: tenant_slug, is_active: true } });
  if (!tenant) throw new AppError('Store not found', 404, 'TENANT_NOT_FOUND');

  const existing = await db.user.findFirst({ where: { email, tenant_id: tenant.id } });
  if (existing) throw new AppError('Email already registered', 409);

  const password_hash = await bcrypt.hash(password, 12);

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { email, password_hash, first_name, last_name, role: 'customer', tenant_id: tenant.id },
      select: { id: true, email: true, first_name: true, last_name: true, role: true },
    });
    await tx.customer.create({
      data: {
        tenant_id: tenant.id, user_id: created.id,
        code:      await nextCustomerCode(tenant.id, tx),
        first_name, last_name, email,
        phone:         phone || null, address: address || null, city: city || null,
        country:       country || null,
        date_of_birth: date_of_birth ? new Date(date_of_birth) : null,
        segment: 'regular',
      },
    });
    return created;
  });

  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, tenantId: tenant.id },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN } as any
  );
  const refreshToken = jwt.sign(
    { sub: user.id, tenantId: tenant.id },
    config.JWT_REFRESH_SECRET,
    { expiresIn: config.JWT_REFRESH_EXPIRES_IN } as any
  );

  await db.refreshToken.create({
    data: {
      user_id:    user.id,
      token_hash: await bcrypt.hash(refreshToken, 8),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  setRefreshCookie(c, refreshToken);

  return created(c, { access_token: accessToken, tenant_id: tenant.id, user });
});

app.post('/refresh', async (c) => {
  let refresh_token: string | undefined;
  try { ({ refresh_token } = await c.req.json()); } catch { /* body may be empty */ }
  if (!refresh_token) refresh_token = getCookie(c, REFRESH_COOKIE);
  if (!refresh_token) throw new AppError('Refresh token required');

  // A malformed, tampered or expired token is the caller's problem, not a server
  // fault: answer 401 so the client signs in again instead of reporting a 500.
  let payload: any;
  try {
    payload = jwt.verify(refresh_token, config.JWT_REFRESH_SECRET);
  } catch {
    throw new AppError('Refresh token is invalid or expired', 401, 'REFRESH_TOKEN_INVALID');
  }
  const user = await db.user.findUnique({
    where:  { id: payload.sub, is_active: true },
    select: { id: true, email: true, role: true },
  });
  if (!user) throw new AppError('User not found', 401);

  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, role: user.role, tenantId: payload.tenantId },
    config.JWT_SECRET,
    { expiresIn: config.JWT_EXPIRES_IN } as any
  );
  return ok(c, { access_token: accessToken, session: sessionPolicy() });
});

/**
 * Ends the browser's session by removing the refresh cookie.
 *
 * Until now "sign out" only forgot the access token in memory: the httpOnly
 * refresh cookie survived for its full 7 days, so the next page load signed
 * the user straight back in. Clearing the cookie is what makes a sign-out —
 * and an idle timeout — real in this browser.
 *
 * It does not revoke the token server-side: refresh does not consult the
 * token table yet. Revocation and rotation are WORK-052 (migration 042).
 * Deliberately unauthenticated, so an already-expired session can still clear
 * its cookie.
 */
app.post('/logout', (c) => {
  deleteCookie(c, REFRESH_COOKIE, { path: '/api/v1/auth' });
  return ok(c, { signed_out: true });
});

app.get('/me', authMiddleware, async (c) => {
  const user = await db.user.findUnique({
    where:  { id: c.get('user').id },
    select: { id: true, email: true, first_name: true, last_name: true, role: true },
  });
  // The role's permissions ride along so the client can hide what would 403.
  return ok(c, user && { ...user, permissions: permissionsForRole(user.role) });
});

app.get('/account', authMiddleware, async (c) => {
  const [user, customer] = await Promise.all([
    db.user.findUnique({
      where:  { id: c.get('user').id },
      select: { id: true, email: true, first_name: true, last_name: true, role: true },
    }),
    db.customer.findFirst({ where: { user_id: c.get('user').id } }),
  ]);
  return ok(c, { user, customer });
});

app.put('/account', authMiddleware, async (c) => {
  const { first_name, last_name, phone, address, city, country, date_of_birth } = await c.req.json();
  await db.user.update({ where: { id: c.get('user').id }, data: { first_name, last_name } });
  await db.customer.updateMany({
    where: { user_id: c.get('user').id },
    data: {
      first_name, last_name,
      phone:         phone ?? undefined, address: address ?? undefined,
      city:          city ?? undefined,  country: country ?? undefined,
      date_of_birth: date_of_birth ? new Date(date_of_birth) : undefined,
      updated_at:    new Date(),
    },
  });
  return ok(c, null);
});

// There is no self-promotion route. `POST /make-admin` let a tenant's only user
// make themselves admin; administrators are created by the operator CLI and roles
// are assigned by an admin through HR (WORK-030a, D-3).

export default app;
