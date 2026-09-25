import { Prisma } from '@prisma/client';
import { db } from '../../../infrastructure/database/client';
import { AppError } from '../../errors/AppError';
import { precisionForMinorUnit, assertPostablePrecision } from './currencyRounding';

/**
 * The ledger's currencies — the single source every posting path reads.
 *
 * **[OFFICIAL]** each legal entity's ledger has an accounting currency, a
 * reporting currency and a rate type for each; transactions are translated from
 * the transaction currency to both, and neither currency can be added or changed
 * once anything has posted:
 *   learn.microsoft.com/dynamics365/finance/general-ledger/configure-ledger
 *   learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/add-change-accounting-reporting-currency
 *
 * There is deliberately no fallback currency. A tenant without a ledger row is
 * refused, not defaulted to a country: that default is the hard-coding WORK-024
 * removes. Since WORK-025 this is the only place the currency lives — the mirror
 * on `Tenant` is gone, so two sources can no longer disagree.
 */

type Client = Prisma.TransactionClient | typeof db;

export const EXCHANGE_RATE_DATE_BASES = ['POSTING_DATE', 'DOCUMENT_DATE'] as const;
export type ExchangeRateDateBasis = typeof EXCHANGE_RATE_DATE_BASES[number];

export interface LedgerCurrencies {
  legalEntityId: string | null;
  accountingCurrency: string;
  reportingCurrency: string;
  accountingRateTypeId: string;
  /** Resolved: the reporting type, or the accounting type when none is set. */
  reportingRateTypeId: string;
  exchangeRateDateBasis: ExchangeRateDateBasis;
}

const LEDGER_SELECT = {
  legal_entity_id: true,
  accounting_currency_code: true,
  reporting_currency_code: true,
  accounting_rate_type_id: true,
  reporting_rate_type_id: true,
  exchange_rate_date_basis: true,
} as const;

/**
 * The ledger for a legal entity, falling back to the tenant ledger
 * (`legal_entity_id IS NULL`) — today every tenant has exactly that one.
 */
export async function getLedgerCurrencies(
  tenantId: string,
  legalEntityId: string | null = null,
  client: Client = db,
): Promise<LedgerCurrencies> {
  const row =
    (legalEntityId
      ? await client.financeParameters.findFirst({ where: { tenant_id: tenantId, legal_entity_id: legalEntityId }, select: LEDGER_SELECT })
      : null) ??
    (await client.financeParameters.findFirst({ where: { tenant_id: tenantId, legal_entity_id: null }, select: LEDGER_SELECT }));

  if (!row) {
    throw new AppError(
      'The ledger currencies are not configured for this tenant, so nothing can be valued or posted. ' +
        'An administrator sets them under Setup → Finance → Currencies.',
      422,
      'LEDGER_CURRENCY_NOT_CONFIGURED',
    );
  }

  return {
    legalEntityId: row.legal_entity_id,
    accountingCurrency: row.accounting_currency_code,
    reportingCurrency: row.reporting_currency_code,
    accountingRateTypeId: row.accounting_rate_type_id,
    reportingRateTypeId: row.reporting_rate_type_id ?? row.accounting_rate_type_id,
    exchangeRateDateBasis: row.exchange_rate_date_basis as ExchangeRateDateBasis,
  };
}

/**
 * Has anything already been valued in the ledger's currencies? A posted voucher,
 * but also a FIFO cost layer (receipts can create layers without a voucher when
 * receipt posting is off) or an AP open item. Any of them locks the currencies.
 */
export async function hasLedgerActivity(tenantId: string, client: Client = db): Promise<boolean> {
  if ((await client.journalEntry.count({ where: { tenant_id: tenantId, status: 'POSTED' } })) > 0) return true;
  if ((await client.inventoryCostLayer.count({ where: { tenant_id: tenantId } })) > 0) return true;
  return (await client.vendorOpenTransaction.count({ where: { tenant_id: tenantId } })) > 0;
}

export interface LedgerCurrencyInput {
  accounting_currency_code: string;
  reporting_currency_code: string;
  accounting_rate_type_id: string;
  reporting_rate_type_id?: string | null;
  exchange_rate_date_basis?: ExchangeRateDateBasis;
}

async function assertActiveTenantCurrency(client: Client, tenantId: string, code: string) {
  const currency = await client.tenantCurrency.findFirst({
    where: { tenant_id: tenantId, currency_code: code },
    select: { is_active: true, rounding_precision: true },
  });
  if (!currency || !currency.is_active) {
    throw new AppError(`Currency ${code} is not active for this tenant.`, 422, 'CURRENCY_INACTIVE');
  }
  // Refused here rather than at the first posting: a ledger that rounds coarser
  // than the documents it posts would fail every document instead of this one call.
  assertPostablePrecision(code, currency.rounding_precision);
}

async function assertActiveRateType(client: Client, tenantId: string, id: string) {
  const type = await client.exchangeRateType.findFirst({
    where: { id, tenant_id: tenantId },
    select: { is_active: true },
  });
  if (!type || !type.is_active) {
    throw new AppError('The exchange rate type is not an active rate type of this tenant.', 422, 'RATE_TYPE_NOT_FOUND');
  }
}

/**
 * Create a tenant's ledger on first provisioning: activate the accounting
 * currency, create the accounting rate type, and write the tenant-level
 * FinanceParameters row with reporting = accounting (WORK-024a). Idempotent: an
 * existing ledger is returned untouched, never re-pointed.
 */
export async function bootstrapTenantLedger(
  client: Prisma.TransactionClient,
  input: {
    tenantId: string;
    accountingCurrency: string;
    rateTypeCode: string;
    rateTypeName: string;
    requireBalancedPosting?: boolean;
  },
) {
  const currency = await client.currency.findUnique({ where: { code: input.accountingCurrency } });
  if (!currency) {
    throw new AppError(`${input.accountingCurrency} is not an ISO 4217 currency code.`, 422, 'CURRENCY_UNKNOWN');
  }
  // Amounts are stored and computed with two decimals throughout, so a ledger
  // currency must quote in two as well: neither three (unstorable) nor none
  // (documents would compute cents the ledger then rounds away).
  if (currency.minor_unit !== 2) {
    throw new AppError(
      `${currency.code} has ${currency.minor_unit} decimals; a ledger currency must have two.`,
      422,
      'CURRENCY_PRECISION_UNSUPPORTED',
    );
  }

  await client.tenantCurrency.upsert({
    where: { tenant_id_currency_code: { tenant_id: input.tenantId, currency_code: currency.code } },
    update: {},
    create: {
      tenant_id: input.tenantId,
      currency_code: currency.code,
      rounding_precision: precisionForMinorUnit(currency.minor_unit),
    },
  });
  const rateType = await client.exchangeRateType.upsert({
    where: { tenant_id_code: { tenant_id: input.tenantId, code: input.rateTypeCode } },
    update: {},
    create: { tenant_id: input.tenantId, code: input.rateTypeCode, name: input.rateTypeName },
  });

  const existing = await client.financeParameters.findFirst({
    where: { tenant_id: input.tenantId, legal_entity_id: null },
  });
  if (existing) return existing;

  return client.financeParameters.create({
    data: {
      tenant_id: input.tenantId,
      legal_entity_id: null,
      accounting_currency_code: currency.code,
      reporting_currency_code: currency.code,
      accounting_rate_type_id: rateType.id,
      ...(input.requireBalancedPosting !== undefined ? { require_balanced_posting: input.requireBalancedPosting } : {}),
    },
  });
}

/**
 * Set the tenant ledger's currencies. Serialised per tenant by an advisory lock,
 * so the "has anything posted?" check and the write cannot interleave with a
 * second setup request.
 */
export async function setLedgerCurrencies(tenantId: string, input: LedgerCurrencyInput): Promise<LedgerCurrencies> {
  const basis = input.exchange_rate_date_basis ?? 'POSTING_DATE';
  if (basis !== 'POSTING_DATE') {
    throw new AppError(
      'Only the posting date is supported as the exchange-rate date today.',
      422,
      'EXCHANGE_RATE_DATE_BASIS_UNSUPPORTED',
    );
  }
  // WORK-024a: vouchers do not yet carry reporting amounts (WORK-024b). Allowing a
  // different reporting currency now would post history that can never be
  // translated, because the reporting currency cannot be changed afterwards.
  if (input.reporting_currency_code !== input.accounting_currency_code) {
    throw new AppError(
      'A reporting currency different from the accounting currency is not supported yet.',
      422,
      'REPORTING_CURRENCY_UNSUPPORTED',
    );
  }

  return db.$transaction(async (tx) => {
    // Serialises concurrent setup requests. Posting paths do not take this lock,
    // so a first posting racing a currency change is theoretically possible; that
    // is accepted for what is a one-time administrator action at implementation.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ledger-currency:${tenantId}`}))`;

    await assertActiveTenantCurrency(tx, tenantId, input.accounting_currency_code);
    await assertActiveTenantCurrency(tx, tenantId, input.reporting_currency_code);
    await assertActiveRateType(tx, tenantId, input.accounting_rate_type_id);
    if (input.reporting_rate_type_id) await assertActiveRateType(tx, tenantId, input.reporting_rate_type_id);

    const existing = await tx.financeParameters.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: null },
      select: { id: true, accounting_currency_code: true, reporting_currency_code: true },
    });

    const currencyChanges =
      existing &&
      (existing.accounting_currency_code !== input.accounting_currency_code ||
        existing.reporting_currency_code !== input.reporting_currency_code);
    if (currencyChanges && (await hasLedgerActivity(tenantId, tx))) {
      throw new AppError(
        `The ledger currencies are ${existing.accounting_currency_code} (accounting) and ` +
          `${existing.reporting_currency_code} (reporting) and cannot be changed once anything has been ` +
          'valued in them (posted vouchers, inventory cost layers or payables).',
        409,
        'CURRENCY_LOCKED',
      );
    }

    const data = {
      accounting_currency_code: input.accounting_currency_code,
      reporting_currency_code: input.reporting_currency_code,
      accounting_rate_type_id: input.accounting_rate_type_id,
      reporting_rate_type_id: input.reporting_rate_type_id ?? null,
      exchange_rate_date_basis: basis,
    };
    if (existing) {
      await tx.financeParameters.update({ where: { id: existing.id }, data });
    } else {
      await tx.financeParameters.create({ data: { tenant_id: tenantId, legal_entity_id: null, ...data } });
    }
    return getLedgerCurrencies(tenantId, null, tx);
  });
}
