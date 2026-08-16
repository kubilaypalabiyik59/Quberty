import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';

/**
 * Remove the stray `E2E-*` suppliers an earlier version of verifyProcessChain
 * minted one-per-run. It now reuses a single `E2E-RIVAL` fixture, so this is a
 * one-off tidy-up rather than something to run regularly.
 *
 *   npx tsx scripts/cleanupE2EFixtures.ts            report
 *   npx tsx scripts/cleanupE2EFixtures.ts --apply    delete the unreferenced ones
 *
 * A supplier with purchase orders behind it is left alone and reported — those
 * orders are real rows in the test database and deleting their supplier would
 * orphan them.
 */
const APPLY = process.argv.includes('--apply');

(async () => {
  const strays = await db.supplier.findMany({
    where: { code: { startsWith: 'E2E-' }, NOT: { code: 'E2E-RIVAL' } },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
  });

  if (!strays.length) {
    console.log('No stray E2E suppliers.');
    await db.$disconnect();
    return;
  }

  let removed = 0;
  for (const s of strays) {
    const pos = await db.purchaseOrder.count({ where: { supplier_id: s.id } });
    if (pos > 0) {
      console.log(`  KEEP    ${s.code}  ${s.name} — ${pos} purchase order(s) reference it`);
      continue;
    }
    if (!APPLY) {
      console.log(`  WOULD DELETE  ${s.code}  ${s.name}`);
      continue;
    }
    await db.supplier.delete({ where: { id: s.id } });
    console.log(`  DELETED ${s.code}  ${s.name}`);
    removed++;
  }

  console.log(APPLY ? `\nRemoved ${removed} of ${strays.length}.` : `\nReport only — pass --apply.`);
  await db.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await db.$disconnect();
  process.exit(1);
});
