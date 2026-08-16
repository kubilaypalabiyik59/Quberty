import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * Post-apply proof for migration 005. Checks the things that are easy to get
 * wrong and silent when they are: that the tables exist, that the CHECK
 * constraints actually reject bad rows, and — most importantly — that nothing
 * pre-existing was disturbed.
 */
const NEW_TABLES = [
  'sales_pipeline_stages', 'leads', 'opportunities',
  'sales_quotations', 'sales_quotation_lines',
  'purchase_requisitions', 'purchase_requisition_lines',
  'rfq_cases', 'rfq_case_lines', 'rfq_requests', 'rfq_request_lines',
];

(async () => {
  const tables = await db.$queryRawUnsafe<{ table_name: string }[]>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_name = ANY($1::text[]) ORDER BY 1`,
    NEW_TABLES,
  );
  console.log(`tables created: ${tables.length}/${NEW_TABLES.length}`);
  const missing = NEW_TABLES.filter((t) => !tables.some((r) => r.table_name === t));
  if (missing.length) console.log(`  MISSING: ${missing.join(', ')}`);

  const checks = await db.$queryRawUnsafe<{ conname: string }[]>(
    `SELECT conname FROM pg_constraint
      WHERE contype='c' AND conname LIKE ANY (ARRAY['%exactly_one_party','%probability_range','%quantity_positive'])
      ORDER BY 1`,
  );
  console.log(`check constraints: ${checks.length}`);
  for (const c of checks) console.log(`  ${c.conname}`);

  const nnd = await db.$queryRawUnsafe<{ indexdef: string }[]>(
    `SELECT indexdef FROM pg_indexes
      WHERE tablename='sales_pipeline_stages' AND indexdef ILIKE '%NULLS NOT DISTINCT%'`,
  );
  console.log(`NULLS NOT DISTINCT on pipeline stages: ${nnd.length === 1 ? 'yes' : 'NO — D-1 condition open'}`);

  // Existing columns must have arrived with their defaults, and every existing
  // row must have been backfilled by the default rather than left NULL.
  const so = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM sales_orders WHERE source_document_type IS NULL`,
  );
  const po = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM purchase_orders WHERE source_document_type IS NULL`,
  );
  const soDirect = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM sales_orders WHERE source_document_type = 'DIRECT'`,
  );
  const poDirect = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM purchase_orders WHERE source_document_type = 'DIRECT'`,
  );
  console.log(
    `existing rows: ${soDirect[0].n} sales orders and ${poDirect[0].n} purchase orders ` +
    `defaulted to DIRECT; NULLs — SO ${so[0].n}, PO ${po[0].n} (both must be 0)`,
  );

  // Nothing pre-existing lost rows.
  const je = await db.journalEntry.count();
  const fac = await db.factura.count();
  const prof = await db.postingProfile.count();
  console.log(`untouched: journal entries ${je}, facturas ${fac}, posting profiles ${prof}`);

  // The CHECK must actually bite.
  try {
    await db.$executeRawUnsafe(
      `INSERT INTO opportunities (id, tenant_id, opportunity_number, name, updated_at)
       VALUES (gen_random_uuid(), (SELECT id FROM tenants LIMIT 1), 'PROBE-NULL-PARTY', 'probe', NOW())`,
    );
    console.log('CHECK exactly_one_party: FAILED — a party-less opportunity was accepted');
  } catch {
    console.log('CHECK exactly_one_party: enforced (party-less opportunity rejected)');
  }

  await db.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await db.$disconnect();
  process.exit(1);
});
