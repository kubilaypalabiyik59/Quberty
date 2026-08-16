import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * Switch a tenant between the single-voucher purchase posting and the split
 * physical/financial posting, deliberately and visibly.
 *
 *   npx tsx scripts/setPurchaseFlow.ts                 show the current setting
 *   npx tsx scripts/setPurchaseFlow.ts --split         receipt accrues, invoice pays
 *   npx tsx scripts/setPurchaseFlow.ts --legacy        one voucher at receipt (default)
 *   npx tsx scripts/setPurchaseFlow.ts --split --three-way --tolerance 2
 *
 * WHY THIS IS A DELIBERATE ACT
 *
 * Turning the split on changes what a product receipt does to the books: it stops
 * creating a payable and stops recognising recoverable tax, both of which move to
 * the vendor invoice. A tenant with no vendor-invoice UI in front of it would see
 * receipts that never produce a payable — correct accounting, unusable process.
 * So the switch is explicit, per tenant, and never a migration side effect.
 */

const has = (f: string) => process.argv.includes(f);
const argAfter = (f: string) => {
  const i = process.argv.indexOf(f);
  return i !== -1 ? process.argv[i + 1] : null;
};

(async () => {
  const tenantSlug = argAfter('--tenant');
  const tenants = await db.tenant.findMany({
    where: tenantSlug ? { slug: tenantSlug } : {},
    select: { id: true, slug: true, name: true },
  });

  for (const t of tenants) {
    const params = await db.purchaseParameters.findFirst({
      where: { tenant_id: t.id, legal_entity_id: null },
    });
    if (!params) {
      console.log(`${t.slug}: no purchase parameters — run provisionConfiguration --apply first`);
      continue;
    }

    if (!has('--split') && !has('--legacy')) {
      console.log(
        `${t.slug}: post_product_receipt_in_ledger=${params.post_product_receipt_in_ledger} · ` +
          `matching=${params.line_matching_policy} · tolerance=${Number(params.price_tolerance_pct) * 100}% · ` +
          `discrepancies=${params.post_invoice_with_discrepancies} · totals=${params.match_invoice_totals} · ` +
          `flow=${params.receipt_invoice_flow}`,
      );
      continue;
    }

    const split = has('--split');
    const tolerance = argAfter('--tolerance');

    await db.purchaseParameters.update({
      where: { id: params.id },
      data: {
        post_product_receipt_in_ledger: split,
        line_matching_policy: has('--three-way') ? 'THREE_WAY' : has('--two-way') ? 'TWO_WAY' : split ? params.line_matching_policy : 'NONE',
        ...(tolerance ? { price_tolerance_pct: Number(tolerance) / 100 } : {}),
        ...(has('--require-approval') ? { post_invoice_with_discrepancies: 'REQUIRE_APPROVAL' } : {}),
        ...(has('--match-totals') ? { match_invoice_totals: true } : {}),
      },
    });

    console.log(
      `${t.slug}: switched to ${split ? 'SPLIT (receipt accrues, invoice pays)' : 'LEGACY (one voucher at receipt)'}`,
    );
    if (split) {
      console.log(
        '  Reminder: product receipts now post only an accrual. Accounts payable and recoverable\n' +
          '  tax appear when the vendor invoice is posted. Make sure there is a way to post one.',
      );
    }
  }

  await db.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await db.$disconnect();
  process.exit(1);
});
