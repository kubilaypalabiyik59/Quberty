import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import { resolveItemPolicies, groupByItemGroup } from '../src/shared/services/itemPolicy.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { SalesService } from '../src/modules/sales/sales.service';

/**
 * Proof that the item model group and item group are READ, not merely stored.
 *
 * Until this ran, twelve configurable columns were declarative: a user could set
 * `stocked = false` and the system would carry on keeping inventory for the item.
 * Configuration that nothing reads is worse than no configuration, because it
 * looks like it works.
 *
 * Everything created here is deleted at the end and the counts are checked back
 * to the baseline the run started from.
 *
 *   npx tsx scripts/verifyItemPolicy.ts
 *   npx tsx scripts/verifyItemPolicy.ts --keep
 */

const KEEP = process.argv.includes('--keep');
const MARK = `IP-${Date.now()}`;

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label}` +
    (ok ? ` = ${JSON.stringify(actual)}` : `\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`),
  );
}
function note(l: string, v: unknown) { console.log(`        ${l}: ${typeof v === 'object' ? JSON.stringify(v) : v}`); }
function heading(s: string) { console.log(`\n${'─'.repeat(74)}\n${s}\n${'─'.repeat(74)}`); }

(async () => {
  const tenant = await db.tenant.findFirstOrThrow({ select: { id: true, slug: true } });
  const user = await db.user.findFirstOrThrow({ where: { tenant_id: tenant.id }, select: { id: true } });
  const warehouse = await db.warehouse.findFirstOrThrow({ where: { tenant_id: tenant.id }, select: { id: true, code: true } });
  const location = await db.warehouseLocation.findFirstOrThrow({
    where: { zone: { warehouse_id: warehouse.id } }, select: { id: true },
  });
  const customer = await db.customer.findFirstOrThrow({ where: { tenant_id: tenant.id }, select: { id: true } });

  const stockedGroup = await db.itemModelGroup.findFirstOrThrow({ where: { tenant_id: tenant.id, stocked: true } });
  const nonStocked = await db.itemModelGroup.findFirstOrThrow({ where: { tenant_id: tenant.id, stocked: false } });
  const footwear = await db.itemGroup.findFirstOrThrow({ where: { tenant_id: tenant.id, code: 'FOOTWEAR' } });
  const services = await db.itemGroup.findFirstOrThrow({ where: { tenant_id: tenant.id, code: 'SERVICE' } });
  const accessories = await db.itemGroup.findFirstOrThrow({ where: { tenant_id: tenant.id, code: 'ACCESSORY' } });

  const baseline = {
    stock: await db.inventoryStock.count({ where: { tenant_id: tenant.id } }),
    txns: await db.inventoryTransaction.count({ where: { tenant_id: tenant.id } }),
    journals: await db.journalEntry.count({ where: { tenant_id: tenant.id } }),
  };
  console.log(`tenant ${tenant.slug} · warehouse ${warehouse.code}`);
  console.log(`baseline: stock rows ${baseline.stock}, inventory txns ${baseline.txns}, journals ${baseline.journals}`);

  const created = {
    productIds: [] as string[], orderIds: [] as string[], journalIds: [] as string[],
    profileIds: [] as string[],
  };

  // Two products that differ ONLY in their model group.
  const shoe = await db.product.create({
    data: {
      tenant_id: tenant.id, sku: `${MARK}-SHOE`, name: 'Verification shoe', selling_price: 500,
      cost_price: 200, item_model_group_id: stockedGroup.id, item_group_id: footwear.id,
    },
  });
  const repair = await db.product.create({
    data: {
      tenant_id: tenant.id, sku: `${MARK}-REPAIR`, name: 'Verification repair service', selling_price: 150,
      cost_price: 60, item_model_group_id: nonStocked.id, item_group_id: services.id,
    },
  });
  // A second STOCKED product in a DIFFERENT item group. Without this the COGS
  // journal only ever has one bucket and the headline claim - that the item
  // group splits the posting - would not actually be exercised.
  const accessory = await db.product.create({
    data: {
      tenant_id: tenant.id, sku: `${MARK}-LACE`, name: 'Verification shoe laces', selling_price: 40,
      cost_price: 15, item_model_group_id: stockedGroup.id, item_group_id: accessories.id,
    },
  });
  created.productIds.push(shoe.id, repair.id, accessory.id);

  /* ═══════════════════ 1 — the policy resolves at all ═══════════════════ */
  heading('1  Policy resolution');

  const policies = await resolveItemPolicies(tenant.id, [shoe.id, repair.id]);
  check('stocked product reports stocked', policies.get(shoe.id)!.stocked, true);
  check('non-stocked product reports not stocked', policies.get(repair.id)!.stocked, false);
  check('item group resolves for posting', policies.get(shoe.id)!.itemGroupCode, 'FOOTWEAR');
  check('the two products land in different item groups',
    policies.get(shoe.id)!.itemGroupId !== policies.get(repair.id)!.itemGroupId, true);

  const unassigned = await db.product.findFirst({
    where: { tenant_id: tenant.id, item_model_group_id: null },
    select: { id: true, sku: true },
  });
  if (unassigned) {
    const p = (await resolveItemPolicies(tenant.id, [unassigned.id])).get(unassigned.id)!;
    check(`an UNASSIGNED product (${unassigned.sku}) still behaves exactly as before`,
      { stocked: p.stocked, isDefault: p.isDefault, itemGroupId: p.itemGroupId },
      { stocked: true, isDefault: true, itemGroupId: null });
  }

  /* ═══════════════════ 2 — stocked=false keeps no inventory ═════════════ */
  heading('2  A not-stocked item keeps no inventory subledger');

  const inventory = new InventoryService();
  const avail = await inventory.getAvailableStock(tenant.id, repair.id, null, warehouse.id);
  check('availability of a not-stocked item is not a shortage', avail === Number.POSITIVE_INFINITY, true);
  note('…so a service is never "out of stock"', avail);

  const shoeAvail = await inventory.getAvailableStock(tenant.id, shoe.id, null, warehouse.id);
  check('a stocked item still reports real availability', shoeAvail, 0);

  // Give the shoe some stock so the order can ship.
  await db.inventoryStock.create({
    data: { tenant_id: tenant.id, product_id: shoe.id, location_id: location.id, quantity: 10 },
  });
  await db.inventoryCostLayer.create({
    data: {
      tenant_id: tenant.id, product_id: shoe.id, location_id: location.id,
      quantity: 10, unit_cost: 200, received_at: new Date(),
    },
  });
  await db.inventoryStock.create({
    data: { tenant_id: tenant.id, product_id: accessory.id, location_id: location.id, quantity: 10 },
  });
  await db.inventoryCostLayer.create({
    data: {
      tenant_id: tenant.id, product_id: accessory.id, location_id: location.id,
      quantity: 10, unit_cost: 15, received_at: new Date(),
    },
  });

  const txnBefore = await db.inventoryTransaction.count({ where: { tenant_id: tenant.id } });

  const sales = new SalesService();
  const order = await sales.createOrder(
    tenant.id,
    {
      customer_id: customer.id, warehouse_id: warehouse.id,
      lines: [
        { product_id: shoe.id, quantity: 2, unit_price: 500 },
        { product_id: accessory.id, quantity: 4, unit_price: 40 },
        { product_id: repair.id, quantity: 1, unit_price: 150 },
      ],
    },
    user.id,
  );
  created.orderIds.push(order.id);
  note('order', order.order_number);

  await sales.confirmOrder(tenant.id, order.id, user.id);

  const repairReserved = await db.inventoryStock.findFirst({
    where: { tenant_id: tenant.id, product_id: repair.id },
  });
  check('confirming reserved nothing for the not-stocked line', repairReserved, null);

  const journalsBefore = await db.journalEntry.count({ where: { tenant_id: tenant.id } });
  await sales.shipOrder(tenant.id, order.id, user.id);

  const repairTxns = await db.inventoryTransaction.count({
    where: { tenant_id: tenant.id, product_id: repair.id },
  });
  check('shipping created NO inventory transaction for the not-stocked line', repairTxns, 0);

  const shoeTxns = await db.inventoryTransaction.count({
    where: { tenant_id: tenant.id, product_id: shoe.id },
  });
  check('but it did for the stocked line', shoeTxns > 0, true);
  note('inventory transactions added', (await db.inventoryTransaction.count({ where: { tenant_id: tenant.id } })) - txnBefore);

  /* ═══════════════════ 3 — COGS excludes the not-stocked line ═══════════ */
  heading('3  COGS is posted per item group, and excludes the not-stocked line');

  const cogsEntry = await db.journalEntry.findFirst({
    where: { tenant_id: tenant.id, source_module: 'SALES_COGS', source_id: order.id },
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
  });
  check('a COGS journal was posted', Boolean(cogsEntry), true);
  if (cogsEntry) {
    created.journalIds.push(cogsEntry.id);
    const debit = cogsEntry.lines.reduce((s, l) => s + Number(l.debit_amount), 0);
    // 2 shoes × 200 + 4 laces × 15 = 460. The repair's 60 must NOT appear: it has
    // no inventory to relieve, and its cost was expensed when purchased.
    check('COGS covers both stocked lines (2×200 + 4×15) and excludes the service', debit, 460);

    // THE HEADLINE CLAIM: two item groups produce two debit/credit PAIRS, one
    // per group, rather than a single lumped line.
    const debitLines = cogsEntry.lines.filter((l) => Number(l.debit_amount) > 0);
    check('one COGS debit per item group, not one for the whole order', debitLines.length, 2);
    check('the per-group debits are the per-group costs',
      debitLines.map((l) => Number(l.debit_amount)).sort((a, b) => a - b), [60, 400]);
    check('every line is labelled with the group it came from',
      debitLines.every((l) => /\[(FOOTWEAR|ACCESSORY)\]/.test(l.description ?? '')), true);

    for (const l of cogsEntry.lines) {
      note(`  ${l.account.code} ${l.account.name}`,
        `dr ${Number(l.debit_amount)} cr ${Number(l.credit_amount)}  ${l.description}`);
    }
  }

  /* ═══ 3b — a GROUP-SCOPED posting profile actually wins ═══════════════ */
  heading('3b  A group-scoped posting profile sends that group to its own account');

  // The split above proves the journal is grouped. This proves the grouping is
  // USEFUL: with an ACCESSORY-scoped COGS profile in place, that group's cost
  // lands on a different account from everything else - which is the entire
  // reason the item axis exists.
  //
  // [OFFICIAL] the inventory posting profile resolves Item code =
  // Table | Group | All, most specific first.
  const altExpense = await db.account.findFirst({
    where: { tenant_id: tenant.id, type: 'EXPENSE', code: { not: '5101' } },
    select: { id: true, code: true, name: true },
  });

  if (!altExpense) {
    note('skipped', 'no second expense account in the chart to point a scoped profile at');
  } else {
    const scoped = await db.postingProfile.create({
      data: {
        tenant_id: tenant.id, legal_entity_id: null,
        posting_type: 'COGS', scope_kind: 'ITEM_GROUP', scope_id: accessories.id,
        account_id: altExpense.id, valid_from: new Date(Date.UTC(2000, 0, 1)),
        description: `Verification run ${MARK} - ACCESSORY COGS`,
      },
    });
    created.profileIds.push(scoped.id);
    note('scoped profile', `COGS · ITEM_GROUP=ACCESSORY → ${altExpense.code} ${altExpense.name}`);

    const order2 = await sales.createOrder(
      tenant.id,
      {
        customer_id: customer.id, warehouse_id: warehouse.id,
        lines: [
          { product_id: shoe.id, quantity: 1, unit_price: 500 },
          { product_id: accessory.id, quantity: 2, unit_price: 40 },
        ],
      },
      user.id,
    );
    created.orderIds.push(order2.id);
    await sales.confirmOrder(tenant.id, order2.id, user.id);
    await sales.shipOrder(tenant.id, order2.id, user.id);

    const entry2 = await db.journalEntry.findFirst({
      where: { tenant_id: tenant.id, source_module: 'SALES_COGS', source_id: order2.id },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    check('a second COGS journal was posted', Boolean(entry2), true);
    if (entry2) {
      created.journalIds.push(entry2.id);
      const debits = entry2.lines.filter((l) => Number(l.debit_amount) > 0);
      const byAccount = Object.fromEntries(
        debits.map((l) => [l.account.code, Number(l.debit_amount)]),
      );
      check('the two groups now debit DIFFERENT accounts', Object.keys(byAccount).length, 2);
      check(`ACCESSORY went to the scoped account ${altExpense.code}`,
        byAccount[altExpense.code], 30);   // 2 × 15
      check('FOOTWEAR stayed on the ALL-scope account 5101', byAccount['5101'], 200);
      for (const l of debits) {
        note(`  ${l.account.code}`, `dr ${Number(l.debit_amount)}  ${l.description}`);
      }
    }
  }

  /* ═══════════════════ 4 — the grouping helper itself ═══════════════════ */
  heading('4  Grouping splits amounts by item group');

  const lines = [
    { product_id: shoe.id, amount: 1000 },
    { product_id: repair.id, amount: 150 },
    { product_id: shoe.id, amount: 500 },
  ];
  const buckets = groupByItemGroup(lines, policies, (l) => l.product_id, (l) => l.amount);
  check('two products in two groups produce two buckets', buckets.length, 2);
  const footwearBucket = buckets.find((b) => b.itemGroupCode === 'FOOTWEAR')!;
  const serviceBucket = buckets.find((b) => b.itemGroupCode === 'SERVICE')!;
  check('same-group lines are summed', footwearBucket.amount, 1500);
  check('the other group is kept apart', serviceBucket.amount, 150);
  check('the split adds back to the whole',
    Number((footwearBucket.amount + serviceBucket.amount).toFixed(2)), 1650);

  /* ═══════════════════ 5 — nothing pre-existing moved ═══════════════════ */
  heading('5  Regression');

  const unassignedCount = await db.product.count({
    where: { tenant_id: tenant.id, item_model_group_id: null },
  });
  note('products still unassigned (they keep the old behaviour)', unassignedCount);

  /* ══════════════════════════════ cleanup ══════════════════════════════ */
  if (KEEP) {
    heading('KEEPING the documents (--keep)');
  } else {
    heading('CLEANUP');
    await db.journalLine.deleteMany({ where: { journal_entry_id: { in: created.journalIds } } });
    await db.journalEntry.deleteMany({ where: { id: { in: created.journalIds } } });
    // Any other journal raised during the run (e.g. none expected, but be safe).
    await db.journalEntry.deleteMany({
      where: { tenant_id: tenant.id, source_id: { in: created.orderIds } },
    });
    await db.shipment.deleteMany({ where: { order_id: { in: created.orderIds } } });
    await db.salesOrderLine.deleteMany({ where: { order_id: { in: created.orderIds } } });
    await db.salesOrder.deleteMany({ where: { id: { in: created.orderIds } } });
    await db.inventoryTransaction.deleteMany({ where: { product_id: { in: created.productIds } } });
    await db.inventoryCostLayer.deleteMany({ where: { product_id: { in: created.productIds } } });
    await db.inventoryStock.deleteMany({ where: { product_id: { in: created.productIds } } });
    await db.product.deleteMany({ where: { id: { in: created.productIds } } });
    await db.postingProfile.deleteMany({ where: { id: { in: created.profileIds } } });

    check('inventory stock rows back to baseline',
      await db.inventoryStock.count({ where: { tenant_id: tenant.id } }), baseline.stock);
    check('inventory transactions back to baseline',
      await db.inventoryTransaction.count({ where: { tenant_id: tenant.id } }), baseline.txns);
    check('journals back to baseline',
      await db.journalEntry.count({ where: { tenant_id: tenant.id } }), baseline.journals);
  }

  heading(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('\nERROR:', e.message);
  console.error(e.stack?.split('\n').slice(1, 6).join('\n'));
  await db.$disconnect();
  process.exit(1);
});
