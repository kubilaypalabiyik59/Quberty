/**
 * WORK-048B — Sales return lifecycle
 *
 * Mocked unit tests for the return handler's branching, guard ordering, and
 * guarded final write. Full Jest suite and tsc are the offline regression
 * checks; these mocks do not prove PostgreSQL concurrency or integration.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import salesRoutes from '../modules/sales/sales.routes';
import { errorHandler } from '../shared/middleware/errorHandler';
import { db } from '../infrastructure/database/client';
import { AppError } from '../shared/errors/AppError';
import { nextFacturaNumber } from '../shared/services/numberSequence.service';
import { restoreIssues } from '../shared/services/stockLedger.service';
import { postIssueCogs } from '../modules/sales/sales.service';
import { postJournal } from '../shared/services/journal.service';
import { resolvePostingAccounts_orExplain } from '../shared/services/posting.service';
import { computeDocumentTax } from '../shared/services/documentTax.service';
import { assertDocumentCurrencySupported } from '../shared/services/currency/documentCurrency';
import type { AppEnv } from '../shared/context';

// ── module mocks ──────────────────────────────────────────────────────────────

jest.mock('../infrastructure/database/client', () => {
  const m: any = {
    salesOrder:           { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    salesOrderLine:       { findMany: jest.fn().mockResolvedValue([]) },
    factura:              { create: jest.fn(), findFirst: jest.fn() },
    customer:             { updateMany: jest.fn() },
    inventoryTransaction: { findMany: jest.fn() },
    // Called as a tagged template literal inside the transaction.
    // Verified table: sales_orders (Prisma @@map). Columns id, tenant_id are UUID.
    $queryRaw: jest.fn(),
  };
  m.$transaction = jest.fn((fn: any) => fn(m));
  return { db: m };
});

jest.mock('../shared/services/numberSequence.service', () => ({
  nextFacturaNumber:   jest.fn(),
  allocateNumber:      jest.fn(),
  nextJournalVoucher:  jest.fn(),
}));

jest.mock('../shared/services/stockLedger.service', () => ({
  restoreIssues: jest.fn(),
}));

jest.mock('../modules/sales/sales.service', () => ({
  SalesService: jest.fn().mockImplementation(() => ({
    getOrders:    jest.fn().mockResolvedValue([]),
    createOrder:  jest.fn(),
    confirmOrder: jest.fn(),
    shipOrder:    jest.fn(),
    cancelOrder:  jest.fn(),
  })),
  postIssueCogs: jest.fn(),
}));

jest.mock('../shared/services/journal.service', () => ({
  postJournal:    jest.fn(),
  reverseJournal: jest.fn(),
}));

jest.mock('../shared/services/posting.service', () => ({
  resolvePostingAccounts_orExplain: jest.fn(),
}));

jest.mock('../shared/services/documentTax.service', () => ({
  computeDocumentTax:   jest.fn(),
  computePurchaseMoney: jest.fn(),
}));

jest.mock('../shared/services/itemPolicy.service', () => ({
  resolveItemPolicies: jest.fn().mockResolvedValue(new Map()),
  groupByItemGroup:    jest.fn().mockReturnValue([]),
}));

jest.mock('../shared/services/dimension.service', () => ({
  contextForSalesOrder:     jest.fn().mockResolvedValue({}),
  EMPTY_SLOTS:              {},
  resolveDimensions:        jest.fn(),
  assertRequiredDimensions: jest.fn(),
}));

jest.mock('../shared/services/inventoryDimension.service', () => ({
  resolveInventoryDimensions: jest.fn().mockResolvedValue({ warehouse_id: 'wh-1', site_id: 'site-1' }),
  siteOfWarehouse:            jest.fn(),
}));

jest.mock('../shared/services/currency/documentCurrency', () => ({
  assertDocumentCurrencySupported: jest.fn(),
}));

jest.mock('../shared/services/tenantReference.service', () => ({
  assertTenantReferences: jest.fn(),
}));

jest.mock('../shared/services/facturaLine.service', () => ({
  linesFromSalesOrder: jest.fn().mockResolvedValue([]),
  writeFacturaLines:   jest.fn(),
  markInvoiced:        jest.fn(),
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const m = db as any;
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER  = '11111111-1111-4111-8111-111111111111';

const SHIPPED_UNINVOICED = {
  id: ORDER, order_number: 'SO-U1', status: 'SHIPPED',
  invoice_id: null, paid_at: null, returned_at: null,
  total_amount: '116.00', customer_id: 'cust-1', currency: 'BOB',
  customer: { id: 'cust-1', first_name: 'Ana', last_name: 'López' },
  lines: [{ product_id: 'prod-1', quantity: 2 }],
  shipping_address: null,
};

const SHIPPED_INVOICED = {
  ...SHIPPED_UNINVOICED,
  order_number: 'SO-I1',
  invoice_id:   'fac-original-1',
};

function makeApp() {
  const a = new Hono<AppEnv>();
  const identity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 'u@t.com', role: 'admin', tenantId: TENANT });
    c.set('tenantId', TENANT);
    c.set('taxConfig', null);
    await next();
  };
  a.use('*', identity);
  a.route('/', salesRoutes);
  a.onError(errorHandler);
  return a;
}

const post = (path: string, body: unknown) =>
  makeApp().request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// ── shared reset ──────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Reset ALL mock implementations to happy-path defaults on every test.
  m.$queryRaw.mockResolvedValue([]);
  m.salesOrder.findFirst.mockResolvedValue(SHIPPED_UNINVOICED);
  m.salesOrder.updateMany.mockResolvedValue({ count: 1 });
  m.salesOrder.update.mockResolvedValue({});
  m.customer.updateMany.mockResolvedValue({ count: 1 });
  m.inventoryTransaction.findMany.mockResolvedValue([{ id: 'it-1' }]);
  m.factura.create.mockResolvedValue({ id: 'new-fac-1' });

  (restoreIssues as jest.Mock).mockResolvedValue({
    transactionIds: ['tid-1'],
    costByProduct:  new Map([['prod-1', 50]]),
  });
  (postIssueCogs as jest.Mock).mockResolvedValue(undefined);
  (postJournal as jest.Mock).mockResolvedValue(undefined);
  (assertDocumentCurrencySupported as jest.Mock).mockResolvedValue(undefined);
  (computeDocumentTax as jest.Mock).mockResolvedValue({ subtotal: 100, vat: 13, turnover: 3 });
  (resolvePostingAccounts_orExplain as jest.Mock).mockResolvedValue({
    REVENUE: 'acc-rev', VAT_OUTPUT: 'acc-vat', TAX_TURNOVER_PAYABLE: 'acc-itp',
    TAX_TURNOVER_EXPENSE: 'acc-ite', AR: 'acc-ar',
    INVENTORY: 'acc-inv', COGS: 'acc-cogs', BANK: 'acc-bank',
  });
  (nextFacturaNumber as jest.Mock).mockResolvedValue('000099');
});

// ── uninvoiced path ───────────────────────────────────────────────────────────

describe('uninvoiced return path', () => {
  it('restores stock and posts COGS only — no factura, no tax, no invoice/payment journals', async () => {
    const res = await post(`/${ORDER}/return`, { notes: 'damaged' });
    expect(res.status).toBe(200);

    expect(nextFacturaNumber).not.toHaveBeenCalled();
    expect(m.factura.create).not.toHaveBeenCalled();
    expect(computeDocumentTax).not.toHaveBeenCalled();
    expect(postJournal).not.toHaveBeenCalled();
    expect(restoreIssues).toHaveBeenCalledTimes(1);
    expect(postIssueCogs).toHaveBeenCalledTimes(1);
    expect((postIssueCogs as jest.Mock).mock.calls[0][2]).toMatchObject({
      reverse: true,
      sourceModule: 'SALES_RETURN',
    });
    expect(resolvePostingAccounts_orExplain).not.toHaveBeenCalled();
  });

  it('response confirms this order was not invoiced', async () => {
    const res = await post(`/${ORDER}/return`, {});
    const body = await res.json() as any;
    const msg: string = body.message ?? body.data?.message ?? '';
    expect(msg).toMatch(/not invoiced/i);
  });

  it('rejects a supplied factura_number with 400 before any stock or GL mutation', async () => {
    const res = await post(`/${ORDER}/return`, { factura_number: 'A-04-0001' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('RETURN_UNINVOICED_NUMBER_REJECTED');
    expect(restoreIssues).not.toHaveBeenCalled();
    expect(nextFacturaNumber).not.toHaveBeenCalled();
    expect(postIssueCogs).not.toHaveBeenCalled();
  });

  it('rejects paid_at with no invoice_id with 409 before any stock or GL mutation', async () => {
    m.salesOrder.findFirst.mockResolvedValue({ ...SHIPPED_UNINVOICED, paid_at: new Date() });
    const res = await post(`/${ORDER}/return`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('RETURN_PAID_WITHOUT_INVOICE');
    expect(restoreIssues).not.toHaveBeenCalled();
    expect(nextFacturaNumber).not.toHaveBeenCalled();
  });

  it('uses recorded shipment cost from restoreIssues — not a product-master fallback', async () => {
    (restoreIssues as jest.Mock).mockResolvedValue({
      transactionIds: ['tid-1'],
      costByProduct:  new Map([['prod-1', 77.50]]),
    });
    await post(`/${ORDER}/return`, {});
    const cogsArg = (postIssueCogs as jest.Mock).mock.calls[0][2];
    expect(cogsArg.costByProduct.get('prod-1')).toBe(77.50);
  });
});

// ── invoiced path ─────────────────────────────────────────────────────────────

describe('invoiced return path', () => {
  beforeEach(() => {
    m.salesOrder.findFirst.mockResolvedValue(SHIPPED_INVOICED);
  });

  it('calls nextFacturaNumber, creates factura, posts invoice and COGS journals', async () => {
    const res = await post(`/${ORDER}/return`, {});
    expect(res.status).toBe(200);

    expect(nextFacturaNumber).toHaveBeenCalledTimes(1);
    expect(m.factura.create).toHaveBeenCalledTimes(1);
    expect(computeDocumentTax).toHaveBeenCalledTimes(1);
    expect(postJournal).toHaveBeenCalledTimes(1);
    expect(postIssueCogs).toHaveBeenCalledTimes(1);
  });

  it('response mentions return recorded in accounting', async () => {
    const res = await post(`/${ORDER}/return`, {});
    const body = await res.json() as any;
    const msg: string = body.message ?? body.data?.message ?? '';
    expect(msg).toMatch(/return recorded in accounting/i);
  });

  it('also posts payment reversal journal when paid_at is set', async () => {
    m.salesOrder.findFirst.mockResolvedValue({ ...SHIPPED_INVOICED, paid_at: new Date() });
    await post(`/${ORDER}/return`, {});
    expect(postJournal).toHaveBeenCalledTimes(2);
    const descs = (postJournal as jest.Mock).mock.calls.map((c: any[]) => c[0].description as string);
    expect(descs.some(d => /Refund/.test(d))).toBe(true);
  });

  it('accepts a valid manual credit note number', async () => {
    (nextFacturaNumber as jest.Mock).mockResolvedValue('A-04-0001919');
    const res = await post(`/${ORDER}/return`, { factura_number: 'A-04-0001919' });
    expect(res.status).toBe(200);
    expect(nextFacturaNumber).toHaveBeenCalledWith(
      TENANT, expect.anything(),
      expect.objectContaining({ manualNumber: 'A-04-0001919' }),
    );
  });
});

// ── order-state guards ────────────────────────────────────────────────────────

describe('order-state guards', () => {
  it('returns 404 for an order belonging to a different tenant', async () => {
    m.salesOrder.findFirst.mockResolvedValue(null);
    const res = await post(`/${ORDER}/return`, {});
    expect(res.status).toBe(404);
    expect(restoreIssues).not.toHaveBeenCalled();
  });

  it('returns 409 for an already-returned order', async () => {
    m.salesOrder.findFirst.mockResolvedValue({
      ...SHIPPED_UNINVOICED, returned_at: new Date(), status: 'RETURNED',
    });
    const res = await post(`/${ORDER}/return`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('ORDER_ALREADY_RETURNED');
    expect(restoreIssues).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'CONFIRMED', 'CANCELLED'])(
    'returns 409 for status %s before any effects',
    async (status) => {
      m.salesOrder.findFirst.mockResolvedValue({ ...SHIPPED_UNINVOICED, status });
      const res = await post(`/${ORDER}/return`, {});
      expect(res.status).toBe(409);
      expect(((await res.json()) as any).error.code).toBe('ORDER_NOT_RETURNABLE');
      expect(restoreIssues).not.toHaveBeenCalled();
    },
  );
});

// ── lock and ordering ─────────────────────────────────────────────────────────

describe('lock and ordering', () => {
  it('$queryRaw targets sales_orders with ::uuid casts on both parameters', async () => {
    await post(`/${ORDER}/return`, {});
    expect(m.$queryRaw).toHaveBeenCalled();
    const templateStrings: string[] = Array.from(m.$queryRaw.mock.calls[0][0]);
    const sqlText = templateStrings.join('');
    expect(sqlText).toContain('sales_orders');
    expect((sqlText.match(/::uuid/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Interpolated values carry the tenant and order IDs.
    const callArgs = m.$queryRaw.mock.calls[0];
    expect(callArgs).toContain(ORDER);
    expect(callArgs).toContain(TENANT);
  });

  it('lock → read → FACTURA number → restoreIssues on the invoiced path', async () => {
    m.salesOrder.findFirst.mockResolvedValue(SHIPPED_INVOICED);
    const callOrder: string[] = [];
    m.$queryRaw.mockImplementation(() => { callOrder.push('lock'); return Promise.resolve([]); });
    m.salesOrder.findFirst.mockImplementation(() => {
      callOrder.push('read');
      return Promise.resolve(SHIPPED_INVOICED);
    });
    (nextFacturaNumber as jest.Mock).mockImplementation(() => {
      callOrder.push('factura');
      return Promise.resolve('000100');
    });
    (restoreIssues as jest.Mock).mockImplementation(() => {
      callOrder.push('restore');
      return Promise.resolve({ transactionIds: ['tid-1'], costByProduct: new Map([['prod-1', 50]]) });
    });

    await post(`/${ORDER}/return`, {});

    const li = callOrder.indexOf('lock');
    const ri = callOrder.indexOf('restore');
    const rdi = callOrder.indexOf('read');
    const fi = callOrder.indexOf('factura');
    expect(li).toBeGreaterThanOrEqual(0);
    expect(fi).toBeGreaterThanOrEqual(0);
    expect(ri).toBeGreaterThanOrEqual(0);
    expect(rdi).toBeGreaterThanOrEqual(0);
    expect(li).toBeLessThan(fi);
    expect(li).toBeLessThan(rdi);
    expect(rdi).toBeLessThan(fi);
    expect(fi).toBeLessThan(ri);
  });

  it('FACTURA allocation failure prevents stock restoration on invoiced path', async () => {
    m.salesOrder.findFirst.mockResolvedValue(SHIPPED_INVOICED);
    (nextFacturaNumber as jest.Mock).mockRejectedValue(new Error('sequence exhausted'));
    const res = await post(`/${ORDER}/return`, {});
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(restoreIssues).not.toHaveBeenCalled();
  });

  it('lock fires and nextFacturaNumber is never called on the uninvoiced path', async () => {
    await post(`/${ORDER}/return`, {});
    expect(m.$queryRaw).toHaveBeenCalled();
    expect(nextFacturaNumber).not.toHaveBeenCalled();
  });
});

// ── currency guard ────────────────────────────────────────────────────────────

describe('currency guard fires before stock restoration', () => {
  const fxError = () => new AppError('FX not supported', 409, 'SALES_FX_NOT_IMPLEMENTED');

  it('on the uninvoiced path', async () => {
    (assertDocumentCurrencySupported as jest.Mock).mockRejectedValue(fxError());
    const res = await post(`/${ORDER}/return`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('SALES_FX_NOT_IMPLEMENTED');
    expect(restoreIssues).not.toHaveBeenCalled();
    expect(nextFacturaNumber).not.toHaveBeenCalled();
  });

  it('on the invoiced path', async () => {
    m.salesOrder.findFirst.mockResolvedValue(SHIPPED_INVOICED);
    (assertDocumentCurrencySupported as jest.Mock).mockRejectedValue(fxError());
    const res = await post(`/${ORDER}/return`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('SALES_FX_NOT_IMPLEMENTED');
    expect(restoreIssues).not.toHaveBeenCalled();
    expect(nextFacturaNumber).not.toHaveBeenCalled();
  });
});

// ── guarded final write ───────────────────────────────────────────────────────

describe('guarded final status write', () => {
  it('calls updateMany with tenant_id, current status, and returned_at: null', async () => {
    await post(`/${ORDER}/return`, {});
    expect(m.salesOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id:          ORDER,
          tenant_id:   TENANT,
          status:      SHIPPED_UNINVOICED.status,
          returned_at: null,
        }),
        data: expect.objectContaining({ status: 'RETURNED' }),
      }),
    );
  });

  it('returns 409 when updateMany count is 0', async () => {
    m.salesOrder.updateMany.mockResolvedValue({ count: 0 });
    const res = await post(`/${ORDER}/return`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.code).toBe('ORDER_RETURN_CONCURRENT_CONFLICT');
  });

  it('customer update is scoped to tenant_id', async () => {
    await post(`/${ORDER}/return`, {});
    expect(m.customer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenant_id: TENANT }),
      }),
    );
  });
});

// ── error propagation ─────────────────────────────────────────────────────────

describe('error propagation', () => {
  it('a postIssueCogs failure propagates — order is not marked returned', async () => {
    (postIssueCogs as jest.Mock).mockRejectedValue(new Error('GL failure'));
    const res = await post(`/${ORDER}/return`, {});
    expect(res.status).toBe(500);
    const returnedWrite = (m.salesOrder.updateMany as jest.Mock).mock.calls.find(
      (call: any[]) => call[0]?.data?.status === 'RETURNED',
    );
    expect(returnedWrite).toBeUndefined();
  });
});
