import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * Replace the misleading first-cut item model groups.
 *
 *   npx tsx scripts/reseedItemModelGroups.ts            report
 *   npx tsx scripts/reseedItemModelGroups.ts --apply
 *
 * The original seed was `FIFO` (stocked) and `SERVICE` (standard cost, not
 * stocked), which made the setup screen imply that choosing STANDARD costing
 * declared the item a service. Costing method and stocked-ness are independent:
 *
 *   "Yes, you can use different costing models for each item. It's common for
 *    manufacturers to use a periodic costing model for raw materials and
 *    standard cost for semi-finished and finished goods."
 *   learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq
 *
 * This renames the two existing groups in place — keeping their ids, so any
 * product already assigned keeps its assignment and no ledger relationship
 * moves — and adds the combination the old seed excluded: stocked + standard.
 */
const APPLY = process.argv.includes('--apply');

const RENAME: Record<string, { code: string; name: string; description: string; costing_method?: string }> = {
  FIFO: {
    code: 'STOCKED-FIFO',
    name: 'Stocked · FIFO',
    description: 'Tangible item, tracked in inventory, valued first-in-first-out. The default for trading stock.',
  },
  SERVICE: {
    code: 'NON-STOCKED',
    name: 'Not stocked · expensed',
    description:
      'No inventory subledger; the cost is expensed to the ledger directly. For shop supplies and charges. ' +
      'NOTE: a service that appears on a BOM must be STOCKED instead.',
  },
};

const ADD = {
  code: 'STOCKED-STD',
  name: 'Stocked · Standard cost',
  description:
    'Tangible item, tracked in inventory, valued at a standard cost with variances posted. ' +
    'Costing method is independent of whether an item is stocked — this group exists to make that plain.',
  costing_method: 'STANDARD',
  stocked: true,
  post_physical_inventory: true,
  post_financial_inventory: true,
};

(async () => {
  const tenants = await db.tenant.findMany({ select: { id: true, slug: true } });

  for (const t of tenants) {
    console.log(`\n${t.slug}`);
    const groups = await db.itemModelGroup.findMany({
      where: { tenant_id: t.id },
      include: { _count: { select: { products: true } } },
      orderBy: { code: 'asc' },
    });

    for (const g of groups) {
      const target = RENAME[g.code];
      if (!target) {
        console.log(`  SKIP    ${g.code} — not a first-cut group, left alone`);
        continue;
      }
      console.log(
        `  RENAME  ${g.code} → ${target.code}  (${g._count.products} product(s) keep their assignment)`,
      );
      if (APPLY) {
        await db.itemModelGroup.update({
          where: { id: g.id },
          data: { code: target.code, name: target.name, description: target.description },
        });
      }
    }

    const exists = await db.itemModelGroup.findFirst({
      where: { tenant_id: t.id, code: ADD.code },
      select: { id: true },
    });
    if (exists) {
      console.log(`  SKIP    ${ADD.code} — already present`);
    } else if (!APPLY) {
      console.log(`  WOULD ADD ${ADD.code} — the stocked + standard-cost combination the old seed excluded`);
    } else {
      await db.itemModelGroup.create({ data: { ...ADD, tenant_id: t.id, legal_entity_id: null } });
      console.log(`  ADDED   ${ADD.code}`);
    }
  }

  console.log(`\n${APPLY ? 'APPLIED.' : 'Report only — pass --apply.'}`);
  await db.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await db.$disconnect();
  process.exit(1);
});
