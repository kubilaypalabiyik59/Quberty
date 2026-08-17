import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { logger } from '../logger';
import { AppError } from '../errors/AppError';
import { nextJournalVoucher } from './numberSequence.service';
import { resolvePostingAccount } from './postingProfile.service';

/**
 * The single writer for general-ledger vouchers.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * Before this service there were 16 `journalEntry.create` call sites across 8
 * files, each hand-building its own `lines: { create: [...] }` array. Three
 * things followed from that, all verified in the code as it stood:
 *
 *   1. Debits = credits was asserted for exactly ONE of them — the manual
 *      journal route. The other 15, every machine-generated posting in the
 *      product, wrote whatever they were given.
 *   2. The closed-period check existed in that same one route. A POS sale, a
 *      product receipt or a payroll run posted into a closed period without
 *      anything noticing.
 *   3. `FinanceParameters.allow_posting_to_closed_period` and
 *      `rounding_tolerance` were declared in migration 001 and read by NOTHING.
 *      Configuration that nothing reads is worse than no configuration, because
 *      it looks like it works.
 *
 * Adding any new cross-cutting concern — financial dimensions being the one that
 * prompted this — meant editing 16 literal arrays and hoping none was missed. A
 * missed one is invisible: the entry still posts and still balances, it is just
 * uncoded. That is the D-2 / D-4 failure mode this project has already paid for.
 *
 * ── What is parametric, and what the parameter means ───────────────────────
 * Nothing in here is a policy decision baked into code. Every rule below reads
 * `FinanceParameters`:
 *
 *   allow_posting_to_closed_period  false → a voucher dated in a CLOSED period
 *                                   is refused. true → allowed, logged at WARN.
 *   rounding_tolerance              the imbalance below which the difference is
 *                                   posted to the ROUNDING account rather than
 *                                   rejected. Above it, the voucher is refused.
 *   require_balanced_posting        inherited from posting.service.ts, which
 *                                   decides whether an unresolvable account
 *                                   throws or degrades. Not re-read here.
 *
 * ── Official behaviour this follows ────────────────────────────────────────
 * **[OFFICIAL]** "Vouchers always represent individual transactions, never a
 * group of transactions. Transactions can be grouped by other fields instead,
 * such as the journal batch number or the document number."
 * https://learn.microsoft.com/dynamics365/finance/general-ledger/one-voucher
 *
 * That is why `source` is mandatory and why this function posts ONE voucher per
 * call. Grouping several business transactions into one voucher — D365 calls it
 * *One voucher* and gates it behind the *Allow multiple transactions within one
 * voucher* parameter — is documented there as breaking settlement, tax
 * calculation, reversal and inquiry, because the detail cannot be recovered
 * afterwards. We do not offer it. Callers that need two transactions call twice,
 * which is what every current caller already does (POS posts revenue and COGS as
 * two vouchers, deliberately).
 */

export interface JournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string | null;
}

export interface PostJournalOptions {
  tenantId: string;
  /** Voucher date. Decides which accounting period is checked. Defaults to now. */
  date?: Date;
  description: string;
  /** What produced this voucher. Mandatory — see the One voucher note above. */
  source: { module: string; id?: string | null };
  lines: JournalLineInput[];
  userId?: string | null;
  /** DRAFT leaves it unposted; POSTED stamps `posted_at`. Defaults to POSTED. */
  status?: 'DRAFT' | 'POSTED';
  legalEntityId?: string | null;
  /** Join the caller's transaction. Pass it whenever one is open. */
  tx?: Prisma.TransactionClient;
  /** Pre-allocated voucher number. Omit and one is allocated. */
  entryNumber?: string;
  /**
   * Marks this voucher as correcting another one. See `reverseJournal` — most
   * callers should use that rather than setting this by hand, because it also
   * derives the lines from the original.
   */
  corrects?: { entryId: string; reason: string };
}

export type CorrectionMethod = 'REVERSE' | 'STORNO';

type Client = Prisma.TransactionClient | typeof db;

interface EffectiveParameters {
  allowClosedPeriod: boolean;
  roundingTolerance: number;
  correctionMethod: CorrectionMethod;
}

/**
 * Read the tenant's finance parameters.
 *
 * An unprovisioned tenant gets the strict defaults, for the same reason
 * posting.service.ts does: a tenant nobody configured is exactly the tenant whose
 * silent posting caused the original damage.
 */
async function effectiveParameters(
  tenantId: string,
  legalEntityId: string | null,
  client: Client,
): Promise<EffectiveParameters> {
  const row = await client.financeParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
    select: {
      allow_posting_to_closed_period: true,
      rounding_tolerance: true,
      correction_method: true,
    },
  });

  return {
    allowClosedPeriod: row?.allow_posting_to_closed_period ?? false,
    roundingTolerance: row ? Number(row.rounding_tolerance) : 0.02,
    correctionMethod: (row?.correction_method as CorrectionMethod) ?? 'REVERSE',
  };
}

/**
 * Refuse a voucher dated into a closed period.
 *
 * This check previously existed only on the manual journal route. Applying it to
 * every writer is the point of this service: a period that is closed for the
 * accountant but open for the POS is not closed.
 */
async function assertPeriodPostable(
  tenantId: string,
  date: Date,
  params: EffectiveParameters,
  document: string,
  client: Client,
): Promise<void> {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const label = `${year}/${String(month).padStart(2, '0')}`;

  const closed = await client.accountingPeriod.findFirst({
    where: { tenant_id: tenantId, year, month, status: 'CLOSED' },
    select: { id: true },
  });
  if (!closed) return;

  if (params.allowClosedPeriod) {
    // Permitted, but never silent. A posting into a closed period changes a
    // number somebody has already reported on.
    logger.warn(
      { tenantId, document, period: label },
      'Posting into a CLOSED period — permitted by allow_posting_to_closed_period',
    );
    return;
  }

  throw new AppError(
    `${document} cannot be posted: period ${label} is closed. ` +
      `Reopen the period, or change the voucher date.`,
    400,
    'PERIOD_CLOSED',
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Post one balanced voucher.
 *
 * Returns the created entry. Throws rather than degrading — a voucher that
 * cannot be written correctly must fail its document, which is the D-4 rule.
 */
export async function postJournal(opts: PostJournalOptions) {
  const {
    tenantId,
    description,
    source,
    userId = null,
    status = 'POSTED',
    legalEntityId = null,
    tx,
  } = opts;

  const client: Client = tx ?? db;
  const date = opts.date ?? new Date();
  const document = `${source.module} ${description}`.trim();

  if (opts.lines.length === 0) {
    throw new AppError(`${document} cannot be posted: no journal lines`, 500, 'JOURNAL_EMPTY');
  }

  // ── Normalise the lines ──────────────────────────────────────────────────
  interface NormalisedLine {
    accountId: string;
    debit: number;
    credit: number;
    description: string | null;
  }
  const lines: NormalisedLine[] = [];

  for (const l of opts.lines) {
    const debit = round2(Number(l.debit ?? 0));
    const credit = round2(Number(l.credit ?? 0));

    if (debit !== 0 && credit !== 0) {
      // A journal line is one side of an entry. A line carrying both is a caller
      // bug that would net out invisibly in every report.
      throw new AppError(
        `${document} cannot be posted: a journal line carries both a debit (${debit}) ` +
          `and a credit (${credit}). Split it into two lines.`,
        500,
        'JOURNAL_LINE_TWO_SIDED',
      );
    }

    if (debit === 0 && credit === 0) {
      // Dropped rather than rejected, because several existing callers emit a
      // zero line for an empty bucket. Loud, so it can be traced back and fixed.
      logger.warn(
        { tenantId, document, accountId: l.accountId },
        'Journal line with zero debit and zero credit was dropped',
      );
      continue;
    }

    lines.push({
      accountId: l.accountId,
      debit,
      credit,
      description: l.description ?? null,
    });
  }

  if (lines.length === 0) {
    throw new AppError(
      `${document} cannot be posted: every journal line was zero`,
      500,
      'JOURNAL_EMPTY',
    );
  }

  const params = await effectiveParameters(tenantId, legalEntityId, client);
  await assertPeriodPostable(tenantId, date, params, document, client);

  // ── Balance ──────────────────────────────────────────────────────────────
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  const imbalance = round2(totalDebit - totalCredit);

  if (imbalance !== 0) {
    if (Math.abs(imbalance) > params.roundingTolerance) {
      throw new AppError(
        `${document} cannot be posted: debits ${totalDebit.toFixed(2)} ≠ credits ` +
          `${totalCredit.toFixed(2)} (out by ${imbalance.toFixed(2)}, tolerance ` +
          `${params.roundingTolerance.toFixed(2)}).`,
        500,
        'JOURNAL_UNBALANCED',
      );
    }

    // Within tolerance: absorb it into ROUNDING rather than reject. This is what
    // `rounding_tolerance` has promised since migration 001 and what nothing
    // implemented. If ROUNDING is unconfigured we still refuse — silently
    // posting an unbalanced voucher is not an option available to us.
    let roundingAccountId: string;
    try {
      roundingAccountId = await resolvePostingAccount('ROUNDING', { tenantId, legalEntityId, on: date }, client);
    } catch {
      throw new AppError(
        `${document} cannot be posted: it is out by ${imbalance.toFixed(2)}, which is within ` +
          `the rounding tolerance, but no ROUNDING posting profile is configured to absorb it.`,
        500,
        'ROUNDING_PROFILE_UNRESOLVED',
      );
    }

    lines.push({
      accountId: roundingAccountId,
      debit: imbalance < 0 ? Math.abs(imbalance) : 0,
      credit: imbalance > 0 ? imbalance : 0,
      description: 'Rounding',
    });

    logger.info(
      { tenantId, document, imbalance },
      'Rounding difference absorbed into the ROUNDING account',
    );
  }

  // ── Write ────────────────────────────────────────────────────────────────
  const corrects = opts.corrects;
  if (corrects && !corrects.reason?.trim()) {
    throw new AppError(
      `${document} cannot be posted: a correction must state a reason.`,
      400,
      'CORRECTION_REASON_REQUIRED',
    );
  }

  const entryNumber = opts.entryNumber ?? (await nextJournalVoucher(tenantId, tx, legalEntityId));

  return client.journalEntry.create({
    data: {
      tenant_id: tenantId,
      entry_number: entryNumber,
      entry_date: date,
      description,
      source_module: source.module,
      source_id: source.id ?? null,
      status,
      posted_at: status === 'POSTED' ? new Date() : null,
      created_by: userId,
      corrects_entry_id: corrects?.entryId ?? null,
      correction_reason: corrects?.reason ?? null,
      is_correction: !!corrects,
      lines: {
        create: lines.map(l => ({
          account_id: l.accountId,
          debit_amount: l.debit,
          credit_amount: l.credit,
          description: l.description,
          // Only STORNO produces lines that need distinguishing — a negative amount
          // in the original column is otherwise indistinguishable from a genuinely
          // negative posting. Under REVERSE the flag is informational.
          is_correction: !!corrects,
        })),
      },
    },
    include: { lines: true },
  });
}

/**
 * Reverse a posted voucher, by the method the tenant is configured for.
 *
 * The lines are DERIVED from the original, never retyped — that is the difference
 * between a correction and a manual journal that happens to offset something.
 *
 * ── Official rules taken verbatim ──────────────────────────────────────────
 * **[OFFICIAL]** Business Central,
 * learn.microsoft.com/dynamics365/business-central/finance-how-reverse-journal-posting
 *   · "An entry can only be reversed one time."  → enforced by the unique index on
 *     `corrects_entry_id`, and checked here first so the caller gets a real message
 *     rather than a constraint violation.
 *   · "After you reverse an entry, you must make the correct entry."  → reversal and
 *     re-posting are two steps. This function does the first only, deliberately.
 *
 * ── One deliberate deviation ───────────────────────────────────────────────
 * BC reuses the original posting date. We do NOT: if the original period is closed,
 * backdating would post into a closed period, which is precisely what the rest of
 * this service exists to prevent, and in most jurisdictions a closed period has
 * already been declared. The correction posts on `date` (default today) and the
 * original date stays reachable through `corrects_entry_id`, which is where the
 * audit trail belongs. See docs/architecture/CORRECTIONS.md §4.2.
 */
export async function reverseJournal(opts: {
  tenantId: string;
  entryId: string;
  reason: string;
  /** When the reversal posts. Defaults to now — NOT the original's date, see above. */
  date?: Date;
  userId?: string | null;
  legalEntityId?: string | null;
  tx?: Prisma.TransactionClient;
}) {
  const { tenantId, entryId, reason, userId = null, legalEntityId = null, tx } = opts;
  const client: Client = tx ?? db;

  const original = await client.journalEntry.findFirst({
    where: { id: entryId, tenant_id: tenantId },
    include: { lines: true },
  });
  if (!original) {
    throw new AppError(`Journal entry ${entryId} not found.`, 404, 'JOURNAL_NOT_FOUND');
  }
  if (original.status !== 'POSTED') {
    throw new AppError(
      `Journal entry ${original.entry_number} is ${original.status}, not POSTED. ` +
        `An unposted entry is edited or deleted, not reversed.`,
      400,
      'JOURNAL_NOT_POSTED',
    );
  }
  if (original.is_correction) {
    throw new AppError(
      `Journal entry ${original.entry_number} is itself a correction. ` +
        `Reversing a reversal produces a chain nobody can read — post a fresh correcting entry instead.`,
      400,
      'JOURNAL_ALREADY_A_CORRECTION',
    );
  }

  const already = await client.journalEntry.findFirst({
    where: { corrects_entry_id: entryId },
    select: { entry_number: true },
  });
  if (already) {
    throw new AppError(
      `Journal entry ${original.entry_number} has already been reversed by ${already.entry_number}. ` +
        `An entry can only be reversed once.`,
      409,
      'JOURNAL_ALREADY_REVERSED',
    );
  }

  const params = await effectiveParameters(tenantId, legalEntityId, client);

  const lines: JournalLineInput[] = original.lines.map(l => {
    const debit = Number(l.debit_amount);
    const credit = Number(l.credit_amount);

    return params.correctionMethod === 'STORNO'
      ? // Same columns, sign flipped — the original is zeroed out and turnover
        // stays truthful.
        { accountId: l.account_id, debit: -debit, credit: -credit, description: l.description }
      : // Mirrored — balance is right, but both turnovers carry the round trip.
        { accountId: l.account_id, debit: credit, credit: debit, description: l.description };
  });

  logger.info(
    { tenantId, original: original.entry_number, method: params.correctionMethod, reason },
    'Reversing journal entry',
  );

  return postJournal({
    tenantId,
    legalEntityId,
    tx,
    date: opts.date,
    description: `Reversal of ${original.entry_number} — ${original.description}`,
    source: { module: original.source_module ?? 'CORRECTION', id: original.source_id },
    userId,
    lines,
    corrects: { entryId, reason },
  });
}
