import { Hono }    from 'hono';
import * as bcrypt  from 'bcryptjs';
import * as jwt     from 'jsonwebtoken';
import { db }       from '../../infrastructure/database/client';
import { config }   from '../../config/env';
import { AppError } from '../../shared/errors/AppError';
import { authMiddleware } from '../../shared/middleware/authMiddleware';
import { validate }       from '../../shared/middleware/validate';
import { ok, created }    from '../../shared/response';
import { LoginSchema, RegisterSchema } from '../../shared/schemas';
import type { AppEnv }    from '../../shared/context';

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

  return ok(c, {
    access_token:  accessToken,
    refresh_token: refreshToken,
    tenant_id:     tenant.id,
    user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role },
  });
});

app.post('/register', validate(RegisterSchema), async (c) => {
  const { email, password, first_name, last_name, tenant_id, phone, address, city, country, date_of_birth } = c.get('body');

  let tenant;
  if (tenant_id) {
    tenant = await db.tenant.findUnique({ where: { id: tenant_id, is_active: true } });
  } else {
    tenant = await db.tenant.findFirst({ where: { is_active: true } });
  }
  if (!tenant) throw new AppError('No active tenant found', 400);

  const existing = await db.user.findFirst({ where: { email, tenant_id: tenant.id } });
  if (existing) throw new AppError('Email already registered', 409);

  const password_hash = await bcrypt.hash(password, 12);

  const user = await db.user.create({
    data: { email, password_hash, first_name, last_name, role: 'customer', tenant_id: tenant.id },
    select: { id: true, email: true, first_name: true, last_name: true, role: true },
  });

  const custCount = await db.customer.count({ where: { tenant_id: tenant.id } });
  await db.customer.create({
    data: {
      tenant_id: tenant.id, user_id: user.id,
      code:      `CUST-${String(custCount + 1).padStart(5, '0')}`,
      first_name, last_name, email,
      phone:         phone ?? null, address: address ?? null, city: city ?? null,
      country:       country ?? null,
      date_of_birth: date_of_birth ? new Date(date_of_birth) : null,
      segment: 'regular',
    },
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

  return created(c, { access_token: accessToken, refresh_token: refreshToken, tenant_id: tenant.id, user });
});

app.post('/refresh', async (c) => {
  const { refresh_token } = await c.req.json();
  if (!refresh_token) throw new AppError('Refresh token required');

  const payload = jwt.verify(refresh_token, config.JWT_REFRESH_SECRET) as any;
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
  return ok(c, { access_token: accessToken });
});

app.get('/me', authMiddleware, async (c) => {
  const user = await db.user.findUnique({
    where:  { id: c.get('user').id },
    select: { id: true, email: true, first_name: true, last_name: true, role: true },
  });
  return ok(c, user);
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

export default app;
