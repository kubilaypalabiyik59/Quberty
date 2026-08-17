/**
 * The one place that decides an inventory transaction's status.
 *
 * **[OFFICIAL]** an inventory transaction carries a status on one of two ladders,
 * never both:
 * learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting-profiles
 *
 *   receipt: ORDERED → REGISTERED → RECEIVED → PURCHASED
 *   issue:   ON_ORDER → RESERVED_ORDERED → RESERVED_PHYSICAL → PICKED → DEDUCTED → SOLD
 *
 * RECEIVED and DEDUCTED are the **physical** updates — goods moved. PURCHASED and
 * SOLD are the **financial** ones — cost reached the ledger. They are different
 * events on different dates, which is the whole reason the subledger needs both a
 * status and two dates.
 *
 * Every writer in this codebase today records a movement that has ALREADY
 * happened, so `physicalStatusFor` is what they all want. The earlier rungs
 * (ORDERED, ON_ORDER, RESERVED_*, PICKED) exist in the type because the warehouse
 * work about to be built needs them — PICKED especially: **[OFFICIAL]** "the
 * inventory has been picked from the warehouse … still physically in the warehouse,
 * hasn't been removed, but isn't available for other orders". Nothing writes them
 * yet, and this comment is the record of that.
 *
 * Centralised for the same reason `postJournal` is: a mapping repeated at eleven
 * call sites diverges, and a divergent subledger status is invisible until a
 * report is wrong.
 */

export type ReceiptStatus = 'ORDERED' | 'REGISTERED' | 'RECEIVED' | 'PURCHASED';
export type IssueStatus =
  | 'ON_ORDER'
  | 'RESERVED_ORDERED'
  | 'RESERVED_PHYSICAL'
  | 'PICKED'
  | 'DEDUCTED'
  | 'SOLD';

export interface TransactionStatusFields {
  receipt_status: ReceiptStatus | null;
  issue_status: IssueStatus | null;
  physical_date: Date | null;
  financial_date: Date | null;
}

/** Transaction types that put goods INTO stock. */
const RECEIPT_TYPES = new Set([
  'PURCHASE_RECEIPT',
  'INBOUND',
  'RETURN',       // customer return coming back into stock
  'VOID_RETURN',  // a voided POS sale putting goods back
  'TRANSFER_IN',
]);

/** Transaction types that take goods OUT of stock. */
const ISSUE_TYPES = new Set([
  'OUTBOUND',
  'TRANSFER_OUT',
]);

/**
 * The status for a movement that has already physically happened.
 *
 * `delta` is required only for ADJUSTMENT, whose direction is not in the type.
 * Quantities are stored unsigned here, so without it the direction is genuinely
 * unknowable — and guessing would put a fabrication in the subledger. Callers that
 * cannot supply it get nulls back and the row stays honestly uncoded.
 */
export function physicalStatusFor(
  transactionType: string,
  opts: { delta?: number; on?: Date } = {},
): TransactionStatusFields {
  const at = opts.on ?? new Date();
  const none: TransactionStatusFields = {
    receipt_status: null, issue_status: null, physical_date: null, financial_date: null,
  };

  if (RECEIPT_TYPES.has(transactionType)) {
    return { receipt_status: 'RECEIVED', issue_status: null, physical_date: at, financial_date: null };
  }

  if (ISSUE_TYPES.has(transactionType)) {
    return { receipt_status: null, issue_status: 'DEDUCTED', physical_date: at, financial_date: null };
  }

  if (transactionType === 'ADJUSTMENT') {
    // **[OFFICIAL]** a counting journal is "Both | Both" — physically AND
    // financially updated in the same posting, because there is no second document
    // coming. So a positive count lands on PURCHASED, not RECEIVED, and both dates
    // are set. This is the one place where the two ladders' end rungs are reached
    // in a single step.
    if (opts.delta === undefined || opts.delta === 0) return none;
    return opts.delta > 0
      ? { receipt_status: 'PURCHASED', issue_status: null, physical_date: at, financial_date: at }
      : { receipt_status: null, issue_status: 'SOLD', physical_date: at, financial_date: at };
  }

  return none;
}
