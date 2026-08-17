/**
 * Verify the correction machinery, and the tax-report change that has to land
 * before any correction is posted.
 *
 *   npx tsx scripts/verifyCorrections.ts
 *
 * The first section is the one that matters most. The IVA report used to resolve
 * its accounts by literal code (['2103','2105']) and now resolves them by
 * `Account.category`. If any account carrying output tax is UNCATEGORISED, the new
 * report silently drops it — which would re-create D-7, the defect where POS output
 * tax never reached the declaration. So this asserts the two resolutions agree
 * before it asserts anything else.
 *
 * Self-cleaning: correcting vouchers are deleted before the vouchers they correct,
 * because the FK is ON DELETE RESTRICT by design.
 */
import { db } from '../src/infrastructure/database/client';
import { postJournal, reverseJournal } from '../src/shared/services/journal.service';
import { AppError } from '../src/shared/errors/AppError';

let passed = 0;
let failed = 0;
const createdOriginals: string[] = [];
const createdCorrections: string[] = [];

function check(label: string, condition: boolean, detail = '') {
  if (condition) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
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

const money = (n: number) => n.toFixed(2);

async function main() {
  const tenant = await db.tenant.findFirst({ select: { id: true, name: true } });
  if (!tenant) throw new Error('No tenant.');
  console.log(`Tenant: ${tenant.name}\n`);

  // ── 1. The regression this change could cause ────────────────────────────
  console.log('──────────────────────────────────────────────────────────────');
  console.log('1  Tax accounts: does resolving by category find what the');
  console.log('   hardcoded codes used to find?  (D-7 regression guard)');
  console.log('──────────────────────────────────────────────────────────────');

  const LEGACY_DEBITO  = ['2103', '2105'];
  const LEGACY_CREDITO = ['1105'];

  const byCode = await db.account.findMany({
    where: { tenant_id: tenant.id, code: { in: [...LEGACY_DEBITO, ...LEGACY_CREDITO] } },
    select: { id: true, code: true, name: true, category: true },
    orderBy: { code: 'asc' },
  });

  const byCategory = await db.account.findMany({
    where: { tenant_id: tenant.id, category: { in: ['VAT_PAYABLE', 'VAT_RECEIVABLE'] } },
    select: { id: true, code: true, name: true, category: true },
    orderBy: { code: 'asc' },
  });

  console.log('  accounts the OLD literals found:');
  for (const a of byCode) console.log(`    ${a.code}  ${a.name}  category=${a.category ?? 'NULL'}`);
  console.log('  accounts the NEW category lookup finds:');
  for (const a of byCategory) console.log(`    ${a.code}  ${a.name}  ${a.category}`);

  const legacyIds = new Set(byCode.map(a => a.id));
  const categoryIds = new Set(byCategory.map(a => a.id));
  const droppedByCategory = byCode.filter(a => !categoryIds.has(a.id));

  check(
    'no account the literals found is missed by the category lookup',
    droppedByCategory.length === 0,
    droppedByCategory.map(a => `${a.code} ${a.name} category=${a.category ?? 'NULL'}`).join(' · '),
  );

  const gainedByCategory = byCategory.filter(a => !legacyIds.has(a.id));
  if (gainedByCategory.length > 0) {
    console.log(
      `  NOTE  the category lookup ALSO finds ${gainedByCategory.length} account(s) the literals ` +
        `missed: ${gainedByCategory.map(a => `${a.code} ${a.name}`).join(', ')}`,
    );
  }

  // ── 2. Reversal, both methods ────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('2  Reversal by the configured method');
  console.log('──────────────────────────────────────────────────────────────');

  const accounts = await db.account.findMany({
    where: { tenant_id: tenant.id, type: { not: 'HEADING' } },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
    take: 2,
  });
  const [a, b] = accounts;

  const params = await db.financeParameters.findFirst({
    where: { tenant_id: tenant.id, legal_entity_id: null },
    select: { id: true, correction_method: true },
  });
  if (!params) throw new Error('Tenant has no finance_parameters row.');
  const originalMethod = params.correction_method;
  check('correction_method defaults to REVERSE', originalMethod === 'REVERSE', `got ${originalMethod}`);

  try {
    // ---- REVERSE ----
    await db.financeParameters.update({ where: { id: params.id }, data: { correction_method: 'REVERSE' } });

    const orig1 = await postJournal({
      tenantId: tenant.id,
      description: 'VERIFY-CORR original for reverse',
      source: { module: 'VERIFY_CORR' },
      lines: [
        { accountId: a.id, debit: 100, description: 'dr' },
        { accountId: b.id, credit: 100, description: 'cr' },
      ],
    });
    createdOriginals.push(orig1.id);

    const rev = await reverseJournal({
      tenantId: tenant.id,
      entryId: orig1.id,
      reason: 'verification run',
    });
    createdCorrections.push(rev.id);

    const revA = rev.lines.find(l => l.account_id === a.id)!;
    check('REVERSE swaps debit and credit', Number(revA.credit_amount) === 100 && Number(revA.debit_amount) === 0,
      `dr=${revA.debit_amount} cr=${revA.credit_amount}`);
    check('REVERSE keeps amounts positive', Number(revA.credit_amount) > 0);
    check('the correction records what it corrects', rev.corrects_entry_id === orig1.id);
    check('the correction records why', rev.correction_reason === 'verification run');
    check('the correction is flagged', rev.is_correction === true);

    // ---- once only ----
    await expectCode('an entry can only be reversed once', 'JOURNAL_ALREADY_REVERSED', () =>
      reverseJournal({ tenantId: tenant.id, entryId: orig1.id, reason: 'again' }),
    );

    await expectCode('a reversal cannot itself be reversed', 'JOURNAL_ALREADY_A_CORRECTION', () =>
      reverseJournal({ tenantId: tenant.id, entryId: rev.id, reason: 'chain' }),
    );

    await expectCode('a correction must state a reason', 'CORRECTION_REASON_REQUIRED', () =>
      postJournal({
        tenantId: tenant.id,
        description: 'VERIFY-CORR no reason',
        source: { module: 'VERIFY_CORR' },
        corrects: { entryId: orig1.id, reason: '   ' },
        lines: [
          { accountId: a.id, debit: 1 },
          { accountId: b.id, credit: 1 },
        ],
      }),
    );

    // ---- STORNO ----
    await db.financeParameters.update({ where: { id: params.id }, data: { correction_method: 'STORNO' } });

    const orig2 = await postJournal({
      tenantId: tenant.id,
      description: 'VERIFY-CORR original for storno',
      source: { module: 'VERIFY_CORR' },
      lines: [
        { accountId: a.id, debit: 100, description: 'dr' },
        { accountId: b.id, credit: 100, description: 'cr' },
      ],
    });
    createdOriginals.push(orig2.id);

    const sto = await reverseJournal({
      tenantId: tenant.id,
      entryId: orig2.id,
      reason: 'verification run',
    });
    createdCorrections.push(sto.id);

    const stoA = sto.lines.find(l => l.account_id === a.id)!;
    check('STORNO keeps the amount in its original column', Number(stoA.debit_amount) === -100,
      `dr=${stoA.debit_amount} cr=${stoA.credit_amount}`);
    check('STORNO lines are flagged as corrections', stoA.is_correction === true);

    // The whole point of storno: turnover on the account returns to zero, whereas
    // reverse leaves a round trip in both columns.
    const turnover = (entryIds: string[]) =>
      db.journalLine.aggregate({
        where: { journal_entry_id: { in: entryIds }, account_id: a.id },
        _sum: { debit_amount: true, credit_amount: true },
      });

    const revTurnover = await turnover([orig1.id, rev.id]);
    const stoTurnover = await turnover([orig2.id, sto.id]);

    const revDr = Number(revTurnover._sum.debit_amount ?? 0);
    const revCr = Number(revTurnover._sum.credit_amount ?? 0);
    const stoDr = Number(stoTurnover._sum.debit_amount ?? 0);
    const stoCr = Number(stoTurnover._sum.credit_amount ?? 0);

    console.log(`        REVERSE turnover on ${a.code}: dr ${money(revDr)}  cr ${money(revCr)}`);
    console.log(`        STORNO  turnover on ${a.code}: dr ${money(stoDr)}  cr ${money(stoCr)}`);

    check('REVERSE leaves turnover on both sides (the documented downside)',
      revDr === 100 && revCr === 100);
    check('STORNO returns turnover to zero (the documented upside)',
      stoDr === 0 && stoCr === 0);
    check('both methods leave the same net balance', (revDr - revCr) === (stoDr - stoCr));

    // ---- an unposted entry is not reversible ----
    const draft = await postJournal({
      tenantId: tenant.id,
      description: 'VERIFY-CORR draft',
      source: { module: 'VERIFY_CORR' },
      status: 'DRAFT',
      lines: [
        { accountId: a.id, debit: 5 },
        { accountId: b.id, credit: 5 },
      ],
    });
    createdOriginals.push(draft.id);
    await expectCode('a DRAFT entry is edited, not reversed', 'JOURNAL_NOT_POSTED', () =>
      reverseJournal({ tenantId: tenant.id, entryId: draft.id, reason: 'nope' }),
    );
  } finally {
    await db.financeParameters.update({
      where: { id: params.id },
      data: { correction_method: originalMethod },
    });
  }

  // ── 3. The report change ─────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('3  A correction reaches the tax declaration');
  console.log('──────────────────────────────────────────────────────────────');

  const vatPayable = byCategory.find(x => x.category === 'VAT_PAYABLE');
  if (!vatPayable) {
    console.log('  SKIP  no VAT_PAYABLE account categorised on this tenant');
  } else {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const readReport = async () => {
      const lines = await db.journalLine.findMany({
        where: {
          account_id: vatPayable.id,
          journal_entry: { tenant_id: tenant.id, status: 'POSTED', entry_date: { gte: from, lte: to } },
        },
        select: { debit_amount: true, credit_amount: true },
      });
      const oldWay = lines.reduce((s, l) => s + Number(l.credit_amount), 0);
      const newWay = lines.reduce((s, l) => s + Number(l.credit_amount) - Number(l.debit_amount), 0);
      return { oldWay: Number(oldWay.toFixed(2)), newWay: Number(newWay.toFixed(2)) };
    };

    const before = await readReport();

    const taxEntry = await postJournal({
      tenantId: tenant.id,
      description: 'VERIFY-CORR output tax',
      source: { module: 'VERIFY_CORR' },
      lines: [
        { accountId: a.id, debit: 13, description: 'dr' },
        { accountId: vatPayable.id, credit: 13, description: 'output tax' },
      ],
    });
    createdOriginals.push(taxEntry.id);

    const afterPost = await readReport();
    check('the tax charge raises the declaration', afterPost.newWay === Number((before.newWay + 13).toFixed(2)),
      `${money(before.newWay)} → ${money(afterPost.newWay)}`);

    // Reverse it, under REVERSE — the method that produces a DEBIT to the tax
    // account, which is exactly what the old one-column sum could not see.
    const taxRev = await reverseJournal({
      tenantId: tenant.id,
      entryId: taxEntry.id,
      reason: 'verification: correction must reach the declaration',
    });
    createdCorrections.push(taxRev.id);

    const afterRev = await readReport();
    console.log(`        one-column sum (OLD): ${money(before.oldWay)} → ${money(afterRev.oldWay)}`);
    console.log(`        netted      (NEW): ${money(before.newWay)} → ${money(afterRev.newWay)}`);

    check('NETTED: the correction brings the declaration back',
      afterRev.newWay === before.newWay, `${money(afterRev.newWay)} vs ${money(before.newWay)}`);
    check('ONE-COLUMN: the old code would still show the reversed tax as owed',
      afterRev.oldWay === Number((before.oldWay + 13).toFixed(2)),
      `${money(afterRev.oldWay)} — if this fails the premise of the fix is wrong`);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('CLEANUP');
  console.log('──────────────────────────────────────────────────────────────');

  // Corrections first: the FK is ON DELETE RESTRICT, deliberately.
  await db.journalLine.deleteMany({ where: { journal_entry_id: { in: createdCorrections } } });
  await db.journalEntry.deleteMany({ where: { id: { in: createdCorrections } } });
  await db.journalLine.deleteMany({ where: { journal_entry_id: { in: createdOriginals } } });
  await db.journalEntry.deleteMany({ where: { id: { in: createdOriginals } } });

  const strays = await db.journalEntry.count({
    where: { tenant_id: tenant.id, source_module: 'VERIFY_CORR' },
  });
  check('no verification vouchers left behind', strays === 0, `${strays} remain`);

  const methodNow = await db.financeParameters.findFirst({
    where: { id: params.id },
    select: { correction_method: true },
  });
  check('correction_method restored', methodNow?.correction_method === originalMethod);

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
