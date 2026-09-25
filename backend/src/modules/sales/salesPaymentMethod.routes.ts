import { Hono } from 'hono';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { routeGuard, type RouteGuards } from '../../shared/middleware/permissions';
import { validate } from '../../shared/middleware/validate';
import { ok, created } from '../../shared/response';
import { SalesPaymentMethodSchema, UpdateSalesPaymentMethodSchema } from '../../shared/schemas';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();

/**
 * Sales payment methods (WORK-047): how customers pay and which ledger account each
 * tender debits. The till and the managers read them; mapping a method to an
 * account is the admin's.
 */
export const SALES_PAYMENT_METHOD_ROUTE_PERMISSIONS = Object.freeze({
  'GET /': ['sales.payment_method.read'],
  'POST /': ['sales.payment_method.maintain'],
  'PUT /:id': ['sales.payment_method.maintain'],
} satisfies RouteGuards);

const guard = routeGuard(SALES_PAYMENT_METHOD_ROUTE_PERMISSIONS);

/** The account must be the tenant's, active, and a posting account (not a heading). */
async function assertPostingAccount(tenantId: string, accountId: string) {
  const account = await db.account.findFirst({
    where: { id: accountId, tenant_id: tenantId, is_active: true },
    select: { id: true, category: true },
  });
  if (!account || account.category === 'HEADING') {
    throw new AppError('Choose an active posting account of this company for the payment method', 422, 'FOREIGN_REFERENCE');
  }
}

app.get('/', guard('GET /'), async (c) => {
  const methods = await db.salesPaymentMethod.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: { account: { select: { code: true, name: true } } },
    orderBy: [{ is_active: 'desc' }, { code: 'asc' }],
  });
  return ok(c, methods);
});

app.post('/', guard('POST /'), validate(SalesPaymentMethodSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof SalesPaymentMethodSchema>;
  const tenantId = c.get('tenantId');
  await assertPostingAccount(tenantId, body.account_id!);
  const method = await db.salesPaymentMethod.create({
    data: {
      tenant_id: tenantId,
      code: body.code!,
      name: body.name!,
      tender_type: body.tender_type!,
      account_id: body.account_id!,
      declaration_policy: body.declaration_policy ?? 'NONE',
      allow_change: body.allow_change ?? false,
      max_difference_amount: body.max_difference_amount ?? null,
      is_active: body.is_active ?? true,
    },
  });
  return created(c, method);
});

app.put('/:id', guard('PUT /:id'), validate(UpdateSalesPaymentMethodSchema), async (c) => {
  const body = c.get('body') as z.infer<typeof UpdateSalesPaymentMethodSchema>;
  const tenantId = c.get('tenantId');
  const existing = await db.salesPaymentMethod.findFirst({ where: { id: c.req.param('id'), tenant_id: tenantId } });
  if (!existing) throw new AppError('Payment method not found', 404);
  if (body.account_id) await assertPostingAccount(tenantId, body.account_id);
  if (body.allow_change && existing.tender_type !== 'CASH') {
    throw new AppError('Only a cash method gives change', 400, 'VALIDATION_ERROR');
  }
  // An open register expects this method's takings on the account its tenders
  // debited; the close would post the difference against the new one (review 3).
  // The open registers are locked for the check and the update, so a sale — which
  // locks its register first — cannot add a tender in between.
  const method = await db.$transaction(async (tx) => {
    if (body.account_id && body.account_id !== existing.account_id) {
      const open = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM register_sessions WHERE tenant_id = ${tenantId}::uuid AND status = 'OPEN' ORDER BY id FOR UPDATE`,
      );
      const inUse = open.length === 0 ? 0 : await tx.posTender.count({
        where: { tenant_id: tenantId, payment_method_id: existing.id, reversed_at: null, register_session_id: { in: open.map((r) => r.id) } },
      });
      if (inUse > 0) {
        throw new AppError(
          `${existing.code} has takings in an open register. Close the registers before changing its account.`,
          409,
          'PAYMENT_METHOD_IN_USE',
        );
      }
    }
    // Tenders snapshot the account, so changing it here never rewrites a posted sale.
    return tx.salesPaymentMethod.update({ where: { id: existing.id }, data: body });
  });
  return ok(c, method);
});

export default app;
