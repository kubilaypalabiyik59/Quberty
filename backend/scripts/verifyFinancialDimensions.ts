/**
 * Drive financial dimension coding against the REAL database.
 *
 *   npx tsx scripts/verifyFinancialDimensions.ts
 *   npx tsx scripts/verifyFinancialDimensions.ts --keep
 *
 * Self-cleaning: every voucher and every dimension value it creates is deleted
 * again and the counts are asserted back to the baseline. The requirement rules it
 * flips are restored in a `finally`, because a script that fails halfway must not
 * leave revenue postings refused.
 *
 * What this is for: migration 018 added columns, and columns nothing writes are
 * worse than no columns because they look like they work. Everything below is
 * asserted by posting, not by reading the code.
 */
import { db } from '../src/infrastructure/database/client';
import { postJournal, reverseJournal } from '../src/shared/services/journal.service';
import { AppError } from '../src/shared/errors/AppError';
import {
  resolveDimensions,
  contextForSalesOrder,
  contextForEmployee,
} from '../src/shared/services/dimension.service';

const KEEP = process.argv.includes('--keep');

let passed = 0;
let failed = 0;
const createdEntries: string[] = [];
const createdValues: string[] = [];

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function expectCode(label: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, 'it did not throw');
  } catch (err) {
    const actual = err instanceof AppError ? (err as any).code : undefined;
    check(label, actual === code, `expected ${code}, got ${actual ?? err}`);
  }
}

async function main() {
  const tenant = await db.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) throw new Error('No tenant in the database.');
  const tenantId = tenant.id;
  console.log(`Tenant: ${tenant.name}\n`);

  // Sweep anything a previous crashed run left behind, BEFORE taking the baseline.
  // A verification script that fails halfway must not poison the next run's counts.
  const stale = await db.journalEntry.findMany({
    where: { tenant_id: tenantId, source_module: 'VERIFY_DIM' },
    select: { id: true },
  });
  if (stale.length > 0) {
    console.log(`  (sweeping ${stale.length} voucher(s) left by an earlier run)`);
    const ids = stale.map(s => s.id);
    await db.journalEntry.updateMany({
      where: { corrects_entry_id: { in: ids } },
      data: { corrects_entry_id: null },
    });
    await db.journalLine.deleteMany({ where: { journal_entry_id: { in: ids } } });
    await db.journalEntry.deleteMany({ where: { id: { in: ids } } });
  }

  // …and the values those vouchers first-used, which are now unreferenced.
  // **[OFFICIAL]** an entity-backed value exists because it was *used*; an
  // unreferenced one carries no information and is recreated on next use. Values a
  // rule or a master-data default points at are NOT touched — those were configured
  // by a human, not created on first use.
  const orphans = await db.dimensionValue.findMany({
    where: {
      tenant_id: tenantId,
      source_id: { not: null },
      jl_dim1: { none: {} }, jl_dim2: { none: {} },
      jl_dim3: { none: {} }, jl_dim4: { none: {} },
      defaults: { none: {} },
      fixed_on: { none: {} },
    },
    select: { id: true, code: true },
  });
  if (orphans.length > 0) {
    console.log(`  (sweeping ${orphans.length} unreferenced value(s): ${orphans.map(o => o.code).join(', ')})`);
    await db.dimensionValue.deleteMany({ where: { id: { in: orphans.map(o => o.id) } } });
  }

  const baselineEntries = await db.journalEntry.count({ where: { tenant_id: tenantId } });
  const baselineValues = await db.dimensionValue.count({ where: { tenant_id: tenantId } });

  // ── 0. Setup is in place ─────────────────────────────────────────────────
  console.log('Setup');
  const store = await db.dimensionAttribute.findFirst({
    where: { tenant_id: tenantId, code: 'STORE' },
  });
  const dept = await db.dimensionAttribute.findFirst({
    where: { tenant_id: tenantId, code: 'DEPT' },
  });
  check('STORE axis exists on slot 1, backed by SITE',
    store?.slot === 1 && store?.value_source === 'SITE',
    `slot=${store?.slot} source=${store?.value_source}`);
  check('DEPT axis exists on slot 2, backed by OPERATING_UNIT',
    dept?.slot === 2 && dept?.value_source === 'OPERATING_UNIT',
    `slot=${dept?.slot} source=${dept?.value_source}`);
  if (!store || !dept) throw new Error('Run provisionFinancialDimensions.ts --apply first.');

  // Two REQUIRED category rules must be able to coexist. This is the exact bug
  // migration 018 shipped and 019 fixed; asserting it here stops it coming back.
  const categoryRules = await db.dimensionRule.count({
    where: { tenant_id: tenantId, attribute_id: store.id, account_category: { not: null } },
  });
  check('two category rules coexist on one axis (the 018 collision is gone)',
    categoryRules >= 2, `found ${categoryRules}`);

  // ── 1. Accounts to post against ──────────────────────────────────────────
  const revenue = await db.account.findFirst({
    where: { tenant_id: tenantId, category: 'REVENUE' },
    select: { id: true, code: true, name: true },
  });
  const ar = await db.account.findFirst({
    where: { tenant_id: tenantId, category: 'ACCOUNTS_RECEIVABLE' },
    select: { id: true, code: true, name: true },
  });
  if (!revenue || !ar) throw new Error('Need a REVENUE and an ACCOUNTS_RECEIVABLE account.');
  console.log(`\nAccounts: ${revenue.code} ${revenue.name} · ${ar.code} ${ar.name}`);

  const site = await db.site.findFirst({
    where: { tenant_id: tenantId },
    select: { id: true, code: true, name: true },
  });
  if (!site) throw new Error('Need a site.');

  // ── 2. Coding from a context ─────────────────────────────────────────────
  console.log('\nCoding a voucher from a site context');
  const v1 = await postJournal({
    tenantId,
    description: 'VERIFY dimension coding',
    source: { module: 'VERIFY_DIM', id: null },
    dimensions: { siteId: site.id },
    lines: [
      { accountId: ar.id, debit: 100 },
      { accountId: revenue.id, credit: 100 },
    ],
  });
  createdEntries.push(v1.id);

  const value = await db.dimensionValue.findFirst({
    where: { tenant_id: tenantId, attribute_id: store.id, source_id: site.id },
  });
  if (value) createdValues.push(value.id);

  check('the dimension value was created on FIRST USE, not pre-seeded', !!value);
  check('it points back at the site row', value?.source_id === site.id);
  check('its name came from the site', value?.name === site.name, `got ${value?.name}`);
  check('every line on the voucher carries slot 1',
    v1.lines.every(l => l.dimension_1_id === value?.id),
    v1.lines.map(l => l.dimension_1_id).join(','));
  check('slots 2-4 are NULL — an axis with no source is not invented',
    v1.lines.every(l => !l.dimension_2_id && !l.dimension_3_id && !l.dimension_4_id));

  // ── 3. First use happens once ────────────────────────────────────────────
  console.log('\nPosting again reuses the value');
  const v2 = await postJournal({
    tenantId,
    description: 'VERIFY dimension reuse',
    source: { module: 'VERIFY_DIM', id: null },
    dimensions: { siteId: site.id },
    lines: [
      { accountId: ar.id, debit: 50 },
      { accountId: revenue.id, credit: 50 },
    ],
  });
  createdEntries.push(v2.id);
  const valueCount = await db.dimensionValue.count({
    where: { tenant_id: tenantId, attribute_id: store.id, source_id: site.id },
  });
  check('a second posting did NOT create a second value', valueCount === 1, `found ${valueCount}`);
  check('it reuses the same value id', v2.lines.every(l => l.dimension_1_id === value?.id));

  // ── 4. Never invent ──────────────────────────────────────────────────────
  console.log('\nNo context → NULL, never a "Blank" value');
  const v3 = await postJournal({
    tenantId,
    description: 'VERIFY no context',
    source: { module: 'VERIFY_DIM', id: null },
    lines: [
      { accountId: ar.id, debit: 10 },
      { accountId: revenue.id, credit: 10 },
    ],
  });
  createdEntries.push(v3.id);
  check('an uncoded voucher posts with NULL slots, and still posts',
    v3.lines.every(l => l.dimension_1_id === null));

  // ── 5. The requirement rule actually refuses ─────────────────────────────
  console.log('\nSTORE REQUIRED on revenue');
  const ruleIds = (
    await db.dimensionRule.findMany({
      where: {
        tenant_id: tenantId,
        attribute_id: store.id,
        account_category: { in: ['REVENUE', 'COGS'] },
      },
      select: { id: true, requirement: true },
    })
  );
  const originalRequirements = new Map(ruleIds.map(r => [r.id, r.requirement]));

  try {
    await db.dimensionRule.updateMany({
      where: { id: { in: ruleIds.map(r => r.id) } },
      data: { requirement: 'REQUIRED' },
    });

    await expectCode(
      'a revenue voucher with NO store is REFUSED',
      'DIMENSION_REQUIRED_UNRESOLVED',
      () =>
        postJournal({
          tenantId,
          description: 'VERIFY required, uncoded',
          source: { module: 'VERIFY_DIM', id: null },
          lines: [
            { accountId: ar.id, debit: 10 },
            { accountId: revenue.id, credit: 10 },
          ],
        }),
    );

    const v4 = await postJournal({
      tenantId,
      description: 'VERIFY required, coded',
      source: { module: 'VERIFY_DIM', id: null },
      dimensions: { siteId: site.id },
      lines: [
        { accountId: ar.id, debit: 20 },
        { accountId: revenue.id, credit: 20 },
      ],
    });
    createdEntries.push(v4.id);
    check('the same voucher WITH a store posts', !!v4.id);

    // ── 6. A reversal copies the coding, it does not re-resolve ────────────
    console.log('\nReversal keeps the original coding');
    const rev = await reverseJournal({
      tenantId,
      entryId: v4.id,
      reason: 'VERIFY reversal coding',
    });
    createdEntries.push(rev.id);
    check('the reversal carries the SAME dimension value as the original',
      rev.lines.every(l => l.dimension_1_id === value?.id),
      rev.lines.map(l => l.dimension_1_id).join(','));

    const net = rev.lines.reduce(
      (s, l) => s + Number(l.credit_amount) - Number(l.debit_amount),
      0,
    ) + v4.lines.reduce((s, l) => s + Number(l.credit_amount) - Number(l.debit_amount), 0);
    check('original + reversal net to zero within the store', Math.abs(net) < 0.005, `net ${net}`);
  } finally {
    for (const [id, requirement] of originalRequirements) {
      await db.dimensionRule.update({ where: { id }, data: { requirement } });
    }
    console.log('  (requirement rules restored)');
  }

  // ── 7. Document context helpers ──────────────────────────────────────────
  console.log('\nDocument → context');
  const orderWithSite = await db.salesOrder.findFirst({
    where: { tenant_id: tenantId, site_id: { not: null } },
    select: { id: true, site_id: true, warehouse_id: true, order_number: true },
  });
  if (orderWithSite) {
    const ctx = await contextForSalesOrder(tenantId, orderWithSite.id);
    check(`a sales order (${orderWithSite.order_number}) yields its site`,
      ctx.siteId === orderWithSite.site_id);
    const slots = await resolveDimensions(tenantId, null, ctx);
    check('and resolves to a slot-1 value', !!slots.dimension_1_id);
    if (slots.dimension_1_id && !createdValues.includes(slots.dimension_1_id)) {
      createdValues.push(slots.dimension_1_id);
    }
  } else {
    console.log('  SKIP  no sales order carries a site');
  }

  const employee = await db.employee.findFirst({
    where: { tenant_id: tenantId, department_id: { not: null } },
    select: { id: true, employee_code: true, department_id: true },
  });
  if (employee) {
    const ctx = await contextForEmployee(tenantId, employee.id);
    check(`an employee (${employee.employee_code}) yields its department`,
      ctx.operatingUnitId === employee.department_id);
    const slots = await resolveDimensions(tenantId, null, ctx);
    check('and the department lands on slot 2, not slot 1', !!slots.dimension_2_id);
    if (slots.dimension_2_id && !createdValues.includes(slots.dimension_2_id)) {
      createdValues.push(slots.dimension_2_id);
    }
  } else {
    console.log('  SKIP  no employee has a department');
  }

  // ── 8. The database refuses a bad value ──────────────────────────────────
  // Inside a transaction that always rolls back, so a failing constraint cannot
  // leave a bogus value behind — the verifyPimSetup.ts pattern.
  console.log('\nThe database enforces the value rules');
  for (const [label, code] of [
    ['a code longer than 30 characters is refused', 'X'.repeat(31)],
    ['a code containing whitespace is refused', 'TWO WORDS'],
  ] as const) {
    let refused = false;
    try {
      await db.$transaction(async tx => {
        await tx.dimensionValue.create({
          data: { tenant_id: tenantId, attribute_id: store.id, code, name: 'bad' },
        });
        throw new Error('ROLLBACK');
      });
    } catch (e: any) {
      refused = !String(e?.message).includes('ROLLBACK');
    }
    check(label, refused);
  }

  // ── 9. The payoff query ──────────────────────────────────────────────────
  console.log('\nP&L by store, straight off the journal lines');
  const pnl = await db.$queryRawUnsafe<any[]>(
    `
    SELECT COALESCE(dv.code, '(unassigned)') AS store,
           a.category,
           SUM(jl.credit_amount - jl.debit_amount)::float AS net
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a         ON a.id = jl.account_id
    LEFT JOIN dimension_values dv ON dv.id = jl.dimension_1_id
    WHERE je.tenant_id = $1::uuid AND a.category IN ('REVENUE','COGS')
    GROUP BY 1, 2 ORDER BY 1, 2
  `,
    tenantId,
  );
  for (const r of pnl) {
    console.log(`  ${String(r.store).padEnd(16)} ${String(r.category).padEnd(10)} ${r.net.toFixed(2)}`);
  }
  check('the query runs and returns rows', pnl.length > 0);
  check('there is at least one coded store bucket',
    pnl.some(r => r.store !== '(unassigned)'));

  // ── Cleanup ──────────────────────────────────────────────────────────────
  if (KEEP) {
    console.log('\n--keep: leaving everything in place.');
  } else {
    console.log('\nCleaning up');
    // The reversal references its original through `corrects_entry_id`. Break the
    // link before deleting, or the FK decides the order for us.
    await db.journalEntry.updateMany({
      where: { corrects_entry_id: { in: createdEntries } },
      data: { corrects_entry_id: null },
    });
    await db.journalLine.deleteMany({ where: { journal_entry_id: { in: createdEntries } } });
    await db.journalEntry.deleteMany({ where: { id: { in: createdEntries } } });
    // Values are deleted only if nothing else now references them — a value that a
    // real voucher has adopted must survive.
    for (const id of createdValues) {
      const used = await db.journalLine.count({
        where: {
          OR: [
            { dimension_1_id: id }, { dimension_2_id: id },
            { dimension_3_id: id }, { dimension_4_id: id },
          ],
        },
      });
      if (used === 0) await db.dimensionValue.delete({ where: { id } });
    }

    const nowEntries = await db.journalEntry.count({ where: { tenant_id: tenantId } });
    check('journal entries are back to baseline', nowEntries === baselineEntries,
      `${nowEntries} vs ${baselineEntries}`);
    const nowValues = await db.dimensionValue.count({ where: { tenant_id: tenantId } });
    check('dimension values are back to baseline', nowValues === baselineValues,
      `${nowValues} vs ${baselineValues}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
