/**
 * PURCHASE ORDER NUMBERING (WORK-023)
 *
 * Purchase-order numbers come from the PURCHASE_ORDER number sequence, scoped to
 * the caller's tenant — no longer from order_counters. A missing sequence must
 * fail closed: no order is created without a number from the configured series.
 */

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import purchaseRoutes from '../modules/purchase/purchase.routes';
import { allocateNumber } from '../shared/services/numberSequence.service';
import { db } from '../infrastructure/database/client';
import { errorHandler } from '../shared/middleware/errorHandler';
import { AppError } from '../shared/errors/AppError';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    product:           { findFirst: jest.fn() },
    purchaseOrder:     { create: jest.fn() },
    financeParameters: { findFirst: jest.fn() },
    tenantCurrency:    { findFirst: jest.fn() },
  },
}));

jest.mock('../shared/services/numberSequence.service', () => ({
  allocateNumber: jest.fn(),
}));

jest.mock('../shared/services/tradeAgreement.service', () => ({
  purchasePriceFor: jest.fn().mockResolvedValue({ unitCost: 10 }),
}));

jest.mock('../shared/services/documentTax.service', () => ({
  computePurchaseMoney: jest.fn().mockResolvedValue({ recoverable_tax: 0, total: 20 }),
  computeDocumentTax: jest.fn(),
}));

const mockedAllocate = allocateNumber as jest.Mock;
const mockedDb = db as unknown as {
  product: { findFirst: jest.Mock };
  purchaseOrder: { create: jest.Mock };
  financeParameters: { findFirst: jest.Mock };
  tenantCurrency: { findFirst: jest.Mock };
};

function buildApp() {
  const app = new Hono<AppEnv>();
  const setIdentity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 'buyer@test.com', role: 'buyer', tenantId: 'tenant-1' });
    c.set('tenantId', 'tenant-1');
    await next();
  };
  app.use('*', setIdentity);
  app.route('/', purchaseRoutes);
  app.onError(errorHandler);
  return app;
}

const createOrder = (app: Hono<AppEnv>) => app.request('/orders', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    supplier_id: '11111111-1111-4111-8111-111111111111',
    lines: [{ product_id: '22222222-2222-4222-8222-222222222222', quantity: 2, unit_cost: 10 }],
  }),
});

describe('purchase order numbering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedDb.product.findFirst.mockResolvedValue({ item_group_id: null });
    mockedDb.purchaseOrder.create.mockImplementation(async ({ data }: any) => ({ id: 'po-1', ...data }));
    // A Turkish ledger: the order takes the ledger's currency, not a literal.
    mockedDb.financeParameters.findFirst.mockResolvedValue({
      legal_entity_id: null, accounting_currency_code: 'TRY', reporting_currency_code: 'TRY',
      accounting_rate_type_id: 'rt-1', reporting_rate_type_id: null, exchange_rate_date_basis: 'POSTING_DATE',
    });
    mockedDb.tenantCurrency.findFirst.mockResolvedValue({ id: 'tc-1' });
  });

  it('allocates the number from the tenant PURCHASE_ORDER sequence', async () => {
    mockedAllocate.mockResolvedValue('PO-2026-00042');
    const res = await createOrder(buildApp());

    expect(res.status).toBe(201);
    expect(mockedAllocate).toHaveBeenCalledWith({ tenantId: 'tenant-1', reference: 'PURCHASE_ORDER', legalEntityId: null });
    expect(mockedDb.purchaseOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenant_id: 'tenant-1', po_number: 'PO-2026-00042', currency: 'TRY' }),
    }));
  });

  it('refuses a currency the tenant has not activated, before drawing a number', async () => {
    mockedDb.tenantCurrency.findFirst.mockResolvedValue(null);
    const res = await buildApp().request('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        supplier_id: '11111111-1111-4111-8111-111111111111',
        currency: 'USD',
        lines: [{ product_id: '22222222-2222-4222-8222-222222222222', quantity: 2, unit_cost: 10 }],
      }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CURRENCY_INACTIVE');
    expect(mockedAllocate).not.toHaveBeenCalled();
    expect(mockedDb.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it('creates no order when the tenant has no PURCHASE_ORDER sequence', async () => {
    mockedAllocate.mockRejectedValue(new AppError("No number sequence configured for 'PURCHASE_ORDER'.", 500, 'NUMBER_SEQUENCE_MISSING'));
    const res = await createOrder(buildApp());

    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NUMBER_SEQUENCE_MISSING');
    expect(mockedDb.purchaseOrder.create).not.toHaveBeenCalled();
  });
});
