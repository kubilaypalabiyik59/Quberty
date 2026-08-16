import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import { COA_TEMPLATES, getTemplate } from '../src/data/coa-templates/index';
import { POSTING_TYPE_BY_CATEGORY } from '../src/shared/services/accountCategory';
import { PostingType } from '../src/shared/services/postingProfile.service';

/**
 * Create the three accounts the split purchase posting needs, and their posting
 * profiles, for tenants provisioned before migration 010.
 *
 *   npx tsx scripts/provisionPurchaseAccounts.ts            report only
 *   npx tsx scripts/provisionPurchaseAccounts.ts --apply
 *
 * WHY A SCRIPT AND NOT PART OF provisionConfiguration
 *
 * `provisionConfiguration` resolves posting types against accounts that already
 * exist; it deliberately never creates a general ledger account, because guessing
 * a chart of accounts is the failure that whole workstream exists to prevent.
 * Creating an account IS a decision about a company's books, so it gets its own
 * script that says exactly which code and name it is about to add, from the
 * tenant's own country template, and refuses when the code is already taken by
 * something else.
 *
 * The three:
 *   ACCRUED_PURCHASES     goods received not invoiced — the clearing liability
 *   PURCHASE_EXPENDITURE  not-stocked purchases, which used to land in COGS
 *   PRICE_VARIANCE        receipt price vs invoice price
 *
 * [OFFICIAL] learn.microsoft.com/dynamics365/finance/general-ledger/purchase-order-posting
 */

const APPLY = process.argv.includes('--apply');
const NEW_CATEGORIES = ['ACCRUED_PURCHASES', 'PURCHASE_EXPENDITURE', 'PRICE_VARIANCE'] as const;

(async () => {
  const tenants = await db.tenant.findMany({
    select: { id: true, slug: true, name: true, currency_code: true },
  });

  for (const t of tenants) {
    console.log(`\n${'='.repeat(78)}\n${t.name} (${t.slug}) — ${t.currency_code}\n${'='.repeat(78)}`);

    const template =
      COA_TEMPLATES.find(x => x.currency === t.currency_code) ?? getTemplate('generic-ifrs');
    if (!template) {
      console.log('  no chart template matches this tenant — skipped');
      continue;
    }
    console.log(`  template: ${template.name}`);

    const existing = await db.account.findMany({
      where: { tenant_id: t.id },
      select: { id: true, code: true, name: true, category: true },
    });
    const byCode = new Map(existing.map(a => [a.code, a]));

    for (const category of NEW_CATEGORIES) {
      const already = existing.find(a => a.category === category);
      if (already) {
        console.log(`  SKIP     ${category.padEnd(22)} already held by ${already.code} "${already.name}"`);
        continue;
      }

      const spec = (template.accounts as any[]).find(a => a.category === category);
      if (!spec) {
        console.log(`  MISSING  ${category.padEnd(22)} the template defines no account for it`);
        continue;
      }

      const clash = byCode.get(spec.code);
      if (clash) {
        // The tenant's chart has forked from the template. Naming a different
        // account with this category would repoint the ledger silently.
        console.log(
          `  CONFLICT ${category.padEnd(22)} template wants ${spec.code} "${spec.name}", but this ` +
            `tenant's ${spec.code} is "${clash.name}" (category ${clash.category ?? 'none'}). ` +
            `Create the account by hand and categorise it ${category}.`,
        );
        continue;
      }

      console.log(`  CREATE   ${category.padEnd(22)} ${spec.code} "${spec.name}" (${spec.type})`);
      if (APPLY) {
        const parent = spec.parent_code ? byCode.get(spec.parent_code) : null;
        const created = await db.account.create({
          data: {
            tenant_id:      t.id,
            code:           spec.code,
            name:           spec.name,
            type:           spec.type,
            normal_balance: spec.normal_balance,
            category,
            parent_id:      parent?.id ?? null,
            is_active:      true,
          },
          select: { id: true, code: true, name: true, category: true },
        });
        existing.push(created);
        byCode.set(created.code, created);
      }
    }

    // ── Posting profiles for the three new types ──────────────────────────
    const configured = new Set(
      (
        await db.postingProfile.findMany({
          where: { tenant_id: t.id, legal_entity_id: null, scope_kind: 'ALL' },
          select: { posting_type: true },
        })
      ).map(p => p.posting_type),
    );

    const newTypes: PostingType[] = ['PURCHASE_ACCRUAL', 'PURCHASE_EXPENSE', 'PRICE_VARIANCE'];
    for (const postingType of newTypes) {
      if (configured.has(postingType)) {
        console.log(`  SKIP     ${postingType.padEnd(22)} profile already configured`);
        continue;
      }
      const category = POSTING_TYPE_BY_CATEGORY[postingType];
      const candidates = existing.filter(a => a.category === category);

      if (candidates.length === 0) {
        console.log(`  PENDING  ${postingType.padEnd(22)} no account categorised ${category}${APPLY ? '' : ' (would exist after --apply)'}`);
        continue;
      }
      if (candidates.length > 1) {
        console.log(
          `  AMBIG    ${postingType.padEnd(22)} ${candidates.length} accounts share ${category} — ` +
            candidates.map(a => `${a.code} "${a.name}"`).join(' · '),
        );
        continue;
      }

      const a = candidates[0];
      console.log(`  PROFILE  ${postingType.padEnd(22)} → ${a.code} "${a.name}"`);
      if (APPLY) {
        await db.postingProfile.create({
          data: {
            tenant_id:    t.id,
            posting_type: postingType,
            scope_kind:   'ALL',
            scope_id:     null,
            account_id:   a.id,
            valid_from:   new Date('2000-01-01'),
            description:  'Created by provisionPurchaseAccounts — split purchase posting (migration 010)',
          },
        });
      }
    }
  }

  console.log(
    `\n${APPLY ? 'APPLIED.' : 'Report only — pass --apply to create the accounts and profiles.'}\n` +
      `Note: creating these does NOT change any posting. The split only takes effect when\n` +
      `PurchaseParameters.post_product_receipt_in_ledger is turned on for a tenant.`,
  );
  await db.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await db.$disconnect();
  process.exit(1);
});
