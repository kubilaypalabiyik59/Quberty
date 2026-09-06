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
 *
 * ── Automatic vs manual ─────────────────────────────────────────────────────
 * A tenant working from pre-printed or authority-issued invoice stock types the
 * number off the paper; a tenant on a generated series must not be able to. D365
 * makes this a property of the sequence rather than of a module parameter:
 *
 *   "On the General FastTab, specify whether the number sequence is manual, and
 *    continuous or non-continuous."
 *   — learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/
 *     organization-administration/tasks/set-up-number-sequences-individual-basis
 *
 * Which is why `manual` lives on the row and not in SalesParameters: it is what
 * lets FACTURA be manual while CREDIT_NOTE stays automatic, per legal entity.
 *
 * A manual sequence does not touch its counter. Uniqueness falls to the
 * document's own composite unique constraint, the only check that is atomic
 * against a concurrent insert.
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
  /**
   * The number the user typed. Required when the sequence is `manual`, and
   * REJECTED when it is not — a caller that passes one to an automatic series is
   * trying to choose its own legal number, and silently ignoring it would be
   * worse than failing.
   */
  manualNumber?: string | null;
}

interface SequenceRow {
  id: string;
  format: string;
  continuous: boolean;
  manual: boolean;
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
  const { tenantId, reference, legalEntityId = null, tx, manualNumber = null } = opts;

  const seq = await (tx ?? db).numberSequence.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: legalEntityId, reference },
    select: {
      id: true, format: true, continuous: true, manual: true, scope: true,
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

  // ── Manual ────────────────────────────────────────────────────────────────
  // The user owns the number, so the counter is not touched at all. Uniqueness is
  // left to the document's own `@@unique([tenant_id, <number>])` constraint,
  // which is the only check that is actually atomic against a concurrent insert;
  // a SELECT here would just be a race with a friendlier message.
  //
  // Deliberately NOT done: advancing `next_number` past a manually entered
  // number. It would have to parse the counter back out of a rendered format,
  // and it would guess at an administrator's intent. Setup → Number sequences
  // shows the highest number already issued so the decision is made with the
  // fact visible. See D365's separate "To a higher number" / "To a lower number"
  // options, which are likewise explicit rather than inferred.
  if (seq.manual) {
    const supplied = manualNumber?.trim();
    if (!supplied) {
      throw new AppError(
        `Number sequence '${reference}' is set to manual, so the document number must be supplied. ` +
          `Enter it on the document, or switch the sequence to automatic under Setup → Number sequences.`,
        400,
        'NUMBER_SEQUENCE_MANUAL_REQUIRED',
      );
    }
    return supplied;
  }
  if (manualNumber != null && manualNumber !== '') {
    throw new AppError(
      `Number sequence '${reference}' generates its own numbers, so one cannot be supplied. ` +
        `Switch it to manual under Setup → Number sequences first.`,
      400,
      'NUMBER_SEQUENCE_NOT_MANUAL',
    );
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

/**
 * The legal invoice series.
 *
 * This replaces three hand-written copies of the same `factura_counters` raw SQL
 * — in sales, finance and POS — which disagreed about how to seed a tenant whose
 * counter row did not exist yet (POS started at 1 regardless of what had been
 * issued) and which all allocated BEFORE opening the transaction that writes the
 * factura, so a rollback burned a number. See migration 023.
 *
 * `tx` is not optional here the way it is on a journal voucher. The FACTURA
 * sequence ships continuous, and a continuous series allocated outside the
 * caller's transaction is not gapless at all — `allocateNumber` throws rather
 * than let that pass silently, and requiring the argument turns that runtime
 * error into a compile-time one.
 */
export function nextFacturaNumber(
  tenantId: string,
  tx: Prisma.TransactionClient,
  opts: { manualNumber?: string | null; legalEntityId?: string | null } = {},
): Promise<string> {
  return allocateNumber({
    tenantId,
    reference: 'FACTURA',
    legalEntityId: opts.legalEntityId ?? null,
    tx,
    manualNumber: opts.manualNumber ?? null,
  });
}
