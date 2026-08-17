/**
 * Drive postJournal against the REAL database and assert the rules it is supposed
 * to enforce — the rules that, before it existed, only the manual journal route had.
 *
 *   npx tsx scripts/verifyJournalPosting.ts
 *   npx tsx scripts/verifyJournalPosting.ts --keep    leave the vouchers for inspection
 *
 * Self-cleaning: every voucher it writes is deleted again and the journal count is
 * asserted back to the baseline it started from. The one piece of tenant state it
 * touches — an accounting period and the closed-period parameter — is restored in a
 * `finally`, because a script that fails halfway must not leave a period closed.
 */
import { db } from '../src/infrastructure/database/client';
import { postJournal } from '../src/shared/services/journal.service';
import { AppError } from '../src/shared/errors/AppError';

const KEEP = process.argv.includes('--keep');

let passed = 0;
let failed = 0;
const created: string[] = [];

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Assert that a call throws an AppError carrying the expected code. */
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

  const accounts = await db.account.findMany({
    where: { tenant_id: tenant.id, type: { not: 'HEADING' } },
    select: { id: true, code: true, name: true },
    orderBy: { code: 'asc' },
    take: 2,
  });
  if (accounts.length < 2) throw new Error('Need at least two postable accounts.');
  const [a, b] = accounts;

  console.log(`Tenant: ${tenant.name}`);
  console.log(`Accounts: ${a.code} ${a.name} · ${b.code} ${b.name}\n`);

  const baseline = await db.journalEntry.count({ where: { tenant_id: tenant.id } });
  console.log(`Baseline journal entries: ${baseline}\n`);

  // ── 1. The happy path ────────────────────────────────────────────────────
  console.log('Balanced voucher');
  const ok1 = await postJournal({
    tenantId: tenant.id,
    description: 'VERIFY balanced',
    source: { module: 'VERIFY', id: null },
    lines: [
      { accountId: a.id, debit: 100, description: 'debit side' },
      { accountId: b.id, credit: 100, description: 'credit side' },
    ],
  });
  created.push(ok1.id);
  check('posts and returns an entry', !!ok1.id);
  check('draws its number from the NumberSequence, not order_counters',
    /^JE-\d{4}-\d+$/.test(ok1.entry_number), `got ${ok1.entry_number}`);
  check('writes both lines', ok1.lines.length === 2, `got ${ok1.lines.length}`);
  check('status is POSTED with a posted_at', ok1.status === 'POSTED' && !!ok1.posted_at);

  // ── 2. Balance is now enforced for every writer, not just the manual one ──
  console.log('\nBalance assertion');
  await expectCode('an unbalanced voucher is refused', 'JOURNAL_UNBALANCED', () =>
    postJournal({
      tenantId: tenant.id,
      description: 'VERIFY unbalanced',
      source: { module: 'VERIFY' },
      lines: [
        { accountId: a.id, debit: 100 },
        { accountId: b.id, credit: 90 },
      ],
    }),
  );

  await expectCode('a line carrying both a debit and a credit is refused', 'JOURNAL_LINE_TWO_SIDED', () =>
    postJournal({
      tenantId: tenant.id,
      description: 'VERIFY two-sided',
      source: { module: 'VERIFY' },
      lines: [{ accountId: a.id, debit: 50, credit: 50 }],
    }),
  );

  await expectCode('a voucher with no lines is refused', 'JOURNAL_EMPTY', () =>
    postJournal({
      tenantId: tenant.id,
      description: 'VERIFY empty',
      source: { module: 'VERIFY' },
      lines: [],
    }),
  );

  // A zero line is dropped, loudly, and the rest still posts.
  const ok2 = await postJournal({
    tenantId: tenant.id,
    description: 'VERIFY zero line dropped',
    source: { module: 'VERIFY' },
    lines: [
      { accountId: a.id, debit: 25 },
      { accountId: b.id, debit: 0, credit: 0 },
      { accountId: b.id, credit: 25 },
    ],
  });
  created.push(ok2.id);
  check('a zero/zero line is dropped and the rest posts', ok2.lines.length === 2, `got ${ok2.lines.length}`);

  // ── 3. Rounding ──────────────────────────────────────────────────────────
  // The tenant has no ROUNDING profile, so an imbalance inside the tolerance must
  // be refused with a message that says exactly that — never posted unbalanced.
  console.log('\nRounding tolerance');
  const roundingProfiles = await db.postingProfile.count({
    where: { tenant_id: tenant.id, posting_type: 'ROUNDING' },
  });
  if (roundingProfiles === 0) {
    await expectCode(
      'a 0.01 imbalance is refused while ROUNDING is unconfigured',
      'ROUNDING_PROFILE_UNRESOLVED',
      () =>
        postJournal({
          tenantId: tenant.id,
          description: 'VERIFY rounding',
          source: { module: 'VERIFY' },
          lines: [
            { accountId: a.id, debit: 100.01 },
            { accountId: b.id, credit: 100 },
          ],
        }),
    );
  } else {
    const ok3 = await postJournal({
      tenantId: tenant.id,
      description: 'VERIFY rounding absorbed',
      source: { module: 'VERIFY' },
      lines: [
        { accountId: a.id, debit: 100.01 },
        { accountId: b.id, credit: 100 },
      ],
    });
    created.push(ok3.id);
    check('a 0.01 imbalance is absorbed into ROUNDING', ok3.lines.length === 3, `got ${ok3.lines.length}`);
  }

  // ── 4. Closed periods, for every writer ──────────────────────────────────
  console.log('\nClosed period');
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const priorPeriod = await db.accountingPeriod.findFirst({
    where: { tenant_id: tenant.id, year, month },
  });
  const priorParams = await db.financeParameters.findFirst({
    where: { tenant_id: tenant.id, legal_entity_id: null },
    select: { id: true, allow_posting_to_closed_period: true },
  });

  try {
    if (priorPeriod) {
      await db.accountingPeriod.update({ where: { id: priorPeriod.id }, data: { status: 'CLOSED' } });
    } else {
      await db.accountingPeriod.create({
        data: { tenant_id: tenant.id, year, month, status: 'CLOSED' },
      });
    }

    await expectCode('a voucher into a CLOSED period is refused', 'PERIOD_CLOSED', () =>
      postJournal({
        tenantId: tenant.id,
        description: 'VERIFY closed period',
        source: { module: 'VERIFY' },
        lines: [
          { accountId: a.id, debit: 10 },
          { accountId: b.id, credit: 10 },
        ],
      }),
    );

    // …and the parameter genuinely governs it, rather than the rule being hardcoded.
    if (priorParams) {
      await db.financeParameters.update({
        where: { id: priorParams.id },
        data: { allow_posting_to_closed_period: true },
      });

      const ok4 = await postJournal({
        tenantId: tenant.id,
        description: 'VERIFY closed period permitted',
        source: { module: 'VERIFY' },
        lines: [
          { accountId: a.id, debit: 10 },
          { accountId: b.id, credit: 10 },
        ],
      });
      created.push(ok4.id);
      check('allow_posting_to_closed_period=true permits it', !!ok4.id);
    } else {
      console.log('  SKIP  allow_posting_to_closed_period — tenant has no finance_parameters row');
    }
  } finally {
    // Restore the tenant exactly as it was found, whatever happened above.
    if (priorParams) {
      await db.financeParameters.update({
        where: { id: priorParams.id },
        data: { allow_posting_to_closed_period: priorParams.allow_posting_to_closed_period },
      });
    }
    if (priorPeriod) {
      await db.accountingPeriod.update({
        where: { id: priorPeriod.id },
        data: { status: priorPeriod.status },
      });
    } else {
      await db.accountingPeriod.deleteMany({ where: { tenant_id: tenant.id, year, month } });
    }
  }

  // ── 5. Clean up and prove the counts came back ───────────────────────────
  console.log('');
  if (KEEP) {
    console.log(`--keep: ${created.length} vouchers left in the database for inspection`);
  } else {
    await db.journalLine.deleteMany({ where: { journal_entry_id: { in: created } } });
    await db.journalEntry.deleteMany({ where: { id: { in: created } } });

    const after = await db.journalEntry.count({ where: { tenant_id: tenant.id } });
    check('journal entry count is back to the baseline', after === baseline, `${after} vs ${baseline}`);

    const strays = await db.journalEntry.count({
      where: { tenant_id: tenant.id, source_module: 'VERIFY' },
    });
    check('no VERIFY vouchers left behind', strays === 0, `${strays} remain`);
  }

  const periodsLeft = await db.accountingPeriod.count({
    where: { tenant_id: tenant.id, year, month, status: 'CLOSED' },
  });
  check('no period was left closed', periodsLeft === (priorPeriod?.status === 'CLOSED' ? 1 : 0));

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async err => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
