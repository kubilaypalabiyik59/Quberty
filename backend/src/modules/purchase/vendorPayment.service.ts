import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { allocateNumber } from '../../shared/services/numberSequence.service';
import { postJournal, reverseJournal } from '../../shared/services/journal.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { assertDocumentCurrencySupported } from '../../shared/services/currency/documentCurrency';
import { getLedgerCurrencies } from '../../shared/services/currency/ledgerCurrency.service';
import { resolveSubledgerAmounts, copySubledgerAmounts } from '../../shared/services/currency/subledgerAmounts';

type Tx = Prisma.TransactionClient;
type Allocation = { credit_transaction_id: string; amount: number };
const EPSILON = 0.005;
const round2 = (value: number) => Math.round(value * 100) / 100;

function dateOnly(value: string | Date | undefined, field: string): Date {
  const date = value instanceof Date ? value : new Date(`${value ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new AppError(`${field} must be a valid date.`, 400, 'INVALID_DATE');
  return date;
}

/** Payments and settlements run in the ledger's accounting currency only (cross-currency is WORK-026). */
async function assertLedgerCurrency(tenantId: string, currency: string, client: Tx | typeof db) {
  await assertDocumentCurrencySupported(tenantId, currency, {
    errorCode: 'VENDOR_PAYMENT_FX_NOT_IMPLEMENTED',
    capability: 'Vendor payments and settlements',
    client,
  });
}

export function effectiveSettledAmount(
  settlements: Array<{ amount: Prisma.Decimal | number | string; reverses_settlement_id: string | null }>,
): number {
  return round2(settlements.reduce(
    (total, row) => total + (row.reverses_settlement_id ? -Number(row.amount) : Number(row.amount)),
    0,
  ));
}

async function openAmount(client: Tx, transactionId: string): Promise<number> {
  const transaction = await client.vendorOpenTransaction.findUnique({
    where: { id: transactionId }, select: { amount: true },
  });
  if (!transaction) throw new AppError('Vendor open transaction not found.', 404);
  const settlements = await client.vendorSettlement.findMany({
    where: { OR: [{ debit_transaction_id: transactionId }, { credit_transaction_id: transactionId }] },
    select: { amount: true, reverses_settlement_id: true },
  });
  return round2(Number(transaction.amount) - effectiveSettledAmount(settlements));
}

async function lockTransactions(client: Tx, tenantId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids)].sort();
  if (!uniqueIds.length) return;
  await client.$queryRaw(
    Prisma.sql`SELECT id FROM vendor_open_transactions WHERE tenant_id = ${tenantId}::uuid AND id::text IN (${Prisma.join(uniqueIds)}) ORDER BY id FOR UPDATE`,
  );
}

/** Creates the AP credit in the same transaction as invoice posting. */
export async function createInvoiceOpenTransaction(
  client: Tx,
  input: {
    tenantId: string;
    legalEntityId: string | null;
    invoiceId: string;
    supplierId: string;
    invoiceDate: Date;
    postingDate: Date;
    currency: string;
    amount: number;
    journalEntryId: string | null;
  },
) {
  await assertLedgerCurrency(input.tenantId, input.currency, client);
  const basis = await resolveSubledgerAmounts({
    tenantId: input.tenantId, legalEntityId: input.legalEntityId,
    currency: input.currency, amount: input.amount, date: input.postingDate, client,
  });
  return client.vendorOpenTransaction.create({
    data: {
      tenant_id: input.tenantId,
      legal_entity_id: input.legalEntityId,
      supplier_id: input.supplierId,
      source_type: 'INVOICE',
      source_id: input.invoiceId,
      direction: 'CREDIT',
      transaction_date: input.invoiceDate,
      posting_date: input.postingDate,
      currency: input.currency,
      amount: input.amount,
      ...basis,
      journal_entry_id: input.journalEntryId,
    },
  });
}

async function settleAgainstCredits(
  client: Tx,
  input: {
    tenantId: string;
    legalEntityId: string | null;
    supplierId: string;
    debitTransactionId: string;
    allocations: Allocation[];
    settlementDate: Date;
    userId: string;
  },
) {
  const allocations = input.allocations.filter(a => Number(a.amount) > 0);
  if (!allocations.length) return [];
  if (new Set(allocations.map(a => a.credit_transaction_id)).size !== allocations.length) {
    throw new AppError('Each invoice can appear only once in a settlement request.', 400, 'DUPLICATE_SETTLEMENT_TARGET');
  }

  await lockTransactions(client, input.tenantId, [input.debitTransactionId, ...allocations.map(a => a.credit_transaction_id)]);
  const debit = await client.vendorOpenTransaction.findFirst({
    where: { id: input.debitTransactionId, tenant_id: input.tenantId },
  });
  if (!debit || debit.direction !== 'DEBIT') throw new AppError('The payment debit transaction is unavailable.', 409);
  if (debit.supplier_id !== input.supplierId || debit.legal_entity_id !== input.legalEntityId) {
    throw new AppError('The payment transaction is outside this supplier or legal-entity scope.', 409);
  }

  const debitOpen = await openAmount(client, debit.id);
  const requested = round2(allocations.reduce((sum, a) => sum + Number(a.amount), 0));
  if (requested > debitOpen + EPSILON) {
    throw new AppError(`Settlement ${requested.toFixed(2)} exceeds the payment's open amount ${debitOpen.toFixed(2)}.`, 409, 'OVER_SETTLEMENT');
  }

  const rows = [];
  for (const allocation of allocations) {
    const amount = round2(Number(allocation.amount));
    const credit = await client.vendorOpenTransaction.findFirst({
      where: { id: allocation.credit_transaction_id, tenant_id: input.tenantId },
    });
    if (!credit || credit.direction !== 'CREDIT') throw new AppError('The selected invoice transaction is unavailable.', 409);
    if (
      credit.supplier_id !== input.supplierId ||
      credit.legal_entity_id !== input.legalEntityId ||
      credit.currency !== debit.currency
    ) {
      throw new AppError('A settlement must stay within one supplier, legal entity, and currency.', 409, 'SETTLEMENT_SCOPE_MISMATCH');
    }
    const creditOpen = await openAmount(client, credit.id);
    if (amount > creditOpen + EPSILON) {
      throw new AppError(`Settlement ${amount.toFixed(2)} exceeds invoice open amount ${creditOpen.toFixed(2)}.`, 409, 'OVER_SETTLEMENT');
    }
    // Measured at the SETTLEMENT date, not carried from the open item (Kubi,
    // 2026-09-12). That difference is where realized FX arises, which is what
    // WORK-026 will post; carrying the open item's rate would hide it. While the
    // document currency is the accounting currency this is an identity.
    const basis = await resolveSubledgerAmounts({
      tenantId: input.tenantId, legalEntityId: input.legalEntityId,
      currency: debit.currency, amount, date: input.settlementDate, client,
    });
    rows.push(await client.vendorSettlement.create({
      data: {
        tenant_id: input.tenantId,
        legal_entity_id: input.legalEntityId,
        supplier_id: input.supplierId,
        debit_transaction_id: debit.id,
        credit_transaction_id: credit.id,
        currency: debit.currency,
        amount,
        ...basis,
        settlement_date: input.settlementDate,
        created_by: input.userId,
      },
    }));
    if (credit.source_type === 'INVOICE' && (await openAmount(client, credit.id)) <= EPSILON) {
      await client.vendorInvoice.updateMany({
        where: { id: credit.source_id, tenant_id: input.tenantId }, data: { paid_at: input.settlementDate },
      });
    }
  }
  return rows;
}

export async function createVendorPayment(
  tenantId: string,
  userId: string,
  body: {
    supplier_id: string;
    payment_method_id: string;
    amount: number;
    payment_date?: string;
    posting_date?: string;
    currency?: string;
    notes?: string;
    legal_entity_id?: string | null;
  },
) {
  return db.$transaction(async client => {
    const amount = round2(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new AppError('Payment amount must be greater than zero.', 400);
    const legalEntityId = body.legal_entity_id ?? null;
    const currency = body.currency ?? (await getLedgerCurrencies(tenantId, legalEntityId, client)).accountingCurrency;
    await assertLedgerCurrency(tenantId, currency, client);

    const [supplier, method] = await Promise.all([
      client.supplier.findFirst({ where: { id: body.supplier_id, tenant_id: tenantId, is_active: true } }),
      client.purchasePaymentMethod.findFirst({
        where: { id: body.payment_method_id, tenant_id: tenantId, legal_entity_id: legalEntityId, is_active: true },
      }),
    ]);
    if (!supplier) throw new AppError('Active supplier not found.', 404);
    if (!method) throw new AppError('Active payment method not found in this legal-entity scope.', 404);
    if (method.allowed_currency && method.allowed_currency !== currency) {
      throw new AppError(`Payment method ${method.code} only allows ${method.allowed_currency}.`, 409);
    }
    const account = await client.account.findFirst({ where: { id: method.offset_account_id, tenant_id: tenantId, is_active: true } });
    if (!account) throw new AppError('The payment method offset account is inactive or belongs to another tenant.', 409);

    const paymentNumber = await allocateNumber({ tenantId, legalEntityId, reference: 'PAYMENT', tx: client });
    const postingDate = dateOnly(body.posting_date ?? body.payment_date, 'posting_date');
    const basis = await resolveSubledgerAmounts({
      tenantId, legalEntityId, currency, amount, date: postingDate, client,
    });
    return client.vendorPayment.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        payment_number: paymentNumber,
        supplier_id: supplier.id,
        payment_date: dateOnly(body.payment_date, 'payment_date'),
        posting_date: postingDate,
        currency,
        amount,
        exchange_rate: basis.exchange_rate,
        amount_functional: basis.amount_functional,
        payment_method_id: method.id,
        offset_account_id: method.offset_account_id,
        created_by: userId,
        notes: body.notes?.trim() || null,
      },
      include: { supplier: true, payment_method: true },
    });
  });
}

export async function postVendorPayment(
  tenantId: string,
  userId: string,
  paymentId: string,
  body: { allocations?: Allocation[]; settlement_date?: string },
) {
  return db.$transaction(async client => {
    await client.$queryRaw`SELECT id FROM vendor_payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    const payment = await client.vendorPayment.findFirst({
      where: { id: paymentId, tenant_id: tenantId }, include: { supplier: true, payment_method: true },
    });
    if (!payment) throw new AppError('Vendor payment not found.', 404);
    if (payment.status !== 'DRAFT') throw new AppError('Only a draft vendor payment can be posted.', 409);
    if (!payment.payment_method.is_active) throw new AppError('The selected payment method is inactive.', 409);
    if (payment.approval_status === 'PENDING' || payment.approval_status === 'REJECTED') {
      throw new AppError(`Payment approval status is ${payment.approval_status}.`, 409, 'PAYMENT_NOT_APPROVED');
    }
    await assertLedgerCurrency(tenantId, payment.currency, client);
    const accounts = await resolvePostingAccounts_orExplain(tenantId, ['AP'] as const, {
      document: `Vendor payment ${payment.payment_number}`,
      partyId: payment.supplier_id,
      legalEntityId: payment.legal_entity_id,
      on: payment.posting_date,
      client,
    });
    if (!accounts) throw new AppError('Accounts payable posting profile is unresolved.', 409);
    const journal = await postJournal({
      tenantId,
      legalEntityId: payment.legal_entity_id,
      tx: client,
      date: payment.posting_date,
      description: `Vendor payment: ${payment.payment_number} — ${payment.supplier.name}`,
      source: { module: 'VENDOR_PAYMENT', id: payment.id },
      userId,
      lines: [
        { accountId: accounts.AP, debit: Number(payment.amount), description: `Clear AP — ${payment.payment_number}` },
        { accountId: payment.offset_account_id, credit: Number(payment.amount), description: `Payment — ${payment.payment_method.code}` },
      ],
    });
    const paymentBasis = await resolveSubledgerAmounts({
      tenantId, legalEntityId: payment.legal_entity_id,
      currency: payment.currency, amount: payment.amount, date: payment.posting_date, client,
    });
    const openTransaction = await client.vendorOpenTransaction.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: payment.legal_entity_id,
        supplier_id: payment.supplier_id,
        source_type: 'PAYMENT',
        source_id: payment.id,
        direction: 'DEBIT',
        transaction_date: payment.payment_date,
        posting_date: payment.posting_date,
        currency: payment.currency,
        amount: payment.amount,
        ...paymentBasis,
        journal_entry_id: journal.id,
      },
    });
    await client.vendorPayment.update({
      where: { id: payment.id }, data: { status: 'POSTED', journal_entry_id: journal.id, posted_at: new Date(), posted_by: userId },
    });
    const settlements = await settleAgainstCredits(client, {
      tenantId,
      legalEntityId: payment.legal_entity_id,
      supplierId: payment.supplier_id,
      debitTransactionId: openTransaction.id,
      allocations: body.allocations ?? [],
      settlementDate: dateOnly(body.settlement_date ?? payment.posting_date, 'settlement_date'),
      userId,
    });
    return { payment_id: payment.id, journal_entry_id: journal.id, settlements };
  }, { timeout: 60_000, maxWait: 20_000 });
}

export async function settleVendorPayment(
  tenantId: string,
  userId: string,
  paymentId: string,
  body: { allocations: Allocation[]; settlement_date?: string },
) {
  return db.$transaction(async client => {
    const payment = await client.vendorPayment.findFirst({ where: { id: paymentId, tenant_id: tenantId, status: 'POSTED' } });
    if (!payment) throw new AppError('Posted vendor payment not found.', 404);
    const debit = await client.vendorOpenTransaction.findFirst({
      where: { tenant_id: tenantId, source_type: 'PAYMENT', source_id: payment.id },
    });
    if (!debit) throw new AppError('The payment has no AP open transaction.', 409);
    return settleAgainstCredits(client, {
      tenantId,
      legalEntityId: payment.legal_entity_id,
      supplierId: payment.supplier_id,
      debitTransactionId: debit.id,
      allocations: body.allocations ?? [],
      settlementDate: dateOnly(body.settlement_date, 'settlement_date'),
      userId,
    });
  }, { timeout: 60_000, maxWait: 20_000 });
}

export async function reverseVendorPayment(
  tenantId: string,
  userId: string,
  paymentId: string,
  body: { reason: string; reversal_date?: string },
) {
  if (!body.reason?.trim()) throw new AppError('A reversal reason is required.', 400, 'REVERSAL_REASON_REQUIRED');
  return db.$transaction(async client => {
    await client.$queryRaw`SELECT id FROM vendor_payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    const original = await client.vendorPayment.findFirst({
      where: { id: paymentId, tenant_id: tenantId }, include: { reversed_by: true },
    });
    if (!original || original.status !== 'POSTED' || !original.journal_entry_id) {
      throw new AppError('Only a posted vendor payment with a voucher can be reversed.', 409);
    }
    if (original.reversed_by) throw new AppError('This vendor payment has already been reversed.', 409);
    const originalOpen = await client.vendorOpenTransaction.findFirst({
      where: { tenant_id: tenantId, source_type: 'PAYMENT', source_id: original.id },
    });
    if (!originalOpen) throw new AppError('The payment has no AP open transaction.', 409);
    await lockTransactions(client, tenantId, [originalOpen.id]);

    const reversalDate = dateOnly(body.reversal_date, 'reversal_date');
    const journal = await reverseJournal({
      tenantId,
      legalEntityId: original.legal_entity_id,
      tx: client,
      entryId: original.journal_entry_id,
      reason: body.reason.trim(),
      date: reversalDate,
      userId,
    });
    const number = await allocateNumber({ tenantId, legalEntityId: original.legal_entity_id, reference: 'PAYMENT', tx: client });
    const reversal = await client.vendorPayment.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: original.legal_entity_id,
        payment_number: number,
        supplier_id: original.supplier_id,
        payment_date: reversalDate,
        posting_date: reversalDate,
        currency: original.currency,
        amount: original.amount,
        exchange_rate: original.exchange_rate,
        amount_functional: original.amount_functional,
        payment_method_id: original.payment_method_id,
        offset_account_id: original.offset_account_id,
        journal_entry_id: journal.id,
        status: 'POSTED',
        approval_status: 'NOT_REQUIRED',
        reverses_payment_id: original.id,
        created_by: userId,
        posted_by: userId,
        posted_at: new Date(),
        notes: `Reversal: ${body.reason.trim()}`,
      },
    });
    // A reversal is measured exactly like the row it reverses — copied, never
    // re-translated, so the pair nets to zero whatever the rate has done since.
    const reversalOpen = await client.vendorOpenTransaction.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: original.legal_entity_id,
        supplier_id: original.supplier_id,
        source_type: 'PAYMENT_REVERSAL',
        source_id: reversal.id,
        reverses_transaction_id: originalOpen.id,
        direction: 'CREDIT',
        transaction_date: reversalDate,
        posting_date: reversalDate,
        currency: original.currency,
        amount: original.amount,
        ...copySubledgerAmounts(originalOpen),
        journal_entry_id: journal.id,
      },
    });
    const allocations = await client.vendorSettlement.findMany({
      where: { debit_transaction_id: originalOpen.id, reverses_settlement_id: null }, include: { reversed_by: true },
    });
    for (const allocation of allocations.filter(a => !a.reversed_by)) {
      await client.vendorSettlement.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: original.legal_entity_id,
          supplier_id: original.supplier_id,
          debit_transaction_id: allocation.debit_transaction_id,
          credit_transaction_id: allocation.credit_transaction_id,
          currency: allocation.currency,
          amount: allocation.amount,
          ...copySubledgerAmounts(allocation),
          settlement_date: reversalDate,
          journal_entry_id: journal.id,
          reverses_settlement_id: allocation.id,
          created_by: userId,
        },
      });
      const credit = await client.vendorOpenTransaction.findUnique({ where: { id: allocation.credit_transaction_id } });
      if (credit?.source_type === 'INVOICE') {
        await client.vendorInvoice.updateMany({ where: { id: credit.source_id, tenant_id: tenantId }, data: { paid_at: null } });
      }
    }
    await client.vendorSettlement.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: original.legal_entity_id,
        supplier_id: original.supplier_id,
        debit_transaction_id: originalOpen.id,
        credit_transaction_id: reversalOpen.id,
        currency: original.currency,
        amount: original.amount,
        ...copySubledgerAmounts(originalOpen),
        settlement_date: reversalDate,
        journal_entry_id: journal.id,
        created_by: userId,
      },
    });
    return { payment_id: reversal.id, payment_number: reversal.payment_number, journal_entry_id: journal.id };
  }, { timeout: 60_000, maxWait: 20_000 });
}

export async function listVendorPayments(tenantId: string, supplierId?: string) {
  const rows = await db.vendorPayment.findMany({
    where: { tenant_id: tenantId, ...(supplierId ? { supplier_id: supplierId } : {}) },
    include: {
      supplier: { select: { code: true, name: true } },
      payment_method: { select: { code: true, name: true } },
      reversed_by: { select: { id: true, payment_number: true } },
    },
    orderBy: [{ payment_date: 'desc' }, { created_at: 'desc' }],
    take: 250,
  });
  const transactionRows = await db.vendorOpenTransaction.findMany({
    where: { tenant_id: tenantId, source_type: { in: ['PAYMENT', 'PAYMENT_REVERSAL'] }, source_id: { in: rows.map(r => r.id) } },
    include: { debit_settlements: true, credit_settlements: true },
  });
  const bySource = new Map(transactionRows.map(row => [row.source_id, row]));
  return rows.map(row => {
    const transaction = bySource.get(row.id);
    const settlements = transaction ? [...transaction.debit_settlements, ...transaction.credit_settlements] : [];
    return { ...row, open_amount: transaction ? round2(Number(transaction.amount) - effectiveSettledAmount(settlements)) : null };
  });
}

export async function listVendorOpenTransactions(tenantId: string, supplierId?: string) {
  const rows = await db.vendorOpenTransaction.findMany({
    where: { tenant_id: tenantId, ...(supplierId ? { supplier_id: supplierId } : {}) },
    include: {
      supplier: { select: { code: true, name: true } },
      debit_settlements: true,
      credit_settlements: true,
    },
    orderBy: [{ posting_date: 'asc' }, { created_at: 'asc' }],
    take: 500,
  });
  const invoiceIds = rows.filter(r => r.source_type === 'INVOICE').map(r => r.source_id);
  const invoices = invoiceIds.length
    ? await db.vendorInvoice.findMany({
        where: { tenant_id: tenantId, id: { in: invoiceIds } },
        select: { id: true, internal_number: true, invoice_number: true, due_date: true },
      })
    : [];
  const invoiceById = new Map(invoices.map(i => [i.id, i]));
  return rows.map(row => {
    const settlements = [...row.debit_settlements, ...row.credit_settlements];
    const open = round2(Number(row.amount) - effectiveSettledAmount(settlements));
    return {
      ...row,
      open_amount: open,
      is_open: open > EPSILON,
      invoice: row.source_type === 'INVOICE' ? invoiceById.get(row.source_id) ?? null : null,
      debit_settlements: undefined,
      credit_settlements: undefined,
    };
  });
}
