/**
 * CUSTOMER STATEMENT
 *
 * A receivable is an invoiced order (factura not cancelled) that is neither paid
 * nor cancelled nor returned. Drafts are not on the statement.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import customerRoutes from '../modules/customers/customer.routes';
import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    customer: { findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    salesOrder: { findMany: jest.fn() },
    factura: { findMany: jest.fn() },
  },
}));

const mdb = db as any;
const T = 'tenant-1';

function mount() {
  const app = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'u', email: 'a@t.com', role: 'store_manager', tenantId: T });
    c.set('tenantId', T);
    await next();
  };
  return app.use('*', identity).route('/', customerRoutes).onError(errorHandler);
}

const order = (id: string, over: Record<string, unknown>) => ({
  id, order_number: id, source: 'manual', status: 'SHIPPED', currency: 'BOB', total_amount: 100,
  invoice_id: null, paid_at: null, returned_at: null, created_at: new Date('2026-09-01'), shipped_at: null, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mdb.customer.findFirst.mockResolvedValue({ id: 'c-1' });
  mdb.salesOrder.findMany.mockResolvedValue([
    order('open', { invoice_id: 'f-1' }),                                  // invoiced, unpaid → open
    order('paid', { invoice_id: 'f-2', paid_at: new Date() }),             // paid
    order('annulled', { invoice_id: 'f-3' }),                              // factura cancelled
    order('returned', { invoice_id: 'f-4', status: 'RETURNED', returned_at: new Date() }),
    order('shipped', {}),                                                  // not invoiced yet
    order('cancelled', { status: 'CANCELLED' }),
  ]);
  mdb.factura.findMany.mockResolvedValue([
    { id: 'f-1', factura_number: '101', status: 'ISSUED' },
    { id: 'f-2', factura_number: '102', status: 'ISSUED' },
    { id: 'f-3', factura_number: '103', status: 'CANCELLED' },
    { id: 'f-4', factura_number: '104', status: 'ISSUED' },
  ]);
});

it('derives each order payment state and the totals', async () => {
  const res = await mount().request('/c-1/statement');
  expect(res.status).toBe(200);
  const { data }: any = await res.json();
  const state = Object.fromEntries(data.orders.map((o: any) => [o.id, o.payment_status]));
  expect(state).toEqual({
    open: 'OPEN', paid: 'PAID', annulled: 'NOT_INVOICED', returned: 'CLOSED', shipped: 'NOT_INVOICED', cancelled: 'NOT_INVOICED',
  });
  expect(data.totals).toEqual({ ordered: 500, invoiced: 300, paid: 100, open: 100 });
  expect(data.orders.find((o: any) => o.id === 'open').factura_number).toBe('101');
});

it('leaves drafts off the statement and stays in the tenant', async () => {
  await mount().request('/c-1/statement');
  const where = mdb.salesOrder.findMany.mock.calls[0][0].where;
  expect(where).toMatchObject({ tenant_id: T, customer_id: 'c-1', status: { not: 'DRAFT' } });
});

it('answers 404 for a customer of another tenant', async () => {
  mdb.customer.findFirst.mockResolvedValue(null);
  expect((await mount().request('/c-9/statement')).status).toBe(404);
});
