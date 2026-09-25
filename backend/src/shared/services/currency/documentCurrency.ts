import { Prisma } from '@prisma/client';
import { db } from '../../../infrastructure/database/client';
import { AppError } from '../../errors/AppError';
import { getLedgerCurrencies, type LedgerCurrencies } from './ledgerCurrency.service';

/**
 * Document-currency rules for the purchase-to-pay path.
 *
 * Replaces the literal `'BOB'` guards. The rule is now parametric: a document is
 * supported when its currency is the ledger's accounting currency — BOB for a
 * Bolivian tenant, TRY for a Turkish one — and refused otherwise, before any
 * stock, cost layer or voucher is written. Foreign-currency documents arrive
 * with WORK-026; until then nothing values them at face value.
 */

type Client = Prisma.TransactionClient | typeof db;

export async function assertDocumentCurrencySupported(
  tenantId: string,
  documentCurrency: string,
  options: { errorCode: string; capability: string; legalEntityId?: string | null; client?: Client },
): Promise<LedgerCurrencies> {
  const ledger = await getLedgerCurrencies(tenantId, options.legalEntityId ?? null, options.client ?? db);
  if (documentCurrency !== ledger.accountingCurrency) {
    throw new AppError(
      `${options.capability} currently support documents in the ledger's accounting currency ` +
        `(${ledger.accountingCurrency}) only. Found ${documentCurrency}; no exchange rate was inferred. ` +
        'Foreign-currency documents arrive with WORK-026.',
      409,
      options.errorCode,
    );
  }
  return ledger;
}

/**
 * The currency for a new document: the one requested, which must be active for
 * the tenant, or the ledger's accounting currency when none is given.
 */
export async function resolveDocumentCurrency(
  tenantId: string,
  requested: string | null | undefined,
  client: Client = db,
): Promise<string> {
  const code = requested?.trim().toUpperCase() || (await getLedgerCurrencies(tenantId, null, client)).accountingCurrency;
  const active = await client.tenantCurrency.findFirst({
    where: { tenant_id: tenantId, currency_code: code, is_active: true },
    select: { id: true },
  });
  if (!active) throw new AppError(`Currency ${code} is not active for this tenant.`, 422, 'CURRENCY_INACTIVE');
  return code;
}
