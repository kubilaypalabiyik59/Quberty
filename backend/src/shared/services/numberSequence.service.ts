import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../errors/AppError';

/**
 * Document numbering.
 *
 * Fixes D-5: `entry_number` is globally `@unique`, but sales and purchase generate
 * it from `count() + 1`, so two concurrent postings compute the same number. Two
 * incompatible series already coexist in the live database — `JE-2026-00077` from
 * sales/purchase and `JE-000007` from POS.
 *
 * Design: docs/architecture/PARAMETERS_AND_CONFIG.md §5
 *
 * ── Continuous vs non-continuous ────────────────────────────────────────────
 * D365 makes this a per-sequence property, and Microsoft is explicit that gapless
 * numbering costs row locking:
 *
 *   "Continuous number sequences don't allow gaps between numbers. […] every
 *    transaction that needs a new number demands interaction with the database.
 *    The frequent interactions with the database lead to frequent locking […]"
 *   — learn.microsoft.com/dynamics365/guidance/techtalks/
 *     finance-operations-continuous-number-sequence-performance-improvements
 *
 * So the two modes are implemented differently on purpose:
 *
 *   continuous = false → allocated on its own connection and committed
 *     immediately. A caller that rolls back leaves a gap. No contention.
 *
 *   continuous = true  → allocated on the CALLER'S transaction. The row lock is
 *     held until the caller commits, so a rollback returns the number and the
 *     series stays gapless. Serialises concurrent allocation of that one series.
 *     Callers MUST pass `tx`; doing otherwise would silently give up gaplessness,
 *     so it throws instead.
 *
 * Whether the Bolivian factura series legally requires gapless numbering is still
 * open (HANDOVER.md §7). That question now selects a flag rather than blocking the
 * design.
 */

export type SequenceReference =
  | 'FACTURA'
  | 'CREDIT_NOTE'
  | 'JOURNAL_VOUCHER'
  | 'SALES_ORDER'
  | 'PURCHASE_ORDER'
  | 'INVENTORY_ADJUSTMENT'
  | 'TRANSFER'
  | 'PRODUCT_RECEIPT'
  | 'VENDOR_INVOICE'
  | 'PAYMENT'
  // ── Process front ends (migration 005) ──────────────────────────────────
  // None of these is legally numbered anywhere we sell, so all five are
  // non-continuous: a gap in a quotation series costs nothing, whereas making
  // them continuous would hold a row lock for the length of the caller's
  // transaction. Compare FACTURA, where the question is still open.
  | 'LEAD'
  | 'OPPORTUNITY'
  | 'SALES_QUOTATION'
  | 'PURCHASE_REQUISITION'
  | 'RFQ';

interface AllocateOptions {
  tenantId: string;
  reference: SequenceReference;
  legalEntityId?: string | null;
  /** Required when the sequence is continuous. */
  tx?: Prisma.TransactionClient;
}

interface SequenceRow {
  id: string;
  format: string;
  continuous: boolean;
  scope: string;
  next_number: number;
  current_year: number | null;
  is_active: boolean;
}

/**
 * Render a sequence format.
 *   {YYYY}   → four-digit year
 *   {#####}  → the counter, zero-padded to the number of '#' characters
 * An unknown token is left as-is rather than silently dropped — a wrong document
 * number is worse than an obviously broken one.
 */
export function formatNumber(format: string, counter: number, year: number): string {
  return format
    .replace(/\{Y{4}\}/g, String(year))
    .replace(/\{(#+)\}/g, (_m, hashes: string) => String(counter).padStart(hashes.length, '0'));
}

/**
 * Allocate the next number for a reference.
 *
 * The counter increment is a single atomic `UPDATE … RETURNING`, the same
 * technique the existing `order_counters` helper uses. Year rollover is handled in
 * the same statement so it cannot race either.
 */
export async function allocateNumber(opts: AllocateOptions): Promise<string> {
  const { tenantId, reference, legalEntityId = null, tx } = opts;

  const seq = await (tx ?? db).numberSequence.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: legalEntityId, reference },
    select: {
      id: true, format: true, continuous: true, scope: true,
      next_number: true, current_year: true, is_active: true,
    },
  }) as SequenceRow | null;

  if (!seq) {
    throw new AppError(
      `No number sequence configured for '${reference}'. Configure it under Administration → Number sequences.`,
      500,
      'NUMBER_SEQUENCE_MISSING',
    );
  }
  if (!seq.is_active) {
    throw new AppError(`Number sequence '${reference}' is inactive.`, 500, 'NUMBER_SEQUENCE_INACTIVE');
  }
  if (seq.continuous && !tx) {
    throw new AppError(
      `Number sequence '${reference}' is continuous (gapless) and must be allocated inside a ` +
        `transaction, otherwise a rollback would leave a gap. Pass the transaction client.`,
      500,
      'NUMBER_SEQUENCE_REQUIRES_TX',
    );
  }

  // Continuous → allocate on the caller's transaction so the row lock is held
  // until they commit. Non-continuous → allocate on the pooled client, which
  // commits immediately and holds no lock.
  const client = seq.continuous ? tx! : db;
  const year = new Date().getFullYear();
  const resetsYearly = seq.scope === 'FISCAL_YEAR';

  const rows = await client.$queryRaw<{ allocated: number; year_used: number }[]>`
    UPDATE number_sequences
       SET next_number = CASE
             WHEN ${resetsYearly} AND (current_year IS DISTINCT FROM ${year}) THEN 2
             ELSE next_number + 1
           END,
           current_year = CASE WHEN ${resetsYearly} THEN ${year} ELSE current_year END,
           updated_at   = NOW()
     WHERE id = ${seq.id}::uuid
    RETURNING next_number - 1 AS allocated, ${year} AS year_used
  `;
  // RETURNING sees the NEW row, so `next_number - 1` is the number just handed
  // out in both branches: normal (new = old + 1 → old) and yearly reset
  // (new = 2 → 1).

  if (rows.length === 0) {
    throw new AppError(`Number sequence '${reference}' disappeared during allocation.`, 500);
  }

  return formatNumber(seq.format, Number(rows[0].allocated), Number(rows[0].year_used));
}

/**
 * Convenience wrapper for journal vouchers, the case D-5 actually broke.
 * Non-continuous by default: a GL voucher series has no legal gaplessness
 * requirement in Bolivia that we have verified, and making it continuous would
 * serialise every posting in the system.
 */
export function nextJournalVoucher(
  tenantId: string,
  tx?: Prisma.TransactionClient,
  legalEntityId: string | null = null,
): Promise<string> {
  return allocateNumber({ tenantId, reference: 'JOURNAL_VOUCHER', legalEntityId, tx });
}
