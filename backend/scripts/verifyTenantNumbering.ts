import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * WORK-023 acceptance: document numbers are unique per tenant, not globally.
 *
 *   npm run verify:tenant-numbering
 *
 * Leaves NOTHING behind. The behaviour proof runs inside one transaction that is
 * always rolled back: for each document table it copies an existing row into a
 * random, non-existent tenant id (allowed — none of these tables has a foreign
 * key to tenants) and then re-inserts the same number into the SAME tenant under
 * a savepoint, which must be refused by the new composite index.
 *
 * Tables with no source row are reported as "catalog-proven only", never passed
 * silently.
 */

const TABLES = [
  { table: 'purchase_orders',  column: 'po_number',       filter: '' },
  { table: 'warehouse_work',   column: 'work_id_code',    filter: '' },
  { table: 'arrival_journals', column: 'journal_number',  filter: '' },
  { table: 'journal_entries',  column: 'entry_number',    filter: 'AND corrects_entry_id IS NULL' },
  { table: 'sales_orders',     column: 'order_number',    filter: '' },
  { table: 'shipments',        column: 'shipment_number', filter: '' },
  { table: 'inventory_counts', column: 'reference',       filter: '' },
] as const;

const newIndex = (t: typeof TABLES[number]) => `${t.table}_tenant_id_${t.column}_key`;
const oldIndex = (t: typeof TABLES[number]) => `${t.table}_${t.column}_key`;

class Rollback extends Error {}

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const marker = `WORK023-${Date.now()}`;
  console.log(`Marker ${marker}`);

  // ── 1. Catalog ─────────────────────────────────────────────────────────────
  console.log('\n1. Index catalog');
  for (const t of TABLES) {
    const rows = await db.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1`,
      t.table,
    );
    const composite = rows.find((r) => r.indexname === newIndex(t));
    check(
      `${t.table}: unique (tenant_id, ${t.column})`,
      !!composite && /UNIQUE/i.test(composite.indexdef) && composite.indexdef.includes(`(tenant_id, ${t.column})`),
      composite?.indexdef ?? 'missing',
    );
    check(`${t.table}: global unique on ${t.column} removed`, !rows.some((r) => r.indexname === oldIndex(t)));
  }

  // ── 2. Behaviour (rolled back) ─────────────────────────────────────────────
  console.log('\n2. Behaviour (inside a rolled-back transaction)');
  const catalogOnly: string[] = [];
  try {
    await db.$transaction(async (tx) => {
      const [{ foreign }] = await tx.$queryRawUnsafe<{ foreign: string }[]>(`SELECT gen_random_uuid()::text AS foreign`);

      // Since WORK-024b a voucher names its tenant's ledger currencies, and the
      // database refuses a currency the tenant has not activated. Give the stand-in
      // tenant the same activated currencies, so the copy below tests the NUMBERING
      // rule rather than tripping over a currency reference.
      await tx.$executeRawUnsafe(
        `INSERT INTO tenant_currencies (id, tenant_id, currency_code, rounding_precision, rounding_method, is_active, created_at, updated_at)
         SELECT DISTINCT ON (currency_code)
                gen_random_uuid(), $1::uuid, currency_code, rounding_precision, rounding_method, true, NOW(), NOW()
           FROM tenant_currencies
          WHERE tenant_id = (SELECT tenant_id FROM journal_entries LIMIT 1)
          ORDER BY currency_code`,
        foreign,
      );
      for (const t of TABLES) {
        const source = await tx.$queryRawUnsafe<{ id: string; tenant_id: string; num: string }[]>(
          `SELECT id::text, tenant_id::text, "${t.column}" AS num FROM "${t.table}" WHERE true ${t.filter} LIMIT 1`,
        );
        if (source.length === 0) { catalogOnly.push(t.table); continue; }
        const src = source[0];

        const copy = (tenantExpr: string) => tx.$executeRawUnsafe(
          `INSERT INTO "${t.table}"
           SELECT (jsonb_populate_record(NULL::"${t.table}",
                   to_jsonb(s) || jsonb_build_object('id', gen_random_uuid(), 'tenant_id', ${tenantExpr}))).*
           FROM "${t.table}" s WHERE s.id = $1::uuid`,
          src.id,
        );

        let otherTenantOk = true;
        let detail = '';
        await tx.$executeRawUnsafe(`SAVEPOINT other_tenant`);
        try { await copy(`'${foreign}'::uuid`); }
        catch (e: any) { otherTenantOk = false; detail = e?.message ?? String(e); }
        await tx.$executeRawUnsafe(otherTenantOk ? `RELEASE SAVEPOINT other_tenant` : `ROLLBACK TO SAVEPOINT other_tenant`);
        check(`${t.table}: ${src.num} is accepted in another tenant`, otherTenantOk, detail);

        let refusedByIndex = false;
        await tx.$executeRawUnsafe(`SAVEPOINT same_tenant`);
        try { await copy(`'${src.tenant_id}'::uuid`); }
        // Postgres reports a unique violation by its key columns, not its index
        // name: `Code: 23505 ... Key (tenant_id, <col>)=(...) already exists`.
        // Requiring exactly the composite key means a refusal by any other
        // constraint cannot pass here by accident.
        catch (e: any) {
          const msg = String(e?.message ?? '');
          refusedByIndex = msg.includes('23505') && msg.includes(`Key (tenant_id, ${t.column})=`);
          detail = msg;
        }
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT same_tenant`);
        check(`${t.table}: ${src.num} is refused twice in the same tenant`, refusedByIndex, refusedByIndex ? '' : detail);
      }
      throw new Rollback();
    }, { timeout: 60_000 });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  if (catalogOnly.length) console.log(`  NOTE  catalog-proven only (no source row): ${catalogOnly.join(', ')}`);

  // ── 3. Purchase-order sequence ─────────────────────────────────────────────
  console.log('\n3. Purchase-order number sequence');
  const tenants = await db.tenant.findMany({ select: { id: true, slug: true } });
  for (const tenant of tenants) {
    const seqs = await db.numberSequence.findMany({
      where: { tenant_id: tenant.id, legal_entity_id: null, reference: 'PURCHASE_ORDER' },
      select: { next_number: true, continuous: true, manual: true, scope: true, is_active: true },
    });
    check(`${tenant.slug}: exactly one PURCHASE_ORDER sequence`, seqs.length === 1, `${seqs.length}`);
    if (seqs.length !== 1) continue;
    const [{ max }] = await db.$queryRawUnsafe<{ max: bigint | null }[]>(
      `SELECT MAX((substring(po_number FROM '^PO-[0-9]{4}-([0-9]+)$'))::bigint) AS max
         FROM purchase_orders WHERE tenant_id = $1::uuid`,
      tenant.id,
    );
    const highest = Number(max ?? 0);
    const s = seqs[0];
    check(`${tenant.slug}: next number ${s.next_number} is above the highest issued ${highest}`, Number(s.next_number) > highest);
    check(`${tenant.slug}: non-continuous, automatic, LEGAL_ENTITY, active`,
      !s.continuous && !s.manual && s.scope === 'LEGAL_ENTITY' && s.is_active);

    const factura = await db.numberSequence.findFirst({
      where: { tenant_id: tenant.id, legal_entity_id: null, reference: 'FACTURA' },
      select: { next_number: true, continuous: true, manual: true, scope: true },
    });
    console.log(`  INFO  ${tenant.slug}: FACTURA ${JSON.stringify(factura && { ...factura, next_number: Number(factura.next_number) })}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
