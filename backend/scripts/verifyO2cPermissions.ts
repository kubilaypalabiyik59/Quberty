import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { db } from '../src/infrastructure/database/client';

/**
 * WORK-030a acceptance on Supabase TEST: the O2C permission registry, the
 * workforce gate and registration containment.
 *
 *   ALLOW_TEST_DATABASE_WRITE=WORK030_ACCEPTANCE npm run verify:o2c-permissions
 *
 * Writes no business data. Every probe is sent in-process to the real app against
 * the real database with synthetic signed tokens. One kind of write is expected:
 * the audit middleware records each refused write probe in audit_logs. Allow
 * probes are side-effect-free GETs only (not GET /sales/quotations, which expires
 * overdue SENT quotations as it lists); every write probe is one the registry must
 * refuse. It never makes a POS sale, and it checks that the FACTURA sequence, the
 * user count and the unit-of-measure count are the same afterwards. It prints
 * statuses, never data rows.
 */

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  if (process.env.ALLOW_TEST_DATABASE_WRITE !== 'WORK030_ACCEPTANCE') {
    throw new Error('Set ALLOW_TEST_DATABASE_WRITE=WORK030_ACCEPTANCE to confirm the TEST-only acceptance run.');
  }
  const app = (await import('../src/app')).default;

  const tenant = await db.tenant.findFirst({ where: { is_active: true }, orderBy: { created_at: 'asc' }, select: { id: true, slug: true } });
  if (!tenant) throw new Error('No active tenant.');
  const user = await db.user.findFirst({ where: { tenant_id: tenant.id }, select: { id: true, email: true } });
  if (!user) throw new Error('No user.');

  const snapshot = async () => ({
    factura: await db.numberSequence.findFirst({
      where: { tenant_id: tenant.id, legal_entity_id: null, reference: 'FACTURA' },
      select: { next_number: true, updated_at: true },
    }),
    users: await db.user.count({ where: { tenant_id: tenant.id } }),
    uoms: await db.unitOfMeasure.count({ where: { tenant_id: tenant.id } }),
  });
  const before = await snapshot();

  const token = (role: string) =>
    jwt.sign({ sub: user.id, email: user.email, role, tenantId: tenant.id }, process.env.JWT_SECRET!, { expiresIn: '5m' });
  const call = (role: string | null, method: string, path: string, body?: unknown) =>
    app.request(path.startsWith('/api/') ? path : `/api/v1${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-tenant-id': tenant.id,
        ...(role ? { authorization: `Bearer ${token(role)}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const status = async (role: string | null, method: string, path: string, body?: unknown) =>
    (await call(role, method, path, body)).status;
  const id = randomUUID();

  console.log('Allowed reads');
  check('store manager reads the trial balance (030c still role-guarded)', (await status('store_manager', 'GET', '/finance/trial-balance')) === 200);
  check('store manager lists sales orders', (await status('store_manager', 'GET', '/sales/orders')) === 200);
  check('cashier reads products', (await status('cashier', 'GET', '/products?limit=1')) === 200);
  check('cashier reads customers', (await status('cashier', 'GET', '/customers?limit=1')) === 200);
  check('cashier reads warehouses (030b)', (await status('cashier', 'GET', '/warehouse/warehouses')) === 200);
  check('cashier reads number sequences (030c)', (await status('cashier', 'GET', '/setup/number-sequences')) === 200);
  check('cashier reads the display currency', (await status('cashier', 'GET', '/tenant/currency')) === 200);
  check('employee reads leads', (await status('employee', 'GET', '/crm/leads?limit=1')) === 200);
  // Not GET /sales/quotations: listing quotations expires overdue SENT ones, so it
  // is a write. The auditor's read is probed on customers instead.
  check('auditor reads customers', (await status('auditor', 'GET', '/customers?limit=1')) === 200);

  const shopper = await call('customer', 'GET', '/products?limit=50&published=false');
  const shopperBody = (await shopper.json()) as any;
  const rows: any[] = shopperBody?.data ?? [];
  check('customer reads the catalogue', shopper.status === 200);
  check('customer sees no cost_price', rows.every((r) => !('cost_price' in r)), `${rows.length} rows checked`);
  check('customer sees published products only', rows.every((r) => r.is_published === true), `${rows.length} rows checked`);

  console.log('Refused');
  check('customer cannot read journal entries', (await status('customer', 'GET', '/finance/journal-entries')) === 403);
  check('customer cannot read the trial balance', (await status('customer', 'GET', '/finance/trial-balance')) === 403);
  check('customer cannot read facturas', (await status('customer', 'GET', '/finance/facturas')) === 403);
  check('customer cannot read leads', (await status('customer', 'GET', '/crm/leads')) === 403);
  check('customer cannot list sales orders', (await status('customer', 'GET', '/sales/orders')) === 403);
  check('customer cannot complete a warehouse work line', (await status('customer', 'POST', `/warehouse/work/${id}/lines/${id}/complete`, {})) === 403);
  check('customer cannot seed units of measure', (await status('customer', 'POST', '/uom/seed-defaults', {})) === 403);
  check('customer cannot start a paid video job', (await status('customer', 'POST', `/products/${id}/generate-video`, {})) === 403);
  check('an unknown role cannot read journal entries', (await status('superuser', 'GET', '/finance/journal-entries')) === 403);
  check('cashier cannot invoice a sales order', (await status('cashier', 'POST', `/sales/orders/${id}/invoice`, {})) === 403);
  check('cashier cannot list sales orders', (await status('cashier', 'GET', '/sales/orders')) === 403);
  check('cashier cannot void a POS sale', (await status('cashier', 'POST', `/pos/sales/${id}/void`, {})) === 403);
  check('employee cannot create a sales order', (await status('employee', 'POST', '/sales/orders', {})) === 403);
  check('employee cannot qualify a lead', (await status('employee', 'POST', `/crm/leads/${id}/qualify`, {})) === 403);
  check('buyer cannot read leads', (await status('buyer', 'GET', '/crm/leads')) === 403);
  check('registration without a tenant is refused', (await status(null, 'POST', '/api/v1/auth/register', {
    email: `nobody-${id}@example.invalid`, password: 'Password1!', first_name: 'No', last_name: 'Tenant',
  })) === 400);
  check('the self-promotion route is gone', (await status('store_manager', 'POST', '/api/v1/auth/make-admin', {})) === 404);

  console.log('Product, stock and warehouse (WORK-030b)');
  check('warehouse worker reads stock', (await status('warehouse_worker', 'GET', '/inventory/stock?product_id=' + id)) === 200);
  check('auditor reads inventory transactions', (await status('auditor', 'GET', '/inventory/transactions?product_id=' + id)) === 200);
  check('receiver reads warehouse work', (await status('receiver', 'GET', '/warehouse/work')) === 200);
  check('cashier cannot complete a warehouse work line', (await status('cashier', 'POST', `/warehouse/work/${id}/lines/${id}/complete`, {})) === 403);
  check('auditor cannot start warehouse work', (await status('auditor', 'POST', `/warehouse/work/${id}/start`, {})) === 403);
  check('cashier cannot create a unit of measure', (await status('cashier', 'POST', '/uom', {})) === 403);
  check('employee cannot adjust stock', (await status('employee', 'POST', '/inventory/adjust', {})) === 403);
  check('warehouse worker cannot post a count', (await status('warehouse_worker', 'POST', `/inventory-counts/${id}/finalize`, {})) === 403);
  check('store manager cannot create a site', (await status('store_manager', 'POST', '/warehouse/sites', {})) === 403);
  check('store manager cannot delete a product', (await status('store_manager', 'DELETE', `/products/${id}`)) === 403);
  check('store manager cannot run an import', (await status('store_manager', 'POST', `/import/jobs/${id}/execute`, {})) === 403);
  check('buyer cannot change item setup', (await status('buyer', 'POST', '/products/setup/item-groups', {})) === 403);
  check('adjusting into another tenant location is refused', (await status('store_manager', 'POST', '/inventory/adjust', {
    product_id: id, location_id: randomUUID(), quantity: 1,
  })) === 422);

  const after = await snapshot();
  check('FACTURA sequence unchanged',
    String(before.factura?.next_number) === String(after.factura?.next_number)
      && before.factura?.updated_at?.getTime() === after.factura?.updated_at?.getTime());
  check('user count unchanged', before.users === after.users, `${before.users} → ${after.users}`);
  check('unit-of-measure count unchanged', before.uoms === after.uoms, `${before.uoms} → ${after.uoms}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await db.$disconnect();
  process.exit(1);
});
