import { db } from '../src/infrastructure/database/client';

/**
 * Read-only snapshot of a tenant's configuration state.
 *
 * NOTE: queries are deliberately SEQUENTIAL. The Supabase pooler this project
 * connects through runs in session mode with pool_size 15, and a `Promise.all`
 * of a dozen counts is enough to hit `EMAXCONNSESSION`. Every script in this
 * directory follows the same rule.
 */
(async () => {
  const tenants = await db.tenant.findMany({ select: { id: true, slug: true, name: true } });
  console.log('tenants:', JSON.stringify(tenants, null, 1));

  for (const x of tenants) {
    const seq = await db.numberSequence.findMany({
      where: { tenant_id: x.id },
      select: { reference: true, format: true, next_number: true },
      orderBy: { reference: 'asc' },
    });
    const prof = await db.postingProfile.count({ where: { tenant_id: x.id } });
    const cust = await db.customer.count({ where: { tenant_id: x.id } });
    const sup = await db.supplier.count({ where: { tenant_id: x.id } });
    const so = await db.salesOrder.count({ where: { tenant_id: x.id } });
    const po = await db.purchaseOrder.count({ where: { tenant_id: x.id } });
    const prod = await db.product.count({ where: { tenant_id: x.id } });
    const wh = await db.warehouse.count({ where: { tenant_id: x.id } });

    console.log(
      `${x.slug} | profiles ${prof} | customers ${cust} | suppliers ${sup} | ` +
      `SO ${so} | PO ${po} | products ${prod} | warehouses ${wh}`,
    );
    console.log('  sequences:', JSON.stringify(seq));
  }

  await db.$disconnect();
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
