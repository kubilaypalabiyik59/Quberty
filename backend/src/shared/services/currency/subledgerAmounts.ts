import { Prisma } from '@prisma/client';
import { db } from '../../../infrastructure/database/client';
import { getLedgerCurrencies } from './ledgerCurrency.service';
import { resolveRate, translate } from './exchangeRate.service';
import { roundAmount } from './currencyRounding';
import { AppError } from '../../errors/AppError';

/**
 * The accounting and reporting basis of one subledger row.
 *
 * Accounts payable stores each open item and settlement in its document currency
 * plus the ledger's currencies, exactly as the voucher does — that is what
 * WORK-027 revalues and what WORK-026 computes realized FX against. Before
 * WORK-024 every writer hard-coded `exchange_rate: 1` and
 * `amount_functional = amount`, which was true only because a non-accounting
 * currency could not reach those paths; this function makes the same statement
 * from the ledger instead of from a literal.
 *
 * **A document row is measured at its own posting date; a settlement at the
 * settlement date** (Kubi, 2026-09-12). The gap between an open item's rate and
 * the rate on the day it is settled is exactly the realized exchange difference
 * WORK-026 posts, so the settlement must be free to differ — carrying the open
 * item's rate would hide the gain or loss instead of recording it. A row derived
 * from another row (a reversal) still copies, through `copySubledgerAmounts`,
 * because a reversal must net to zero.
 *
 * The document guard (`assertDocumentCurrencySupported`) has already proved the
 * document is in the accounting currency, so today every result is an identity.
 */

type Client = Prisma.TransactionClient | typeof db;

export interface SubledgerAmounts {
  /** Document currency → accounting currency, the effective per-unit quote. */
  exchange_rate: Prisma.Decimal;
  amount_functional: Prisma.Decimal;
  /** Document currency → reporting currency. */
  exchange_rate_reporting: Prisma.Decimal;
  amount_reporting: Prisma.Decimal;
}

async function roundingRuleFor(client: Client, tenantId: string, code: string) {
  const row = await client.tenantCurrency.findFirst({
    where: { tenant_id: tenantId, currency_code: code, is_active: true },
    select: { rounding_precision: true, rounding_method: true },
  });
  if (!row) throw new AppError(`Currency ${code} is not active for this tenant.`, 422, 'CURRENCY_INACTIVE');
  return row;
}

export async function resolveSubledgerAmounts(input: {
  tenantId: string;
  legalEntityId?: string | null;
  /** The document's own currency. */
  currency: string;
  amount: Prisma.Decimal | number | string;
  /** The date the rates are taken on — the row's posting date. */
  date: Date;
  client?: Client;
}): Promise<SubledgerAmounts> {
  const client = input.client ?? db;
  const amount = new Prisma.Decimal(input.amount);
  const ledger = await getLedgerCurrencies(input.tenantId, input.legalEntityId ?? null, client);

  const one = new Prisma.Decimal(1);
  const accountingIdentity = input.currency === ledger.accountingCurrency;
  const reportingIdentity = input.currency === ledger.reportingCurrency;

  if (accountingIdentity && reportingIdentity) {
    return {
      exchange_rate: one,
      amount_functional: amount,
      exchange_rate_reporting: one,
      amount_reporting: amount,
    };
  }

  const accountingRule = await roundingRuleFor(client, input.tenantId, ledger.accountingCurrency);
  const accounting = accountingIdentity ? null : await resolveRate({
    tenantId: input.tenantId, rateTypeId: ledger.accountingRateTypeId,
    from: input.currency, to: ledger.accountingCurrency, date: input.date, client,
  });
  const reporting = reportingIdentity ? null : await resolveRate({
    tenantId: input.tenantId, rateTypeId: ledger.reportingRateTypeId,
    from: input.currency, to: ledger.reportingCurrency, date: input.date, client,
  });
  const reportingRule = ledger.reportingCurrency === ledger.accountingCurrency
    ? accountingRule
    : await roundingRuleFor(client, input.tenantId, ledger.reportingCurrency);

  const functional = accounting ? roundAmount(translate(amount, accounting), accountingRule) : amount;
  return {
    exchange_rate: accounting ? translate(1, accounting).toDecimalPlaces(8) : one,
    amount_functional: functional,
    exchange_rate_reporting: reporting ? translate(1, reporting).toDecimalPlaces(8) : (accounting ? translate(1, accounting).toDecimalPlaces(8) : one),
    amount_reporting: reporting ? roundAmount(translate(amount, reporting), reportingRule) : functional,
  };
}

/**
 * The subledger basis of a row derived from another one — a reversal, or a
 * settlement of an existing open item. Copies rather than re-translating, for the
 * same reason `reverseJournal` copies the voucher's amounts.
 */
export function copySubledgerAmounts(source: {
  exchange_rate: Prisma.Decimal;
  amount_functional: Prisma.Decimal;
  exchange_rate_reporting: Prisma.Decimal;
  amount_reporting: Prisma.Decimal;
}): SubledgerAmounts {
  return {
    exchange_rate: source.exchange_rate,
    amount_functional: source.amount_functional,
    exchange_rate_reporting: source.exchange_rate_reporting,
    amount_reporting: source.amount_reporting,
  };
}
