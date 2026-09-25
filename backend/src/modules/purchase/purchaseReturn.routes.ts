import { Hono } from 'hono';
import { AppError } from '../../shared/errors/AppError';
import { requirePermission, type Permission } from '../../shared/middleware/permissions';
import { ok, created } from '../../shared/response';
import {
  createReturnFromInvoice, shipReturn, cancelReturn, listReturns, getReturn,
  createCredit, postCredit, cancelCredit, listCredits, getCredit,
} from './purchaseReturn.service';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

export const PURCHASE_RETURN_ROUTE_PERMISSIONS = {
  'GET /returns':              ['purchase.return.read'],
  'POST /returns':             ['purchase.return.create'],
  'GET /returns/:id':          ['purchase.return.read'],
  'POST /returns/:id/ship':    ['purchase.return.ship'],
  'POST /returns/:id/cancel':  ['purchase.return.create'],
  'GET /credits':              ['purchase.supplier_credit.read'],
  'POST /credits':             ['purchase.supplier_credit.create'],
  'GET /credits/:id':          ['purchase.supplier_credit.read'],
  'POST /credits/:id/post':    ['purchase.supplier_credit.post'],
  'POST /credits/:id/cancel':  ['purchase.supplier_credit.create'],
} as const satisfies Record<string, readonly Permission[]>;

function guard(route: keyof typeof PURCHASE_RETURN_ROUTE_PERMISSIONS) {
  const perms = [...PURCHASE_RETURN_ROUTE_PERMISSIONS[route]] as [Permission, ...Permission[]];
  return requirePermission(...perms);
}

// ── Supplier returns ──────────────────────────────────────────────────────────

app.get('/returns', guard('GET /returns'), async (c) => {
  const { supplier_id, status } = c.req.query();
  const rows = await listReturns(c.get('tenantId'), supplier_id, status);
  return ok(c, rows);
});

app.post('/returns', guard('POST /returns'), async (c) => {
  const body = await c.req.json();
  if (!body.invoice_id) throw new AppError('invoice_id is required.', 400);
  if (!body.warehouse_id) throw new AppError('warehouse_id is required.', 400);
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new AppError('At least one return line is required.', 400);
  }
  const result = await createReturnFromInvoice(
    c.get('tenantId'), c.get('user').id, body,
  );
  return created(c, result);
});

app.get('/returns/:id', guard('GET /returns/:id'), async (c) => {
  const ret = await getReturn(c.get('tenantId'), c.req.param('id'));
  return ok(c, ret);
});

app.post('/returns/:id/ship', guard('POST /returns/:id/ship'), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = await shipReturn(
    c.get('tenantId'), c.get('user').id, c.req.param('id'), body,
  );
  return ok(c, result);
});

app.post('/returns/:id/cancel', guard('POST /returns/:id/cancel'), async (c) => {
  await cancelReturn(c.get('tenantId'), c.req.param('id'));
  return ok(c, null);
});

// ── Supplier credits ──────────────────────────────────────────────────────────

app.get('/credits', guard('GET /credits'), async (c) => {
  const { supplier_id, status } = c.req.query();
  const rows = await listCredits(c.get('tenantId'), supplier_id, status);
  return ok(c, rows);
});

app.post('/credits', guard('POST /credits'), async (c) => {
  const body = await c.req.json();
  if (!body.invoice_id) throw new AppError('invoice_id is required.', 400);
  if (!body.credit_date) throw new AppError('credit_date is required.', 400);
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    throw new AppError('At least one credit line is required.', 400);
  }
  const result = await createCredit(c.get('tenantId'), c.get('user').id, body);
  return created(c, result);
});

app.get('/credits/:id', guard('GET /credits/:id'), async (c) => {
  const credit = await getCredit(c.get('tenantId'), c.req.param('id'));
  return ok(c, credit);
});

app.post('/credits/:id/post', guard('POST /credits/:id/post'), async (c) => {
  const result = await postCredit(
    c.get('tenantId'), c.get('user').id, c.req.param('id'),
  );
  return ok(c, result);
});

app.post('/credits/:id/cancel', guard('POST /credits/:id/cancel'), async (c) => {
  await cancelCredit(c.get('tenantId'), c.req.param('id'));
  return ok(c, null);
});

export default app;
