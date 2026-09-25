import { Hono } from 'hono';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requirePermission, type Permission } from '../../shared/middleware/permissions';
import { created, ok } from '../../shared/response';
import type { AppEnv } from '../../shared/context';
import {
  createVendorPayment,
  listVendorOpenTransactions,
  listVendorPayments,
  postVendorPayment,
  reverseVendorPayment,
  settleVendorPayment,
} from './vendorPayment.service';

const app = new Hono<AppEnv>();

export const VENDOR_PAYMENT_ROUTE_PERMISSIONS = {
  'GET /payments': ['purchase.vendor_payment.read'],
  'POST /payments': ['purchase.vendor_payment.create'],
  'POST /payments/:id/post': ['purchase.vendor_payment.post'],
  'POST /payments/:id/settle': ['purchase.vendor_payment.settle'],
  'POST /payments/:id/reverse': ['purchase.vendor_payment.reverse'],
  'GET /open-transactions': ['purchase.vendor_payment.read'],
  'GET /setup/payment-methods': ['purchase.setup.read'],
  'POST /setup/payment-methods': ['purchase.setup.maintain'],
  'PUT /setup/payment-methods/:id': ['purchase.setup.maintain'],
} as const satisfies Record<string, readonly Permission[]>;

function guard(route: keyof typeof VENDOR_PAYMENT_ROUTE_PERMISSIONS) {
  return requirePermission(...[...VENDOR_PAYMENT_ROUTE_PERMISSIONS[route]] as [Permission, ...Permission[]]);
}

app.get('/payments', guard('GET /payments'), async c => ok(c, await listVendorPayments(c.get('tenantId'), c.req.query('supplier_id'))));

app.post('/payments', guard('POST /payments'), async c => {
  const body = await c.req.json();
  if (!body.supplier_id || !body.payment_method_id) throw new AppError('supplier_id and payment_method_id are required.', 400);
  return created(c, await createVendorPayment(c.get('tenantId'), c.get('user').id, body));
});

app.post('/payments/:id/post', guard('POST /payments/:id/post'), async c => {
  return ok(c, await postVendorPayment(c.get('tenantId'), c.get('user').id, c.req.param('id'), await c.req.json().catch(() => ({}))));
});

app.post('/payments/:id/settle', guard('POST /payments/:id/settle'), async c => {
  const body = await c.req.json();
  if (!Array.isArray(body.allocations)) throw new AppError('allocations must be an array.', 400);
  return ok(c, await settleVendorPayment(c.get('tenantId'), c.get('user').id, c.req.param('id'), body));
});

app.post('/payments/:id/reverse', guard('POST /payments/:id/reverse'), async c => {
  return ok(c, await reverseVendorPayment(c.get('tenantId'), c.get('user').id, c.req.param('id'), await c.req.json()));
});

app.get('/open-transactions', guard('GET /open-transactions'), async c => {
  return ok(c, await listVendorOpenTransactions(c.get('tenantId'), c.req.query('supplier_id')));
});

app.get('/setup/payment-methods', guard('GET /setup/payment-methods'), async c => {
  const rows = await db.purchasePaymentMethod.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: { offset_account: { select: { code: true, name: true } } },
    orderBy: [{ is_active: 'desc' }, { code: 'asc' }],
  });
  return ok(c, rows);
});

app.post('/setup/payment-methods', guard('POST /setup/payment-methods'), async c => {
  const body = await c.req.json();
  if (!body.code?.trim() || !body.name?.trim() || !body.offset_account_id) {
    throw new AppError('code, name, and offset_account_id are required.', 400);
  }
  if (!['BANK', 'CASH', 'LEDGER'].includes(body.account_type)) throw new AppError('account_type must be BANK, CASH, or LEDGER.', 400);
  const account = await db.account.findFirst({ where: { id: body.offset_account_id, tenant_id: c.get('tenantId'), is_active: true } });
  if (!account) throw new AppError('Active offset account not found for this tenant.', 404);
  return created(c, await db.purchasePaymentMethod.create({
    data: {
      tenant_id: c.get('tenantId'),
      legal_entity_id: body.legal_entity_id ?? null,
      code: body.code.trim().toUpperCase(),
      name: body.name.trim(),
      account_type: body.account_type,
      offset_account_id: account.id,
      allowed_currency: body.allowed_currency?.trim().toUpperCase() || null,
      bank_account_reference: body.bank_account_reference?.trim() || null,
      reconciliation_reference: body.reconciliation_reference?.trim() || null,
      is_active: body.is_active ?? true,
    },
  }));
});

app.put('/setup/payment-methods/:id', guard('PUT /setup/payment-methods/:id'), async c => {
  const body = await c.req.json();
  if (body.offset_account_id) {
    const account = await db.account.findFirst({ where: { id: body.offset_account_id, tenant_id: c.get('tenantId'), is_active: true } });
    if (!account) throw new AppError('Active offset account not found for this tenant.', 404);
  }
  const existing = await db.purchasePaymentMethod.findFirst({ where: { id: c.req.param('id'), tenant_id: c.get('tenantId') } });
  if (!existing) throw new AppError('Payment method not found.', 404);
  return ok(c, await db.purchasePaymentMethod.update({
    where: { id: existing.id },
    data: {
      ...(body.name != null ? { name: String(body.name).trim() } : {}),
      ...(body.offset_account_id ? { offset_account_id: body.offset_account_id } : {}),
      ...(body.allowed_currency !== undefined ? { allowed_currency: body.allowed_currency?.trim().toUpperCase() || null } : {}),
      ...(body.bank_account_reference !== undefined ? { bank_account_reference: body.bank_account_reference?.trim() || null } : {}),
      ...(body.reconciliation_reference !== undefined ? { reconciliation_reference: body.reconciliation_reference?.trim() || null } : {}),
      ...(body.is_active !== undefined ? { is_active: Boolean(body.is_active) } : {}),
    },
  }));
});

export default app;
