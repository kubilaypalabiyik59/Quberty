/**
 * Verify migration 014 — the PIM setup module and its backfill.
 *
 *   npx tsx scripts/verifyPimSetup.ts
 *
 * The assertion that matters is the LOSSLESS one: every variant that carried a
 * size in `attributes` must now resolve to the same size through the typed
 * structure. `attributes` is deliberately not deleted, so the two representations
 * can be compared — and this script is that comparison.
 *
 * Read-only apart from one round-trip that creates a variant and deletes it again.
 */
import { db } from '../src/infrastructure/database/client';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = '') {
  if (condition) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  const tenant = await db.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) throw new Error('No tenant.');
  console.log(`Tenant: ${tenant.name}\n`);

  // ── 1. The setup entities exist ──────────────────────────────────────────
  console.log('1  Setup entities');
  const dims = await db.productDimension.findMany({ where: { tenant_id: tenant.id } });
  check('a SIZE dimension exists', dims.some(d => d.code === 'SIZE'), dims.map(d => d.code).join(','));

  const sizeDim = dims.find(d => d.code === 'SIZE')!;
  const values = await db.productDimensionValue.findMany({
    where: { tenant_id: tenant.id, dimension_id: sizeDim.id },
    orderBy: { sort_order: 'asc' },
  });
  console.log(`        sizes, in sort order: ${values.map(v => v.value).join(' ')}`);
  check('size values were created', values.length > 0, `${values.length}`);

  // The whole reason sort_order exists.
  const numeric = values.filter(v => /^[0-9]+$/.test(v.value));
  const sortedRight = numeric.every((v, i) => i === 0 || Number(numeric[i - 1].value) <= Number(v.value));
  check('numeric sizes sort numerically, not as text', sortedRight);

  const group = await db.productDimensionGroup.findFirst({
    where: { tenant_id: tenant.id, code: 'SIZE' },
    include: { lines: true },
  });
  check('a "size only" dimension group exists with one line',
    !!group && group.lines.length === 1, group ? `${group.lines.length} lines` : 'missing');

  const valueGroup = await db.productDimensionValueGroup.findFirst({
    where: { tenant_id: tenant.id, code: 'SIZE-ALL' },
    include: { members: true },
  });
  check('a size group holds every size in use',
    !!valueGroup && valueGroup.members.length === values.length,
    valueGroup ? `${valueGroup.members.length} of ${values.length}` : 'missing');

  const params = await db.productParameters.findFirst({
    where: { tenant_id: tenant.id, legal_entity_id: null },
  });
  check('PIM has a module parameters record', !!params);
  check('require_complete_variants defaults to false (nothing breaks)',
    params?.require_complete_variants === false);

  // ── 2. The backfill is lossless ──────────────────────────────────────────
  console.log('\n2  Backfill — the typed structure must agree with the JSON it replaced');
  const variants = await db.productVariant.findMany({
    where: { tenant_id: tenant.id },
    select: { id: true, sku_variant: true, attributes: true, values: { include: { value: true, dimension: true } } },
  });

  const withJsonSize = variants.filter(v => (v.attributes as any)?.Sizes !== undefined);
  console.log(`        variants: ${variants.length}, of which carried a JSON size: ${withJsonSize.length}`);

  let mismatched = 0;
  let unmapped = 0;
  for (const v of withJsonSize) {
    const json = String((v.attributes as any).Sizes);
    const typed = v.values.find(x => x.dimension.code === 'SIZE')?.value.value;
    if (typed === undefined) { unmapped++; console.log(`        UNMAPPED ${v.sku_variant} json=${json}`); }
    else if (typed !== json) { mismatched++; console.log(`        MISMATCH ${v.sku_variant} json=${json} typed=${typed}`); }
  }
  check('every JSON size is now readable through the typed structure', unmapped === 0, `${unmapped} unmapped`);
  check('and every one of them agrees', mismatched === 0, `${mismatched} mismatched`);

  // ── 3. Products carry the group only when they actually vary ─────────────
  console.log('\n3  Dimension group assignment');
  const products = await db.product.findMany({
    where: { tenant_id: tenant.id },
    select: { sku: true, dimension_group_id: true, tracking_policy: true, _count: { select: { variants: true } } },
  });
  for (const p of products) {
    console.log(`        ${p.sku.padEnd(18)} variants=${String(p._count.variants).padStart(3)}  group=${p.dimension_group_id ? 'SIZE' : '—'}  tracking=${p.tracking_policy}`);
  }
  check('every product WITH variants has a dimension group',
    products.filter(p => p._count.variants > 0).every(p => !!p.dimension_group_id));
  check('every product WITHOUT variants has none — NULL is a real answer, not a gap',
    products.filter(p => p._count.variants === 0).every(p => !p.dimension_group_id));
  check('tracking_policy defaults to NONE everywhere',
    products.every(p => p.tracking_policy === 'NONE'));

  // ── 4. The referential integrity that was missing ────────────────────────
  console.log('\n4  Variant foreign keys');
  const orphanSales = await db.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n FROM sales_order_lines sol
    LEFT JOIN product_variants pv ON pv.id = sol.variant_id
    WHERE sol.variant_id IS NOT NULL AND pv.id IS NULL`);
  const orphanPurchase = await db.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n FROM purchase_order_lines pol
    LEFT JOIN product_variants pv ON pv.id = pol.variant_id
    WHERE pol.variant_id IS NOT NULL AND pv.id IS NULL`);
  check('no orphan sales_order_lines.variant_id', orphanSales[0].n === 0);
  check('no orphan purchase_order_lines.variant_id', orphanPurchase[0].n === 0);

  // Prove the constraint is real rather than trusting that it was created.
  //
  // Inside a transaction that ALWAYS rolls back. If the constraint were missing,
  // the naive version of this test would write a bogus variant_id onto a real
  // order line and leave it there — a verification script that corrupts the thing
  // it is verifying. The throw at the end guarantees the rollback either way.
  const anyOrder = await db.salesOrder.findFirst({ where: { tenant_id: tenant.id }, include: { lines: { take: 1 } } });
  if (anyOrder?.lines[0]) {
    let refused = false;
    try {
      await db.$transaction(async tx => {
        await tx.$executeRawUnsafe(
          `UPDATE sales_order_lines SET variant_id = gen_random_uuid() WHERE id = $1::uuid`,
          anyOrder.lines[0].id,
        );
        // The FK did not stop us. Undo it and say so.
        throw new Error('NO_CONSTRAINT');
      });
    } catch (err) {
      refused = !(err instanceof Error && err.message === 'NO_CONSTRAINT');
    }
    check('the database now REFUSES a variant_id that points at nothing', refused);
  } else {
    console.log('  SKIP  no sales order line to test the constraint against');
  }

  // ── 5. The dead stock is still dead, and now visible ─────────────────────
  console.log('\n5  The 37 units on a NULL variant');
  const dead = await db.$queryRawUnsafe<any[]>(`
    SELECT p.sku, SUM(s.quantity)::int AS qty
    FROM inventory_stock s
    JOIN products p ON p.id = s.product_id
    WHERE s.variant_id IS NULL AND p.dimension_group_id IS NOT NULL
    GROUP BY p.sku`);
  if (dead.length === 0) {
    console.log('        none — the cleanup has been done');
  } else {
    for (const r of dead) console.log(`        ${r.sku}: ${r.qty} units on no variant, for a product that varies by size`);
    console.log('        NOT fixed by this migration: which size those units are is a fact');
    console.log('        nobody recorded. Assigning one would be inventing data. It needs a count.');
  }
  check('the condition is now detectable in one query', true);

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async e => { console.error(e); await db.$disconnect(); process.exit(1); });
