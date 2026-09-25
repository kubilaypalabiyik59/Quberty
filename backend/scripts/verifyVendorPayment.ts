import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import { getLedgerCurrencies } from '../src/shared/services/currency/ledgerCurrency.service';
import {
  createVendorPayment,
  listVendorOpenTransactions,
  listVendorPayments,
  postVendorPayment,
  reverseVendorPayment,
} from '../src/modules/purchase/vendorPayment.service';

/**
 * Real Supabase TEST acceptance for WORK-018.
 *
 * Posted financial documents are deliberately not deleted. The payment is fully
 * reversed, so its GL and AP effects net to zero while the audit chain remains.
 * A uniquely named payment method is created for the run and deactivated at the end.
 *
 *   $env:ALLOW_TEST_DATABASE_WRITE='WORK018_ACCEPTANCE'
 *   npx tsx scripts/verifyVendorPayment.ts
 */

if (process.env.ALLOW_TEST_DATABASE_WRITE !== 'WORK018_ACCEPTANCE') {
  throw new Error('Set ALLOW_TEST_DATABASE_WRITE=WORK018_ACCEPTANCE to confirm the TEST-only acceptance run.');
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

async function main() {
  // Any active tenant whose ledger exists; the scenario runs in that ledger's own
  // accounting currency (WORK-024), so no currency literal selects the tenant.
  const tenant = await db.tenant.findFirst({
    where: { is_active: true, id: { in: (await db.financeParameters.findMany({ where: { legal_entity_id: null }, select: { tenant_id: true } })).map((r) => r.tenant_id) } },
    orderBy: { created_at: 'asc' },
    select: { id: true, slug: true },
  });
  if (!tenant) throw new Error('No active test tenant with a ledger found.');
  const user = await db.user.findFirst({ where: { tenant_id: tenant.id, is_active: true }, select: { id: true, email: true } });
  if (!user) throw new Error('No active test user found.');

  const openCredits = (await listVendorOpenTransactions(tenant.id)).filter(
    row => row.source_type === 'INVOICE' && row.direction === 'CREDIT' && row.is_open,
  );
  const invoiceCredit = openCredits[0];
  if (!invoiceCredit) throw new Error('No open posted BOB vendor invoice is available for acceptance.');

  const account = await db.account.findFirst({
    where: { tenant_id: tenant.id, is_active: true, code: '1102' },
    select: { id: true, code: true, name: true },
  });
  if (!account) throw new Error('Test tenant has no active 1102 bank account.');

  const marker = `WORK018-${Date.now()}`;
  const method = await db.purchasePaymentMethod.create({
    data: {
      tenant_id: tenant.id,
      code: marker,
      name: `WORK-018 acceptance (${marker})`,
      account_type: 'BANK',
      offset_account_id: account.id,
      allowed_currency: (await getLedgerCurrencies(tenant.id)).accountingCurrency,
      bank_account_reference: marker,
    },
  });

  console.log(`tenant ${tenant.slug}; user ${user.email}; invoice ${invoiceCredit.invoice?.invoice_number}; amount ${invoiceCredit.open_amount}`);
  console.log(`test marker ${marker}`);

  let paymentId: string | null = null;
  let paymentPosted = false;
  try {
    const payment = await createVendorPayment(tenant.id, user.id, {
      supplier_id: invoiceCredit.supplier_id,
      payment_method_id: method.id,
      amount: invoiceCredit.open_amount,
      currency: (await getLedgerCurrencies(tenant.id)).accountingCurrency,
      notes: marker,
    });
    paymentId = payment.id;
    check('payment starts DRAFT', payment.status, 'DRAFT');
    check('payment snapshots the configured bank account', payment.offset_account_id, account.id);

    const posted = await postVendorPayment(tenant.id, user.id, payment.id, {
      allocations: [{ credit_transaction_id: invoiceCredit.id, amount: invoiceCredit.open_amount }],
    });
    paymentPosted = true;
    check('one settlement is created with posting', posted.settlements.length, 1);

    const journal = await db.journalEntry.findUnique({ where: { id: posted.journal_entry_id }, include: { lines: true } });
    if (!journal) throw new Error('Posted payment journal was not found.');
    const debit = round2(journal.lines.reduce((sum, line) => sum + Number(line.debit_amount), 0));
    const credit = round2(journal.lines.reduce((sum, line) => sum + Number(line.credit_amount), 0));
    check('payment voucher is balanced', debit, credit);
    check('payment voucher source is VENDOR_PAYMENT', journal.source_module, 'VENDOR_PAYMENT');

    const afterPostTransactions = await listVendorOpenTransactions(tenant.id, invoiceCredit.supplier_id);
    const paidInvoice = afterPostTransactions.find(row => row.id === invoiceCredit.id);
    const paymentDebit = afterPostTransactions.find(row => row.source_type === 'PAYMENT' && row.source_id === payment.id);
    check('invoice open balance becomes zero', paidInvoice?.open_amount, 0);
    check('payment open balance becomes zero', paymentDebit?.open_amount, 0);
    const invoice = await db.vendorInvoice.findUnique({ where: { id: invoiceCredit.source_id }, select: { paid_at: true } });
    check('fully settled invoice receives paid_at', Boolean(invoice?.paid_at), true);

    const reversed = await reverseVendorPayment(tenant.id, user.id, payment.id, {
      reason: `${marker} acceptance reversal`,
    });
    const reversalJournal = await db.journalEntry.findUnique({ where: { id: reversed.journal_entry_id }, select: { corrects_entry_id: true } });
    check('reversal voucher links to original voucher', reversalJournal?.corrects_entry_id, posted.journal_entry_id);

    const afterReverseTransactions = await listVendorOpenTransactions(tenant.id, invoiceCredit.supplier_id);
    const restoredInvoice = afterReverseTransactions.find(row => row.id === invoiceCredit.id);
    const closedOriginalPayment = afterReverseTransactions.find(row => row.source_type === 'PAYMENT' && row.source_id === payment.id);
    const closedReversal = afterReverseTransactions.find(row => row.source_type === 'PAYMENT_REVERSAL' && row.source_id === reversed.payment_id);
    check('reversal restores invoice open balance', restoredInvoice?.open_amount, invoiceCredit.open_amount);
    check('original payment remains closed against its reversal', closedOriginalPayment?.open_amount, 0);
    check('reversal transaction is closed', closedReversal?.open_amount, 0);
    const restoredInvoiceRow = await db.vendorInvoice.findUnique({ where: { id: invoiceCredit.source_id }, select: { paid_at: true } });
    check('reversal clears invoice paid_at', restoredInvoiceRow?.paid_at, null);

    const paymentRows = await listVendorPayments(tenant.id, invoiceCredit.supplier_id);
    const original = paymentRows.find(row => row.id === payment.id);
    check('original payment points forward to one reversal', original?.reversed_by?.id, reversed.payment_id);
  } finally {
    if (paymentId && !paymentPosted) {
      await db.vendorPayment.deleteMany({ where: { id: paymentId, status: 'DRAFT' } });
      await db.purchasePaymentMethod.delete({ where: { id: method.id } });
    } else {
      await db.purchasePaymentMethod.update({ where: { id: method.id }, data: { is_active: false } });
    }
  }

  if (failures) throw new Error(`${failures} WORK-018 acceptance assertion(s) failed.`);
  console.log('WORK-018 vendor-payment acceptance passed. Posted test documents remain as a fully reversed audit chain.');
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
