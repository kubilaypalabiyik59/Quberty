import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { db } from '../src/infrastructure/database/client';

/**
 * WORK-029 acceptance on Supabase TEST: O2C containment.
 *
 *   ALLOW_TEST_DATABASE_WRITE=WORK029_ACCEPTANCE npm run verify:o2c-containment
 *
 * Writes NOTHING. Every probe is a request the containment must refuse, sent
 * in-process to the real app against the real database with synthetic signed
 * tokens. It never makes a successful POS sale: that would permanently spend a
 * number from the continuous FACTURA series.
 */

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  if (process.env.ALLOW_TEST_DATABASE_WRITE !== 'WORK029_ACCEPTANCE') {
    throw new Error('Set ALLOW_TEST_DATABASE_WRITE=WORK029_ACCEPTANCE to confirm the TEST-only acceptance run.');
  }
  const app = (await import('../src/app')).default;

  const tenant = await db.tenant.findFirst({ where: { is_active: true }, orderBy: { created_at: 'asc' }, select: { id: true, slug: true } });
  if (!tenant) throw new Error('No active tenant.');
  const user = await db.user.findFirst({ where: { tenant_id: tenant.id }, select: { id: true, email: true } });
  if (!user) throw new Error('No user.');

  const facturaBefore = await db.numberSequence.findFirst({
    where: { tenant_id: tenant.id, legal_entity_id: null, reference: 'FACTURA' },
    select: { next_number: true, updated_at: true },
  });
  const sessionsBefore = await db.registerSession.count({ where: { tenant_id: tenant.id } });
  const activeWarehouses = await db.warehouse.count({ where: { tenant_id: tenant.id, is_active: true } });
  console.log(`Marker WORK029-${Date.now()} · tenant ${tenant.slug} · active warehouses ${activeWarehouses}`);

  const token = (role: string) => jwt.sign({ sub: user.id, email: user.email, role, tenantId: tenant.id }, process.env.JWT_SECRET!, { expiresIn: '5m' });
  const call = (role: string, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token(role)}`, 'x-tenant-id': tenant.id },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const code = async (res: Response) => ((await res.json().catch(() => ({}))) as any)?.error?.code;

  const sale = { session_id: randomUUID(), payment_method: 'CASH', lines: [{ product_id: randomUUID(), quantity: 1, unit_price: 1 }] };

  let res = await call('customer', 'POST', '/pos/sale', sale);
  check('a customer token is refused on POS sale', res.status === 403, `${res.status}`);
  res = await call('customer', 'POST', `/pos/sales/${randomUUID()}/void`);
  check('a customer token is refused on POS void', res.status === 403, `${res.status}`);
  res = await call('customer', 'GET', '/customers');
  check('a customer token is refused on the customer list', res.status === 403, `${res.status}`);

  res = await call('admin', 'POST', `/sales/orders/${randomUUID()}/complete`);
  check('completing an order outside the tenant returns 404', res.status === 404, `${res.status}`);

  res = await call('store_manager', 'PUT', `/customers/${randomUUID()}`, { tenant_id: randomUUID() });
  check('a customer update carrying tenant_id is refused', res.status === 400, `${res.status}`);

  res = await call('cashier', 'PUT', `/inventory-counts/${randomUUID()}/lines/${randomUUID()}`, { counted_qty: 1 });
  check('a cashier cannot edit count lines', res.status === 403, `${res.status}`);
  res = await call('store_manager', 'PUT', `/inventory-counts/${randomUUID()}/lines/${randomUUID()}`, { counted_qty: 1 });
  check('a count line of an unknown count returns 404', res.status === 404, `${res.status}`);

  res = await call('cashier', 'POST', '/pos/sessions/open', { terminal_name: `WORK029-${Date.now()}`, opening_float: 0, warehouse_id: randomUUID() });
  check('opening a register on a foreign warehouse is refused', res.status === 422, `${res.status} ${await code(res)}`);

  if (activeWarehouses > 1) {
    res = await call('cashier', 'POST', '/pos/sessions/open', { terminal_name: `WORK029-${Date.now()}`, opening_float: 0 });
    check('opening a register without a warehouse is refused when several exist', res.status === 422, `${res.status}`);
  } else {
    console.log('  NOTE  single-warehouse tenant: the "choose a warehouse" refusal is unit-tested only');
  }

  res = await call('cashier', 'POST', '/pos/sale', sale);
  check('a sale on an unknown session is refused', res.status === 400, `${res.status}`);

  const sessionsAfter = await db.registerSession.count({ where: { tenant_id: tenant.id } });
  check('no register session was created', sessionsAfter === sessionsBefore, `${sessionsBefore} → ${sessionsAfter}`);
  const facturaAfter = await db.numberSequence.findFirst({
    where: { tenant_id: tenant.id, legal_entity_id: null, reference: 'FACTURA' },
    select: { next_number: true, updated_at: true },
  });
  check('the FACTURA sequence is unchanged',
    Number(facturaAfter?.next_number) === Number(facturaBefore?.next_number)
      && facturaAfter?.updated_at?.getTime() === facturaBefore?.updated_at?.getTime(),
    `${facturaBefore?.next_number} → ${facturaAfter?.next_number}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await db.$disconnect();
  process.exit(1);
});
