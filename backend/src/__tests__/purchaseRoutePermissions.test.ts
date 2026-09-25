import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import purchaseRoutes, { PURCHASE_ROUTE_PERMISSIONS } from '../modules/purchase/purchase.routes';
import procurementRoutes, { PROCUREMENT_ROUTE_PERMISSIONS } from '../modules/purchase/procurement.routes';
import { VENDOR_PAYMENT_ROUTE_PERMISSIONS } from '../modules/purchase/vendorPayment.routes';
import { PURCHASE_RETURN_ROUTE_PERMISSIONS } from '../modules/purchase/purchaseReturn.routes';
import { db } from '../infrastructure/database/client';
import { AppError } from '../shared/errors/AppError';
import type { AppEnv } from '../shared/context';

jest.mock('../infrastructure/database/client', () => ({
  db: {
    supplier: { findMany: jest.fn() },
    purchaseRequisition: { findMany: jest.fn(), count: jest.fn() },
  },
}));

const expectedPurchaseRoutes = {
  'GET /suppliers': ['purchase.supplier.read'],
  'POST /suppliers': ['purchase.supplier.maintain'],
  'PUT /suppliers/:id': ['purchase.supplier.maintain'],
  'GET /orders': ['purchase.order.read'],
  'GET /orders/received-not-invoiced': ['purchase.order.read'],
  'GET /orders/:id': ['purchase.order.read'],
  'GET /orders/:id/changes': ['purchase.order.read'],
  'PUT /orders/:id': ['purchase.order.update'],
  'PATCH /orders/:id/delivery': ['purchase.order.update'],
  'POST /orders': ['purchase.order.create'],
  'POST /orders/:id/confirm': ['purchase.order.confirm'],
  'POST /orders/:id/lines/:lineId/cancel-remainder': ['purchase.order.cancel'],
  'POST /orders/:id/receive': ['purchase.receipt.post'],
  'GET /orders/:id/receipts': ['purchase.receipt.read'],
  'GET /receipts': ['purchase.receipt.read'],
  'POST /orders/:id/cancel': ['purchase.order.cancel'],
  'GET /invoices': ['purchase.vendor_invoice.read'],
  'GET /invoices/:id': ['purchase.vendor_invoice.read'],
  'POST /invoices': ['purchase.vendor_invoice.create'],
  'POST /invoices/:id/match': ['purchase.vendor_invoice.match'],
  'POST /invoices/:id/approve-discrepancies': ['purchase.vendor_invoice.approve_discrepancy'],
  'POST /invoices/:id/post': ['purchase.vendor_invoice.post'],
  'POST /invoices/:id/cancel': ['purchase.vendor_invoice.cancel'],
  'POST /orders/:id/receive-and-invoice': [
    'purchase.receipt.post',
    'purchase.vendor_invoice.create',
    'purchase.vendor_invoice.match',
    'purchase.vendor_invoice.post',
  ],
  'GET /setup/trade-agreements': ['purchase.setup.read'],
  'POST /setup/trade-agreements': ['purchase.setup.maintain'],
  'POST /setup/trade-agreements/:id/close': ['purchase.setup.maintain'],
};

const expectedProcurementRoutes = {
  'GET /requisitions': ['purchase.requisition.read'],
  'POST /requisitions': ['purchase.requisition.create'],
  'GET /requisitions/:id': ['purchase.requisition.read'],
  'POST /requisitions/:id/submit': ['purchase.requisition.submit'],
  'POST /requisitions/:id/approve': ['purchase.requisition.approve'],
  'POST /requisitions/:id/reject': ['purchase.requisition.approve'],
  'POST /requisitions/:id/cancel': ['purchase.requisition.cancel'],
  'POST /requisitions/:id/purchase-order': ['purchase.order.create'],
  'POST /requisitions/:id/rfq': ['purchase.rfq.maintain'],
  'GET /rfq': ['purchase.rfq.read'],
  'POST /rfq': ['purchase.rfq.maintain'],
  'GET /rfq/:id': ['purchase.rfq.read'],
  'GET /rfq/:id/compare': ['purchase.rfq.read'],
  'POST /rfq/:id/vendors': ['purchase.rfq.maintain'],
  'POST /rfq/:id/send': ['purchase.rfq.send'],
  'POST /rfq/:id/award': ['purchase.rfq.award'],
  'POST /rfq/:id/cancel': ['purchase.rfq.cancel'],
  'POST /rfq/bids/:requestId': ['purchase.rfq.response.manage'],
  'POST /rfq/bids/:requestId/decline': ['purchase.rfq.response.manage'],
  'POST /rfq/bids/:requestId/reject': ['purchase.rfq.response.manage'],
};

const expectedVendorPaymentRoutes = {
  'GET /payments': ['purchase.vendor_payment.read'],
  'POST /payments': ['purchase.vendor_payment.create'],
  'POST /payments/:id/post': ['purchase.vendor_payment.post'],
  'POST /payments/:id/settle': ['purchase.vendor_payment.settle'],
  'POST /payments/:id/reverse': ['purchase.vendor_payment.reverse'],
  'GET /open-transactions': ['purchase.vendor_payment.read'],
  'GET /setup/payment-methods': ['purchase.setup.read'],
  'POST /setup/payment-methods': ['purchase.setup.maintain'],
  'PUT /setup/payment-methods/:id': ['purchase.setup.maintain'],
};

const expectedPurchaseReturnRoutes = {
  'GET /returns': ['purchase.return.read'],
  'POST /returns': ['purchase.return.create'],
  'GET /returns/:id': ['purchase.return.read'],
  'POST /returns/:id/ship': ['purchase.return.ship'],
  'POST /returns/:id/cancel': ['purchase.return.create'],
  'GET /credits': ['purchase.supplier_credit.read'],
  'POST /credits': ['purchase.supplier_credit.create'],
  'GET /credits/:id': ['purchase.supplier_credit.read'],
  'POST /credits/:id/post': ['purchase.supplier_credit.post'],
  'POST /credits/:id/cancel': ['purchase.supplier_credit.create'],
};

function buildMountedRouter(role: string, router: typeof purchaseRoutes) {
  const app = new Hono<AppEnv>();
  const setIdentity: MiddlewareHandler<AppEnv> = async (c, next) => {
    c.set('user', { id: 'user-1', email: 'test@test.com', role, tenantId: 'tenant-1' });
    c.set('tenantId', 'tenant-1');
    await next();
  };
  app.use('*', setIdentity);
  app.route('/', router);
  app.onError((error, c) => {
    if (error instanceof AppError) return c.json({ error: error.message }, error.statusCode as 403);
    return c.json({ error: error.message }, 500);
  });
  return app;
}

describe('purchasing route permission wiring', () => {
  beforeEach(() => jest.clearAllMocks());

  it('publishes and consumes the exact audited 66-route permission map', () => {
    expect(PURCHASE_ROUTE_PERMISSIONS).toEqual(expectedPurchaseRoutes);
    expect(PROCUREMENT_ROUTE_PERMISSIONS).toEqual(expectedProcurementRoutes);
    expect(VENDOR_PAYMENT_ROUTE_PERMISSIONS).toEqual(expectedVendorPaymentRoutes);
    expect(PURCHASE_RETURN_ROUTE_PERMISSIONS).toEqual(expectedPurchaseReturnRoutes);
    expect(Object.keys(PURCHASE_ROUTE_PERMISSIONS)).toHaveLength(27);
    expect(Object.keys(PROCUREMENT_ROUTE_PERMISSIONS)).toHaveLength(20);
    expect(Object.keys(VENDOR_PAYMENT_ROUTE_PERMISSIONS)).toHaveLength(9);
    expect(Object.keys(PURCHASE_RETURN_ROUTE_PERMISSIONS)).toHaveLength(10);
  });

  it('denies a customer on a mounted purchase route before its database handler', async () => {
    const app = buildMountedRouter('customer', purchaseRoutes);
    const response = await app.request('/suppliers');
    expect(response.status).toBe(403);
    expect(db.supplier.findMany).not.toHaveBeenCalled();

    const paymentResponse = await app.request('/payments');
    expect(paymentResponse.status).toBe(403);
  });

  it('denies an unknown role on a mounted procurement route before its database handler', async () => {
    const app = buildMountedRouter('unregistered-role', procurementRoutes);
    const response = await app.request('/requisitions');
    expect(response.status).toBe(403);
    expect(db.purchaseRequisition.findMany).not.toHaveBeenCalled();
    expect(db.purchaseRequisition.count).not.toHaveBeenCalled();
  });
});
