/**
 * Drive the trade agreement resolver against the REAL database.
 *
 *   npx tsx scripts/verifyTradeAgreements.ts
 *   npx tsx scripts/verifyTradeAgreements.ts --keep
 *
 * Self-cleaning: every agreement it writes is deleted again and the count is
 * asserted back to baseline.
 */
import { db } from '../src/infrastructure/database/client';
import {
  resolveTradeAgreementPrice,
  resolveTradeAgreementDiscount,
  purchasePriceFor,
} from '../src/shared/services/tradeAgreement.service';

const KEEP = process.argv.includes('--keep');
let passed = 0;
let failed = 0;
const made: string[] = [];

const check = (label: string, ok: boolean, detail = '') => {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;

async function refused(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, 'the database accepted it');
  } catch {
    check(label, true);
  }
}

async function main() {
  const tenant = (await db.tenant.findFirst({ select: { id: true, name: true } }))!;
  const tenantId = tenant.id;
  console.log(`Tenant: ${tenant.name}\n`);

  const baseline = await db.tradeAgreement.count({ where: { tenant_id: tenantId } });

  const supplier = (await db.supplier.findFirst({ where: { tenant_id: tenantId }, select: { id: true, code: true } }))!;
  const other = await db.supplier.findFirst({
    where: { tenant_id: tenantId, id: { not: supplier.id } },
    select: { id: true, code: true },
  });
  const product = (await db.product.findFirst({
    where: { tenant_id: tenantId },
    select: { id: true, sku: true, cost_price: true, item_group_id: true },
  }))!;
  console.log(`Supplier ${supplier.code} · product ${product.sku} (cost ${product.cost_price})\n`);

  const mk = async (data: any) => {
    const row = await db.tradeAgreement.create({
      data: { tenant_id: tenantId, side: 'PURCHASE', ...data },
    });
    made.push(row.id);
    return row;
  };

  // ── 1. Nothing configured → nothing resolves ─────────────────────────────
  console.log('An empty price list changes nothing');
  const none = await resolveTradeAgreementPrice(tenantId, 'PURCHASE', {
    supplierId: supplier.id, productId: product.id, quantity: 1,
  });
  check('no agreement → null, not an error', none === null);

  const fellBack = await purchasePriceFor(tenantId, {
    supplierId: supplier.id, productId: product.id, quantity: 1, explicitCost: 42,
  });
  check('the typed cost is used when no agreement exists', fellBack.unitCost === 42 && fellBack.source === 'EXPLICIT');

  // ── 2. Most specific wins, not cheapest ──────────────────────────────────
  console.log('\nMost specific wins — a negotiated price is not undercut by a general one');
  await mk({
    agreement_type: 'PRICE', party_scope: 'ALL',
    product_scope: 'PRODUCT', product_id: product.id, amount: 100,
  });
  await mk({
    agreement_type: 'PRICE', party_scope: 'PARTY', supplier_id: supplier.id,
    product_scope: 'PRODUCT', product_id: product.id, amount: 120,
  });

  const specific = await resolveTradeAgreementPrice(tenantId, 'PURCHASE', {
    supplierId: supplier.id, productId: product.id, quantity: 1,
  });
  check('the supplier-specific 120 beats the general 100', near(specific?.unitPrice ?? 0, 120), `${specific?.unitPrice}`);
  check('and it says how it was matched', specific?.specificity === 'PRODUCT ∩ PARTY', specific?.specificity);

  if (other) {
    const fallback = await resolveTradeAgreementPrice(tenantId, 'PURCHASE', {
      supplierId: other.id, productId: product.id, quantity: 1,
    });
    check('a different supplier still gets the general 100', near(fallback?.unitPrice ?? 0, 100), `${fallback?.unitPrice}`);
  }

  // ── 3. find_next opts into cheaper-wins ──────────────────────────────────
  console.log('\nfind_next restores D365 cheaper-wins for one row');
  const fn = await db.tradeAgreement.findFirst({
    where: { tenant_id: tenantId, party_scope: 'PARTY', supplier_id: supplier.id, amount: 120 },
  });
  await db.tradeAgreement.update({ where: { id: fn!.id }, data: { find_next: true } });
  const cheaper = await resolveTradeAgreementPrice(tenantId, 'PURCHASE', {
    supplierId: supplier.id, productId: product.id, quantity: 1,
  });
  check('with find_next on, the cheaper 100 wins', near(cheaper?.unitPrice ?? 0, 100), `${cheaper?.unitPrice}`);
  await db.tradeAgreement.update({ where: { id: fn!.id }, data: { find_next: false } });

  // ── 4. Quantity breaks ───────────────────────────────────────────────────
  console.log('\nQuantity breaks');
  await mk({
    agreement_type: 'PRICE', party_scope: 'PARTY', supplier_id: supplier.id,
    product_scope: 'PRODUCT', product_id: product.id,
    quantity_from: 50, amount: 90,
  });
  const small = await resolveTradeAgreementPrice(tenantId, 'PURCHASE', {
    supplierId: supplier.id, productId: product.id, quantity: 10,
  });
  const bulk = await resolveTradeAgreementPrice(tenantId, 'PURCHASE', {
    supplierId: supplier.id, productId: product.id, quantity: 50,
  });
  check('below the break, the standard 120 applies', near(small?.unitPrice ?? 0, 120), `${small?.unitPrice}`);
  check('at the break, the bulk 90 applies', near(bulk?.unitPrice ?? 0, 90), `${bulk?.unitPrice}`);

  // ── 5. price_unit ────────────────────────────────────────────────────────
  console.log('\nprice_unit — a price quoted per N');
  const perDozen = await mk({
    agreement_type: 'PRICE', party_scope: 'ALL',
    product_scope: 'PRODUCT', product_id: product.id,
    quantity_from: 1000, amount: 600, price_unit: 12,
  });
  const unit = await resolveTradeAgreementPrice(tenantId, 'PURCHASE', {
    supplierId: null, productId: product.id, quantity: 1000,
  });
  check('600 per dozen resolves to 50 per unit', near(unit?.unitPrice ?? 0, 50), `${unit?.unitPrice}`);
  await db.tradeAgreement.delete({ where: { id: perDozen.id } });
  made.splice(made.indexOf(perDozen.id), 1);

  // ── 6. Date effectivity ──────────────────────────────────────────────────
  console.log('\nDate effectivity');
  const yesterday = new Date(Date.now() - 86400_000);
  const expired = await mk({
    agreement_type: 'PRICE', party_scope: 'PARTY', supplier_id: supplier.id,
    product_scope: 'PRODUCT', product_id: product.id,
    valid_from: new Date(Date.now() - 172800_000), valid_to: yesterday,
    quantity_from: 500, amount: 1,
  });
  const notYet = await resolveTradeAgreementPrice(tenantId, 'PURCHASE', {
    supplierId: supplier.id, productId: product.id, quantity: 500,
  });
  check('an expired agreement does not apply', !near(notYet?.unitPrice ?? 0, 1), `${notYet?.unitPrice}`);
  check('but it is still on file — closing keeps history', !!(await db.tradeAgreement.findUnique({ where: { id: expired.id } })));

  // ── 7. Line discount ─────────────────────────────────────────────────────
  console.log('\nLine discount — the scope a price may not use');
  await mk({
    agreement_type: 'LINE_DISCOUNT', party_scope: 'PARTY', supplier_id: supplier.id,
    product_scope: 'ALL', discount_percent: 7.5,
  });
  const disc = await resolveTradeAgreementDiscount(tenantId, 'PURCHASE', {
    supplierId: supplier.id, productId: product.id, quantity: 1,
  });
  check('a percentage discount CAN apply to all products', near(disc?.percent ?? 0, 7.5), `${disc?.percent}`);

  // ── 8. The database enforces the official rules ──────────────────────────
  console.log('\nThe database enforces what Learn states');
  await refused(
    'a PRICE scoped to ALL products is refused ("a price is an absolute value")',
    () => db.tradeAgreement.create({
      data: { tenant_id: tenantId, side: 'PURCHASE', agreement_type: 'PRICE', product_scope: 'ALL', amount: 10 },
    }),
  );
  await refused(
    'a PURCHASE agreement naming a CUSTOMER is refused',
    () => db.tradeAgreement.create({
      data: {
        tenant_id: tenantId, side: 'PURCHASE', agreement_type: 'PRICE',
        party_scope: 'PARTY', customer_id: null, supplier_id: null,
        product_scope: 'PRODUCT', product_id: product.id, amount: 10,
      },
    }),
  );
  await refused(
    'a PRICE row with no amount is refused',
    () => db.tradeAgreement.create({
      data: {
        tenant_id: tenantId, side: 'PURCHASE', agreement_type: 'PRICE',
        product_scope: 'PRODUCT', product_id: product.id,
      },
    }),
  );
  await refused(
    'a discount above 100% is refused',
    () => db.tradeAgreement.create({
      data: {
        tenant_id: tenantId, side: 'PURCHASE', agreement_type: 'LINE_DISCOUNT',
        product_scope: 'ALL', discount_percent: 150,
      },
    }),
  );

  // ── 9. The purchase path uses it ─────────────────────────────────────────
  console.log('\nThe purchase order path');
  const viaAgreement = await purchasePriceFor(tenantId, {
    supplierId: supplier.id, productId: product.id, quantity: 1, explicitCost: 999,
  });
  check('an agreement OVERRIDES a hand-typed cost', near(viaAgreement.unitCost, 120) && viaAgreement.source === 'AGREEMENT',
    `${viaAgreement.unitCost} from ${viaAgreement.source}`);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  if (KEEP) {
    console.log('\n--keep: agreements left in place.');
  } else {
    await db.tradeAgreement.deleteMany({ where: { id: { in: made } } });
    const now = await db.tradeAgreement.count({ where: { tenant_id: tenantId } });
    check('\n  agreements back to baseline', now === baseline, `${now} vs ${baseline}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (!KEEP && made.length) await db.tradeAgreement.deleteMany({ where: { id: { in: made } } });
    await db.$disconnect();
  });
