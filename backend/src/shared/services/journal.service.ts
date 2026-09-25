import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { logger } from '../logger';
import { AppError } from '../errors/AppError';
import { nextJournalVoucher } from './numberSequence.service';
import { resolvePostingAccount } from './postingProfile.service';
import { getLedgerCurrencies, type LedgerCurrencies } from './currency/ledgerCurrency.service';
import { resolveRate, translate, type ResolvedRate } from './currency/exchangeRate.service';
import { roundAmount, assertPostablePrecision, type CurrencyRoundingRule } from './currency/currencyRounding';
import {
  resolveDimensions,
  assertRequiredDimensions,
  EMPTY_SLOTS,
  type DimensionContext,
  type ResolvedSlots,
} from './dimension.service';

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
 *   reporting_rounding_tolerance    the same limit for the reporting currency.
 *   accounting/reporting currency   what the voucher is measured in, and the rate
 *   and rate types                  types its rates are taken from (WORK-024).
 *   require_balanced_posting        inherited from posting.service.ts, which
 *                                   decides whether an unresolvable account
 *                                   throws or degrades. Not re-read here.
 *
 * ── Currency (WORK-024b) ───────────────────────────────────────────────────
 * Every line carries three amounts: as transacted, as accounted, and as reported.
 * **[OFFICIAL]** both the accounting and the reporting amount are translated FROM
 * the transaction amount — never accounting → reporting — and each line is
 * translated and rounded before the lines are summed:
 *   learn.microsoft.com/dynamics365/finance/general-ledger/dual-currency
 * A voucher must balance in all three, with its own penny tolerance for the
 * accounting and the reporting currency:
 *   learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/posting-fail-imbalance
 *
 * `debit_amount`/`credit_amount` remain the ACCOUNTING amounts, so every existing
 * report keeps its meaning. Omitting `currency` means the voucher is in the
 * ledger's accounting currency: every translation is then an identity that costs
 * no rate lookup, which is what all current callers do.
 *
 * **One deliberate deviation.** D365 balances the transaction currency strictly
 * and never writes a penny line there. We keep this codebase's existing behaviour
 * — an imbalance within `rounding_tolerance` is absorbed into ROUNDING — because
 * it is live, relied-on behaviour, and because while the transaction currency IS
 * the accounting currency the two rules coincide exactly.
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

/**
 * A line's three amount pairs and its rates, already decided.
 *
 * Exists for ONE caller: `reverseJournal`, for the same reason `rawSlots` does. A
 * reversal re-translated at today's rate would leave an FX residue that never nets
 * to zero against the original. Do not use it to hand-post amounts.
 */
export interface RawAmounts {
  transactionCurrencyCode: string;
  transactionDebit: number;
  transactionCredit: number;
  accountingDebit: number;
  accountingCredit: number;
  reportingDebit: number;
  reportingCredit: number;
  accountingRate: Prisma.Decimal | string | number;
  reportingRate: Prisma.Decimal | string | number;
}

export interface JournalLineInput {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string | null;
  /**
   * Per-line dimension override. Rare — the voucher-level `dimensions` context is
   * the normal path. Use it where one voucher genuinely spans two axes values, e.g.
   * a transfer between two stores.
   */
  dimensions?: DimensionContext;
  /**
   * Dimension values already known as IDs, bypassing resolution entirely.
   *
   * Exists for ONE caller: `reverseJournal`, which copies the original voucher's
   * coding. A reversal that re-resolved would be coded by today's master data
   * rather than by what the original actually carried, and the two would not net
   * to zero in a P&L by store — which is the entire point of reversing.
   *
   * Takes precedence over `dimensions`. Do not use it to hand-code a posting.
   */
  rawSlots?: Partial<ResolvedSlots>;
  /** See `RawAmounts`. When one line carries it, every line must. */
  rawAmounts?: RawAmounts;
}

export interface PostJournalOptions {
  tenantId: string;
  /** Voucher date. Decides which accounting period is checked. Defaults to now. */
  date?: Date;
  description: string;
  /** What produced this voucher. Mandatory — see the One voucher note above. */
  source: { module: string; id?: string | null };
  lines: JournalLineInput[];
  /**
   * The voucher's transaction currency. Omitted means the ledger's accounting
   * currency, which is what every caller today intends: the line amounts are then
   * transaction, accounting and reporting amounts at once, at rate 1, with no rate
   * lookup at all.
   */
  currency?: { code: string };
  /**
   * What the caller knows about the transaction, for financial dimension coding.
   * Resolution happens here and nowhere else — see dimension.service.ts.
   *
   * Omitting it is legitimate and means "I know nothing to code this by". It is not
   * silently safe, though: if a `DimensionRule` marks an axis REQUIRED for one of
   * the accounts on the voucher, the posting is refused under
   * `require_balanced_posting`, exactly as an unresolved posting profile is.
   */
  dimensions?: DimensionContext;
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
  /**
   * The original voucher's currency header, copied by `reverseJournal` together
   * with `rawAmounts`. Only meaningful in that mode.
   */
  rawHeader?: {
    accountingCurrencyCode: string;
    reportingCurrencyCode: string;
    exchangeRateDate: Date;
    accountingRateTypeId: string | null;
    reportingRateTypeId: string | null;
  };
}

export type CorrectionMethod = 'REVERSE' | 'STORNO';

type Client = Prisma.TransactionClient | typeof db;

interface EffectiveParameters {
  allowClosedPeriod: boolean;
  roundingTolerance: number;
  reportingRoundingTolerance: number;
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
      reporting_rounding_tolerance: true,
      correction_method: true,
    },
  });

  return {
    allowClosedPeriod: row?.allow_posting_to_closed_period ?? false,
    roundingTolerance: row ? Number(row.rounding_tolerance) : 0.02,
    reportingRoundingTolerance: row ? Number(row.reporting_rounding_tolerance) : 0.02,
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
const ONE = new Prisma.Decimal(1);

/**
 * The currency's own rounding rule. A currency the tenant has not activated fails
 * closed, and so does one that does not round to 0.01: every document path in the
 * product computes to two decimals, so a coarser ledger would post amounts its own
 * documents disagree with.
 */
async function roundingRuleFor(
  client: Client,
  tenantId: string,
  code: string,
): Promise<CurrencyRoundingRule> {
  const row = await client.tenantCurrency.findFirst({
    where: { tenant_id: tenantId, currency_code: code, is_active: true },
    select: { rounding_precision: true, rounding_method: true },
  });
  if (!row) {
    throw new AppError(`Currency ${code} is not active for this tenant.`, 422, 'CURRENCY_INACTIVE');
  }
  assertPostablePrecision(code, row.rounding_precision);
  return row;
}

/** Amount translated into a target currency and rounded by that currency's rule. */
function converted(amount: number, rate: ResolvedRate, rule: CurrencyRoundingRule): number {
  if (amount === 0) return 0;
  return roundAmount(translate(amount, rate), rule).toNumber();
}

/** The effective per-unit quote, for audit and inquiry. The amounts stay authoritative. */
function effectiveRate(rate: ResolvedRate): Prisma.Decimal {
  return translate(1, rate).toDecimalPlaces(8);
}

interface NormalisedLine {
  accountId: string;
  /** Accounting amounts — what `debit_amount`/`credit_amount` hold. */
  debit: number;
  credit: number;
  transactionDebit: number;
  transactionCredit: number;
  reportingDebit: number;
  reportingCredit: number;
  accountingRate: Prisma.Decimal;
  reportingRate: Prisma.Decimal;
  description: string | null;
  dimensions?: DimensionContext;
  rawSlots?: Partial<ResolvedSlots>;
}

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

  const rawCount = opts.lines.filter(l => l.rawAmounts).length;
  if (rawCount > 0 && rawCount !== opts.lines.length) {
    throw new AppError(
      `${document} cannot be posted: some lines carry decided amounts and some do not.`,
      500,
      'JOURNAL_RAW_AMOUNTS_PARTIAL',
    );
  }
  const derived = rawCount > 0;

  const params = await effectiveParameters(tenantId, legalEntityId, client);

  const lines: NormalisedLine[] = [];
  // Read only for an ordinary posting: a derived voucher carries its currencies
  // from the original. A tenant without a ledger cannot post at all, which is the
  // point — there is no fallback currency anywhere in this service.
  let ledger: LedgerCurrencies | undefined;
  let transactionCurrency: string;
  let accountingRateTypeId: string | null;
  let reportingRateTypeId: string | null;
  let exchangeRateDate: Date;
  let accountingCurrency: string;
  let reportingCurrency: string;

  if (derived) {
    // ── Derived from another voucher: copy, never re-translate ───────────────
    const header = opts.rawHeader;
    if (!header) {
      throw new AppError(
        `${document} cannot be posted: decided amounts need the original voucher's currency header.`,
        500,
        'JOURNAL_RAW_HEADER_MISSING',
      );
    }
    accountingCurrency = header.accountingCurrencyCode;
    reportingCurrency = header.reportingCurrencyCode;
    accountingRateTypeId = header.accountingRateTypeId;
    reportingRateTypeId = header.reportingRateTypeId;
    exchangeRateDate = header.exchangeRateDate;

    const currencies = new Set(opts.lines.map(l => l.rawAmounts!.transactionCurrencyCode));
    if (currencies.size > 1) {
      throw new AppError(
        `${document} cannot be posted: a voucher carries one transaction currency (found ${[...currencies].join(', ')}).`,
        500,
        'JOURNAL_MULTI_CURRENCY_UNSUPPORTED',
      );
    }
    transactionCurrency = [...currencies][0];

    for (const l of opts.lines) {
      const r = l.rawAmounts!;
      const empty = [r.transactionDebit, r.transactionCredit, r.accountingDebit, r.accountingCredit, r.reportingDebit, r.reportingCredit]
        .every(v => Number(v) === 0);
      if (empty) continue;
      lines.push({
        accountId: l.accountId,
        debit: Number(r.accountingDebit),
        credit: Number(r.accountingCredit),
        transactionDebit: Number(r.transactionDebit),
        transactionCredit: Number(r.transactionCredit),
        reportingDebit: Number(r.reportingDebit),
        reportingCredit: Number(r.reportingCredit),
        accountingRate: new Prisma.Decimal(r.accountingRate),
        reportingRate: new Prisma.Decimal(r.reportingRate),
        description: l.description ?? null,
        dimensions: l.dimensions,
        rawSlots: l.rawSlots,
      });
    }
  } else {
    // ── Ordinary posting ─────────────────────────────────────────────────────
    ledger = await getLedgerCurrencies(tenantId, legalEntityId, client);
    accountingCurrency = ledger.accountingCurrency;
    reportingCurrency = ledger.reportingCurrency;
    transactionCurrency = opts.currency?.code?.trim().toUpperCase() || accountingCurrency;
    exchangeRateDate = date;

    const transactionRule = await roundingRuleFor(client, tenantId, transactionCurrency);

    for (const l of opts.lines) {
      const debit = roundAmount(Number(l.debit ?? 0), transactionRule).toNumber();
      const credit = roundAmount(Number(l.credit ?? 0), transactionRule).toNumber();

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
        // Filled in below, once the rates are known.
        debit, credit,
        transactionDebit: debit,
        transactionCredit: credit,
        reportingDebit: debit,
        reportingCredit: credit,
        accountingRate: ONE,
        reportingRate: ONE,
        description: l.description ?? null,
        dimensions: l.dimensions,
        rawSlots: l.rawSlots,
      });
    }
  }

  if (lines.length === 0) {
    throw new AppError(
      `${document} cannot be posted: every journal line was zero`,
      500,
      'JOURNAL_EMPTY',
    );
  }

  await assertPeriodPostable(tenantId, date, params, document, client);

  /** Appends a balancing line to ROUNDING, or refuses above tolerance. */
  const absorb = async (
    imbalance: number,
    tolerance: number,
    currencyLabel: string,
    code: string,
    apply: (line: NormalisedLine, debit: number, credit: number) => void,
  ) => {
    if (imbalance === 0) return;
    if (Math.abs(imbalance) > tolerance) {
      throw new AppError(
        `${document} cannot be posted: it is out by ${imbalance.toFixed(2)} in the ${currencyLabel} ` +
          `currency, which is beyond the ${tolerance.toFixed(2)} tolerance.`,
        500,
        code,
      );
    }
    // Within tolerance: absorb it into ROUNDING rather than reject. This is what
    // `rounding_tolerance` has promised since migration 001 and what nothing
    // implemented. If ROUNDING is unconfigured we still refuse — silently
    // posting an unbalanced voucher is not an option available to us. The account
    // is resolved ONLY here, so a tenant without a ROUNDING profile can still post
    // everything that balances.
    let roundingAccountId: string;
    try {
      roundingAccountId = await resolvePostingAccount('ROUNDING', { tenantId, legalEntityId, on: date }, client);
    } catch {
      throw new AppError(
        `${document} cannot be posted: it is out by ${imbalance.toFixed(2)} in the ${currencyLabel} ` +
          `currency, which is within the rounding tolerance, but no ROUNDING posting profile is ` +
          `configured to absorb it.`,
        500,
        'ROUNDING_PROFILE_UNRESOLVED',
      );
    }
    const line: NormalisedLine = {
      accountId: roundingAccountId,
      debit: 0, credit: 0,
      transactionDebit: 0, transactionCredit: 0,
      reportingDebit: 0, reportingCredit: 0,
      accountingRate: ONE, reportingRate: ONE,
      description: 'Rounding',
    };
    apply(line, imbalance < 0 ? Math.abs(imbalance) : 0, imbalance > 0 ? imbalance : 0);
    lines.push(line);
    logger.info({ tenantId, document, imbalance, currency: currencyLabel }, 'Rounding difference absorbed into the ROUNDING account');
  };

  if (derived) {
    // A correction is balanced by construction — the original was. Assert it in all
    // three currencies rather than inventing a second rounding line.
    for (const [label, sum] of [
      ['transaction', round2(lines.reduce((s, l) => s + l.transactionDebit - l.transactionCredit, 0))],
      ['accounting', round2(lines.reduce((s, l) => s + l.debit - l.credit, 0))],
      ['reporting', round2(lines.reduce((s, l) => s + l.reportingDebit - l.reportingCredit, 0))],
    ] as const) {
      if (sum !== 0) {
        throw new AppError(
          `${document} cannot be posted: the derived lines are out by ${sum.toFixed(2)} in the ${label} currency.`,
          500,
          'JOURNAL_REVERSAL_IMBALANCE',
        );
      }
    }
  } else {
    // ── Transaction currency ────────────────────────────────────────────────
    const transactionImbalance = round2(lines.reduce((s, l) => s + l.transactionDebit - l.transactionCredit, 0));
    await absorb(transactionImbalance, params.roundingTolerance, 'transaction', 'JOURNAL_UNBALANCED', (line, debit, credit) => {
      line.transactionDebit = debit; line.transactionCredit = credit;
      line.debit = debit; line.credit = credit;
      line.reportingDebit = debit; line.reportingCredit = credit;
    });

    // ── Translate every line from the transaction amount ────────────────────
    // **[OFFICIAL]** each line is translated and rounded, then the lines are summed.
    const accountingIdentity = transactionCurrency === accountingCurrency;
    const reportingIdentity = transactionCurrency === reportingCurrency;
    // **[OFFICIAL]** when the reporting currency IS the accounting currency, D365
    // keeps the two in sync. Translating it a second time would round the same
    // amount twice and could produce a reporting penny line of its own.
    const reportingMirrorsAccounting = reportingCurrency === accountingCurrency;
    const ledgerCurrencies = ledger!; // set on this branch, never on the derived one
    accountingRateTypeId = accountingIdentity ? null : ledgerCurrencies.accountingRateTypeId;
    reportingRateTypeId = reportingIdentity ? null : (reportingMirrorsAccounting ? accountingRateTypeId : ledgerCurrencies.reportingRateTypeId);

    if (!accountingIdentity || !reportingIdentity) {
      const accountingRule = await roundingRuleFor(client, tenantId, accountingCurrency);
      const reportingRule = reportingMirrorsAccounting
        ? accountingRule
        : await roundingRuleFor(client, tenantId, reportingCurrency);

      const accountingRate = accountingIdentity ? null : await resolveRate({
        tenantId, rateTypeId: ledgerCurrencies.accountingRateTypeId,
        from: transactionCurrency, to: accountingCurrency, date: exchangeRateDate, client,
      });
      const reportingRate = reportingIdentity || reportingMirrorsAccounting ? null : await resolveRate({
        tenantId, rateTypeId: ledgerCurrencies.reportingRateTypeId,
        from: transactionCurrency, to: reportingCurrency, date: exchangeRateDate, client,
      });

      for (const line of lines) {
        if (accountingRate) {
          line.debit = converted(line.transactionDebit, accountingRate, accountingRule);
          line.credit = converted(line.transactionCredit, accountingRate, accountingRule);
          line.accountingRate = effectiveRate(accountingRate);
        }
        if (reportingRate) {
          line.reportingDebit = converted(line.transactionDebit, reportingRate, reportingRule);
          line.reportingCredit = converted(line.transactionCredit, reportingRate, reportingRule);
          line.reportingRate = effectiveRate(reportingRate);
        } else if (reportingMirrorsAccounting) {
          // Copy, never re-round: the reporting currency is the accounting one.
          line.reportingDebit = line.debit;
          line.reportingCredit = line.credit;
          line.reportingRate = line.accountingRate;
        }
      }

      // ── Penny differences, one per currency, each with its own tolerance ──
      const accountingImbalance = round2(lines.reduce((s, l) => s + l.debit - l.credit, 0));
      await absorb(accountingImbalance, params.roundingTolerance, 'accounting', 'JOURNAL_UNBALANCED_ACCOUNTING', (line, debit, credit) => {
        line.debit = debit; line.credit = credit;
        if (reportingMirrorsAccounting) { line.reportingDebit = debit; line.reportingCredit = credit; }
      });
      if (!reportingMirrorsAccounting) {
        const reportingImbalance = round2(lines.reduce((s, l) => s + l.reportingDebit - l.reportingCredit, 0));
        await absorb(reportingImbalance, params.reportingRoundingTolerance, 'reporting', 'JOURNAL_UNBALANCED_REPORTING', (line, debit, credit) => {
          line.reportingDebit = debit; line.reportingCredit = credit;
        });
      }
    }
  }

  // ── Financial dimensions ─────────────────────────────────────────────────
  // After balancing, so the ROUNDING line is coded too — an uncoded rounding line
  // would sit in the "(unassigned)" bucket of every P&L by store for no reason.
  //
  // The voucher-level context is resolved once. A line that carries its own context
  // is resolved separately, which is what makes a two-store transfer expressible.
  const voucherSlots: ResolvedSlots = opts.dimensions
    ? await resolveDimensions(tenantId, legalEntityId, opts.dimensions, client)
    : { ...EMPTY_SLOTS };

  const coded: Array<NormalisedLine & ResolvedSlots> = [];
  for (const l of lines) {
    if (l.rawSlots) {
      coded.push({ ...l, ...EMPTY_SLOTS, ...l.rawSlots });
      continue;
    }
    const slots = l.dimensions
      ? await resolveDimensions(tenantId, legalEntityId, l.dimensions, client)
      : voucherSlots;
    coded.push({ ...l, ...slots });
  }

  await assertRequiredDimensions(tenantId, legalEntityId, document, coded, client);

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
      accounting_currency_code: accountingCurrency,
      reporting_currency_code: reportingCurrency,
      exchange_rate_date: exchangeRateDate,
      accounting_rate_type_id: accountingRateTypeId,
      reporting_rate_type_id: reportingRateTypeId,
      lines: {
        create: coded.map(l => ({
          account_id: l.accountId,
          debit_amount: l.debit,
          credit_amount: l.credit,
          transaction_currency_code: transactionCurrency,
          transaction_debit_amount: l.transactionDebit,
          transaction_credit_amount: l.transactionCredit,
          reporting_debit_amount: l.reportingDebit,
          reporting_credit_amount: l.reportingCredit,
          accounting_exchange_rate: l.accountingRate,
          reporting_exchange_rate: l.reportingRate,
          description: l.description,
          // Only STORNO produces lines that need distinguishing — a negative amount
          // in the original column is otherwise indistinguishable from a genuinely
          // negative posting. Under REVERSE the flag is informational.
          is_correction: !!corrects,
          dimension_1_id: l.dimension_1_id,
          dimension_2_id: l.dimension_2_id,
          dimension_3_id: l.dimension_3_id,
          dimension_4_id: l.dimension_4_id,
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
 * ── Two deliberate deviations ──────────────────────────────────────────────
 * BC reuses the original posting date. We do NOT: if the original period is closed,
 * backdating would post into a closed period, which is precisely what the rest of
 * this service exists to prevent, and in most jurisdictions a closed period has
 * already been declared. The correction posts on `date` (default today) and the
 * original date stays reachable through `corrects_entry_id`, which is where the
 * audit trail belongs. See docs/architecture/CORRECTIONS.md §4.2.
 *
 * The EXCHANGE-RATE date, however, is the original's, and the amounts and rates are
 * copied rather than re-translated. A rate move between posting and reversal would
 * otherwise leave a residue in the accounting and reporting currencies that never
 * nets to zero — the FX analogue of re-resolving dimensions.
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
  const storno = params.correctionMethod === 'STORNO';

  const lines: JournalLineInput[] = original.lines.map(l => {
    // The original's dimension coding is COPIED, never re-resolved. Re-resolving
    // would code the reversal by today's master data rather than by what the
    // original carried, so the pair would not net to zero in a P&L by store — and
    // netting to zero is the whole purpose of a reversal.
    const rawSlots = {
      dimension_1_id: l.dimension_1_id,
      dimension_2_id: l.dimension_2_id,
      dimension_3_id: l.dimension_3_id,
      dimension_4_id: l.dimension_4_id,
    };

    const debit = Number(l.debit_amount);
    const credit = Number(l.credit_amount);
    const txnDebit = Number(l.transaction_debit_amount);
    const txnCredit = Number(l.transaction_credit_amount);
    const repDebit = Number(l.reporting_debit_amount);
    const repCredit = Number(l.reporting_credit_amount);

    // STORNO: same columns, sign flipped — the original is zeroed out and turnover
    // stays truthful. REVERSE: mirrored — balance is right, but both turnovers
    // carry the round trip. Rates are never negated, in either method.
    const rawAmounts: RawAmounts = {
      transactionCurrencyCode: l.transaction_currency_code,
      transactionDebit: storno ? -txnDebit : txnCredit,
      transactionCredit: storno ? -txnCredit : txnDebit,
      accountingDebit: storno ? -debit : credit,
      accountingCredit: storno ? -credit : debit,
      reportingDebit: storno ? -repDebit : repCredit,
      reportingCredit: storno ? -repCredit : repDebit,
      accountingRate: l.accounting_exchange_rate,
      reportingRate: l.reporting_exchange_rate,
    };

    return { accountId: l.account_id, description: l.description, rawSlots, rawAmounts };
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
    rawHeader: {
      accountingCurrencyCode: original.accounting_currency_code,
      reportingCurrencyCode: original.reporting_currency_code,
      exchangeRateDate: original.exchange_rate_date,
      accountingRateTypeId: original.accounting_rate_type_id,
      reportingRateTypeId: original.reporting_rate_type_id,
    },
  });
}

/** Re-exported for callers that need the ledger's currencies alongside a posting. */
export type { LedgerCurrencies };
