/**
 * USER ADMINISTRATION (HR router)
 *
 *   - an admin creates a sign-in account; a duplicate email is 409;
 *   - a role change accepts workforce roles only (never `customer`);
 *   - the last active admin cannot be demoted or deactivated;
 *   - an admin cannot change their own role or deactivate themselves;
 *   - a store manager adding staff can give store roles only;
 *   - a deactivated user can be reactivated.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import hrRoutes from '../modules/hr/hr.routes';
import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    user: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    employee: { count: jest.fn(), create: jest.fn() },
  },
}));

const mdb = db as any;
const TENANT = 'tenant-1';
const ME = 'admin-me';

function mount(role = 'admin', id = ME) {
  const app = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id, email: 'me@t.com', role, tenantId: TENANT });
    c.set('tenantId', TENANT);
    await next();
  };
  app.use('*', identity);
  app.route('/', hrRoutes);
  app.onError(errorHandler);
  return app;
}
const send = (method: string, body?: unknown) => ({
  method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  mdb.user.updateMany.mockResolvedValue({ count: 1 });
  mdb.user.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'u-new', ...data }));
  mdb.employee.count.mockResolvedValue(0);
  mdb.employee.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'e-new', ...data }));
});

describe('create a user', () => {
  it('creates a sign-in account in the caller tenant', async () => {
    mdb.user.findFirst.mockResolvedValue(null);
    const res = await mount().request('/users', send('POST', {
      email: 'ana@shop.bo', first_name: 'Ana', last_name: 'Q', role: 'finance_manager', password: 'secret-123',
    }));
    expect(res.status).toBe(201);
    const data = mdb.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ email: 'ana@shop.bo', role: 'finance_manager', tenant_id: TENANT });
    expect(data.password_hash).not.toBe('secret-123');
  });

  it('refuses a duplicate email', async () => {
    mdb.user.findFirst.mockResolvedValue({ id: 'u-old' });
    const res = await mount().request('/users', send('POST', {
      email: 'ana@shop.bo', first_name: 'Ana', last_name: 'Q', password: 'secret-123',
    }));
    expect(res.status).toBe(409);
    expect(mdb.user.create).not.toHaveBeenCalled();
  });

  it('refuses a short password', async () => {
    const res = await mount().request('/users', send('POST', { email: 'a@b.co', first_name: 'A', last_name: 'B', password: 'short' }));
    expect(res.status).toBe(400);
  });

  it('is admin-only', async () => {
    const res = await mount('store_manager').request('/users', send('POST', { email: 'a@b.co', first_name: 'A', last_name: 'B', password: 'secret-123' }));
    expect(res.status).toBe(403);
  });
});

describe('change a role', () => {
  it('never turns a colleague into a customer', async () => {
    const res = await mount().request('/users/u-1/role', send('PUT', { role: 'customer' }));
    expect(res.status).toBe(400);
    expect(mdb.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to demote the last active admin', async () => {
    mdb.user.findFirst.mockResolvedValue({ id: 'u-1', role: 'admin', is_active: true });
    mdb.user.count.mockResolvedValue(1);
    const res = await mount().request('/users/u-1/role', send('PUT', { role: 'store_manager' }));
    expect(res.status).toBe(409);
    expect(mdb.user.updateMany).not.toHaveBeenCalled();
  });

  it('demotes an admin when another admin remains', async () => {
    mdb.user.findFirst.mockResolvedValue({ id: 'u-1', role: 'admin', is_active: true });
    mdb.user.count.mockResolvedValue(2);
    const res = await mount().request('/users/u-1/role', send('PUT', { role: 'store_manager' }));
    expect(res.status).toBe(200);
    expect(mdb.user.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'u-1', tenant_id: TENANT }, data: { role: 'store_manager' } });
  });

  it('refuses a change to your own role', async () => {
    mdb.user.findFirst.mockResolvedValue({ id: ME, role: 'admin', is_active: true });
    mdb.user.count.mockResolvedValue(3);
    const res = await mount().request(`/users/${ME}/role`, send('PUT', { role: 'employee' }));
    expect(res.status).toBe(409);
  });
});

describe('deactivate and reactivate', () => {
  it('refuses to deactivate yourself', async () => {
    mdb.user.findFirst.mockResolvedValue({ id: ME, role: 'admin', is_active: true });
    const res = await mount().request(`/users/${ME}/deactivate`, send('PUT'));
    expect(res.status).toBe(409);
  });

  it('refuses to deactivate the last active admin', async () => {
    mdb.user.findFirst.mockResolvedValue({ id: 'u-1', role: 'admin', is_active: true });
    mdb.user.count.mockResolvedValue(1);
    const res = await mount().request('/users/u-1/deactivate', send('PUT'));
    expect(res.status).toBe(409);
  });

  it('deactivates an ordinary user and reactivates them', async () => {
    mdb.user.findFirst.mockResolvedValue({ id: 'u-2', role: 'cashier', is_active: true });
    expect((await mount().request('/users/u-2/deactivate', send('PUT'))).status).toBe(200);
    expect((await mount().request('/users/u-2/reactivate', send('PUT'))).status).toBe(200);
    expect(mdb.user.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: 'u-2', tenant_id: TENANT }, data: { is_active: true } });
  });
});

describe('store manager adding staff', () => {
  it('may give a store role', async () => {
    mdb.user.findFirst.mockResolvedValue(null);
    const res = await mount('store_manager', 'sm-1').request('/employees', send('POST', {
      email: 'c@shop.bo', password: 'secret-123', first_name: 'C', last_name: 'D', role: 'cashier',
    }));
    expect(res.status).toBe(201);
  });

  it.each(['finance_manager', 'auditor', 'buyer', 'store_manager', 'admin'])('may not give %s', async (role) => {
    const res = await mount('store_manager', 'sm-1').request('/employees', send('POST', {
      email: 'x@shop.bo', password: 'secret-123', first_name: 'X', last_name: 'Y', role,
    }));
    expect(res.status).toBe(403);
    expect(mdb.user.create).not.toHaveBeenCalled();
  });
});
