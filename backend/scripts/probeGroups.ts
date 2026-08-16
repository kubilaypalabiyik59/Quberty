import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/** Who is assigned to what, and when it last changed. */
(async () => {
  const products = await db.product.findMany({
    select: {
      sku: true, name: true, updated_at: true,
      item_group: { select: { code: true } },
      item_model_group: { select: { code: true } },
    },
    orderBy: { updated_at: 'desc' },
  });
  for (const p of products) {
    console.log(
      `${p.sku.padEnd(22)} model=${(p.item_model_group?.code ?? '—').padEnd(8)} ` +
      `item=${(p.item_group?.code ?? '—').padEnd(10)} updated=${p.updated_at.toISOString()}`,
    );
  }
  await db.$disconnect();
})().catch(async (e) => { console.error(e.message); await db.$disconnect(); process.exit(1); });
