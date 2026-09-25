/**
 * Supplier return and supplier credit service.
 *
 * Physical flow (ship):
 *   Dr PURCHASE_ACCRUAL / Cr INVENTORY
 *   Fails closed when post_product_receipt_in_ledger is off.
 *
 * Financial flow (post credit):
 *   Dr AP / Cr PURCHASE_ACCRUAL / Cr VAT_INPUT
 *   Creates a SUPPLIER_CREDIT DEBIT open transaction and settles it against
 *   the original invoice CREDIT open transaction.
 *
 * Ledger-accounting-currency documents only, separate-receipt-ledger mode only.
 * Cross-currency and combined-mode reversal are explicitly deferred (WORK-019 §8).
 */

import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/logger';
import { allocateNumber } from '../../shared/services/numberSequence.service';
import { postJournal } from '../../shared/services/journal.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { physicalStatusFor } from '../../shared/services/inventoryTransactionStatus';
import { assertDocumentCurrencySupported } from '../../shared/services/currency/documentCurrency';
import { resolveSubledgerAmounts } from '../../shared/services/currency/subledgerAmounts';

type Tx = Prisma.TransactionClient;
const round2 = (n: number) => Math.round(n * 100) / 100;
const EPSILON = 0.005;

// ── Currency guard ────────────────────────────────────────────────────────────
// Documents in the ledger's accounting currency only; cross-currency credits are
// deferred (WORK-019 §8, WORK-026).

async function assertLedgerCurrency(tenantId: string, invoiceCurrency: string, client: Tx | typeof db) {
  await assertDocumentCurrencySupported(tenantId, invoiceCurrency, {
    errorCode: 'RETURN_FX_NOT_IMPLEMENTED',
    capability: 'Supplier returns and credits',
    client,
  });
}

// ── Create return from posted invoice ─────────────────────────────────────────

export interface ReturnLineInput {
  invoice_line_id: string;
  /** Required for stocked lines; null for service / credit-only lines. */
  receipt_line_id?: string | null;
  quantity: number;
  source_location_id?: string | null;
}

export interface CreateReturnInput {
  invoice_id: string;
  warehouse_id: string;
  reason?: string | null;
  requested_date?: string | null;
  lines: ReturnLineInput[];
}

export async function createReturnFromInvoice(
  tenantId: string,
  userId: string,
  input: CreateReturnInput,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM vendor_invoices WHERE id = ${input.invoice_id}::uuid FOR UPDATE`;
    const invoice = await tx.vendorInvoice.findFirst({
      where: { id: input.invoice_id, tenant_id: tenantId },
      include: {
        lines: {
          include: {
            matches: {
              include: {
                receipt_line: { include: { receipt: true } },
              },
            },
          },
        },
      },
    });
    if (!invoice) throw new AppError('Vendor invoice not found.', 404);
    if (invoice.status !== 'POSTED') {
      throw new AppError(
        `Only a posted vendor invoice can be the source of a return. ${invoice.internal_number} is ${invoice.status}.`,
        409, 'INVOICE_NOT_POSTED',
      );
    }
    await assertLedgerCurrency(tenantId, invoice.currency, tx);
    if (Number(invoice.non_recoverable_tax) !== 0) {
      throw new AppError(
        'The bounded BOB return flow cannot reverse an invoice with non-recoverable tax.',
        409,
        'NON_RECOVERABLE_TAX_NOT_SUPPORTED',
      );
    }
    const legalEntityId = invoice.legal_entity_id;
    const warehouse = await tx.warehouse.findFirst({
      where: { id: input.warehouse_id, tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    if (!warehouse) throw new AppError('Active source warehouse not found for this tenant.', 404);
    if (!input.lines.length) throw new AppError('At least one return line is required.', 400);
    const allocationKeys = input.lines.map(line => `${line.invoice_line_id}:${line.receipt_line_id ?? ''}`);
    if (new Set(allocationKeys).size !== allocationKeys.length) {
      throw new AppError('Each invoice and receipt line allocation may appear only once.', 400, 'DUPLICATE_RETURN_LINE');
    }

    // Validate each requested line against cumulative limits
    const returnNumber = await allocateNumber({
      tenantId, reference: 'PURCHASE_RETURN', legalEntityId, tx,
    });

    const ret = await tx.purchaseReturn.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        return_number: returnNumber,
        supplier_id: invoice.supplier_id,
        original_invoice_id: invoice.id,
        warehouse_id: input.warehouse_id,
        reason: input.reason ?? null,
        requested_date: input.requested_date ? new Date(input.requested_date) : new Date(),
        created_by: userId,
      },
    });

    for (const [i, rl] of input.lines.entries()) {
      const invoiceLine = invoice.lines.find(l => l.id === rl.invoice_line_id);
      if (!invoiceLine) {
        throw new AppError(`Invoice line ${rl.invoice_line_id} is not on invoice ${invoice.internal_number}.`, 400);
      }
      const qty = Number(rl.quantity);
      if (!Number.isSafeInteger(qty) || qty <= 0) {
        throw new AppError('Physical return quantity must be a positive whole number.', 400, 'RETURN_INTEGER_QUANTITY_REQUIRED');
      }
      if (!invoiceLine.product_id || !rl.receipt_line_id || !rl.source_location_id) {
        throw new AppError(
          'Physical return lines require a product, matched product receipt line, and source location.',
          400,
          'PHYSICAL_RETURN_PROVENANCE_REQUIRED',
        );
      }
      const sourceMatch = invoiceLine.matches.find(m => m.receipt_line_id === rl.receipt_line_id);
      if (!sourceMatch) {
        throw new AppError('The selected receipt line was not matched to this invoice line.', 409, 'RETURN_RECEIPT_NOT_MATCHED');
      }
      const receiptLine = sourceMatch.receipt_line;
      if (
        receiptLine.receipt.status !== 'POSTED' ||
        receiptLine.product_id !== invoiceLine.product_id ||
        (receiptLine.variant_id ?? null) !== (invoiceLine.variant_id ?? null)
      ) {
        throw new AppError('Receipt provenance does not match the invoice product, variant, and warehouse.', 409, 'RETURN_PROVENANCE_MISMATCH');
      }
      const location = await tx.warehouseLocation.findFirst({
        where: { id: rl.source_location_id, zone: { warehouse_id: input.warehouse_id, warehouse: { tenant_id: tenantId } } },
        select: { id: true },
      });
      if (!location) throw new AppError('Source location is outside the return warehouse.', 409, 'RETURN_LOCATION_MISMATCH');

      // Cumulative limit: active returns + this <= matched qty for this (invoice_line, receipt_line) pair
      const matchQty = Number(sourceMatch.quantity);

      const alreadyReturned = await tx.purchaseReturnLine.aggregate({
        where: {
          original_invoice_line_id: rl.invoice_line_id,
          original_receipt_line_id: rl.receipt_line_id ?? null,
          purchase_return: { tenant_id: tenantId, status: { not: 'CANCELLED' } },
        },
        _sum: { quantity: true },
      });
      const cum = (alreadyReturned._sum.quantity ?? 0) + qty;
      if (cum > matchQty + EPSILON) {
        throw new AppError(
          `Returning ${qty} unit(s) on invoice line ${rl.invoice_line_id} would exceed the ` +
          `matched quantity of ${matchQty}. Active returns already cover ${alreadyReturned._sum.quantity ?? 0} unit(s).`,
          409, 'EXCESS_RETURN_QUANTITY',
        );
      }

      // Freeze the posted invoice line allocation and the matched receipt cost.
      // Current tax configuration must never rewrite a posted invoice.
      const invoiceQty = Number(invoiceLine.quantity);
      if (!Number.isFinite(invoiceQty) || invoiceQty <= 0) {
        throw new AppError('The source invoice line has an invalid quantity.', 409, 'INVALID_SOURCE_QUANTITY');
      }
      const lineGross = round2(Number(invoiceLine.line_net_amount) * qty / invoiceQty);
      const invoiceTotal = Number(invoice.total_amount);
      if (!Number.isFinite(invoiceTotal) || invoiceTotal <= 0) {
        throw new AppError('The source invoice has an invalid total.', 409, 'INVALID_SOURCE_TOTAL');
      }
      const tax = round2(Number(invoice.tax_amount) * lineGross / invoiceTotal);
      const invoiceNet = round2(lineGross - tax);

      await tx.purchaseReturnLine.create({
        data: {
          return_id: ret.id,
          original_invoice_line_id: rl.invoice_line_id,
          original_receipt_line_id: rl.receipt_line_id,
          product_id: invoiceLine.product_id,
          variant_id: invoiceLine.variant_id ?? null,
          source_location_id: rl.source_location_id,
          quantity: qty,
          frozen_gross_unit_cost: round2(lineGross / qty),
          frozen_net_unit_cost: receiptLine.net_unit_cost,
          gross_amount: lineGross,
          net_amount: invoiceNet,
          tax_amount: tax,
          sort_order: i,
        },
      });
    }

    logger.info({ tenantId, return: returnNumber }, 'Purchase return created');
    return { id: ret.id, return_number: returnNumber };
  }, { timeout: 60_000, maxWait: 20_000 });
}

// ── Ship return ────────────────────────────────────────────────────────────────

export interface ShipReturnInput {
  shipped_date?: string | null;
  shipment_reference?: string | null;
}

export async function shipReturn(
  tenantId: string,
  userId: string,
  returnId: string,
  input: ShipReturnInput,
) {
  return db.$transaction(async (tx) => {
    // Row lock
    await tx.$queryRaw`SELECT id FROM purchase_returns WHERE id = ${returnId}::uuid FOR UPDATE`;

    const ret = await tx.purchaseReturn.findFirst({
      where: { id: returnId, tenant_id: tenantId },
      include: { lines: true, original_invoice: { select: { purchase_order_id: true, supplier_id: true, currency: true } } },
    });
    if (!ret) throw new AppError('Purchase return not found.', 404);
    if (ret.status !== 'DRAFT') {
      throw new AppError(`Only a DRAFT return can be shipped. This return is ${ret.status}.`, 409, 'RETURN_NOT_DRAFT');
    }
    await assertLedgerCurrency(tenantId, ret.original_invoice.currency, tx);
    const legalEntityId = ret.legal_entity_id;

    // Fail closed: separate receipt posting required
    const params = await tx.purchaseParameters.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
      select: { post_product_receipt_in_ledger: true },
    });
    if (!params?.post_product_receipt_in_ledger) {
      throw new AppError(
        'Supplier return shipment requires post_product_receipt_in_ledger = true. ' +
        'Correctly reversing the combined-mode voucher requires document-specific allocation ' +
        'that historical combined records do not contain. Turn the parameter on first.',
        409, 'RECEIPT_LEDGER_MODE_REQUIRED',
      );
    }

    const physicalLines = ret.lines.filter(l => l.original_receipt_line_id !== null);
    if (!physicalLines.length || physicalLines.length !== ret.lines.length) {
      throw new AppError('A purchase return must contain only physical, receipt-linked lines.', 409, 'RETURN_PHYSICAL_LINES_REQUIRED');
    }
    let totalNetReturned = 0;

    for (const line of physicalLines) {
      if (!line.source_location_id || !line.product_id) {
        throw new AppError(
          `Return line ${line.id} has no source location. Set one before shipping.`, 400,
        );
      }

      // Lock stock row
      await tx.$queryRaw`
        SELECT id FROM inventory_stock
        WHERE tenant_id = ${tenantId}::uuid
          AND product_id = ${line.product_id}::uuid
          AND location_id = ${line.source_location_id}::uuid
        FOR UPDATE`;

      const stock = await tx.inventoryStock.findFirst({
        where: {
          tenant_id: tenantId,
          product_id: line.product_id!,
          variant_id: line.variant_id ?? null,
          location_id: line.source_location_id,
        },
      });
      const available = stock ? Number(stock.quantity) - Number(stock.reserved_qty) : 0;
      if (available < line.quantity - EPSILON) {
        throw new AppError(
          `Insufficient unreserved stock for product ${line.product_id} at location ` +
          `${line.source_location_id}. Need ${line.quantity}, available ${available}.`,
          409, 'INSUFFICIENT_STOCK',
        );
      }

      // Resolve source PO through the original receipt line
      const receiptLine = await tx.productReceiptLine.findUnique({
        where: { id: line.original_receipt_line_id! },
        include: { receipt: { select: { purchase_order_id: true } } },
      });
      const sourcePOId = receiptLine?.receipt?.purchase_order_id ?? null;
      if (!sourcePOId) {
        throw new AppError(
          `Cannot resolve the source purchase order for return line ${line.id}. ` +
          `Exact-cost layer consumption requires a PO-linked receipt.`,
          409, 'NO_SOURCE_PO',
        );
      }

      // Consume cost layers FIFO, PO-specific only
      await tx.$queryRaw`
        SELECT id FROM inventory_cost_layers
        WHERE tenant_id = ${tenantId}::uuid
          AND product_id = ${line.product_id}::uuid
          AND source_po_id = ${sourcePOId}::uuid
          AND location_id = ${line.source_location_id}::uuid
          AND quantity > 0
        ORDER BY received_at ASC
        FOR UPDATE`;

      const layers = await tx.inventoryCostLayer.findMany({
        where: {
          tenant_id: tenantId,
          product_id: line.product_id!,
          variant_id: line.variant_id ?? null,
          source_po_id: sourcePOId,
          location_id: line.source_location_id,
          unit_cost: line.frozen_net_unit_cost,
          quantity: { gt: 0 },
        },
        orderBy: { received_at: 'asc' },
      });
      let remaining = line.quantity;
      for (const layer of layers) {
        if (remaining <= 0) break;
        const consume = Math.min(remaining, layer.quantity);
        await tx.inventoryCostLayer.update({
          where: { id: layer.id }, data: { quantity: { decrement: consume } },
        });
        remaining -= consume;
      }
      if (remaining > 0) {
        throw new AppError(
          `Only ${line.quantity - remaining} of ${line.quantity} units could be matched to ` +
          `exact-cost layers from PO ${sourcePOId} at location ${line.source_location_id}. ` +
          `The stock may have been consumed or moved.`,
          409, 'INSUFFICIENT_PO_COST_LAYERS',
        );
      }

      // Decrement stock and write issue transaction
      await tx.inventoryStock.update({
        where: stock
          ? { id: stock.id }
          : { tenant_id_product_id_variant_id_location_id: {
              tenant_id: tenantId, product_id: line.product_id!,
              variant_id: line.variant_id ?? null, location_id: line.source_location_id,
            } },
        data: { quantity: { decrement: line.quantity } },
      });

      await tx.inventoryTransaction.create({
        data: {
          tenant_id: tenantId,
          transaction_type: 'PURCHASE_RETURN',
          ...physicalStatusFor('PURCHASE_RETURN', { on: input.shipped_date ? new Date(input.shipped_date) : new Date() }),
          reference_type: 'PURCHASE_RETURN',
          reference_id: ret.id,
          reference_number: ret.return_number,
          product_id: line.product_id!,
          variant_id: line.variant_id ?? null,
          from_location_id: line.source_location_id,
          quantity: line.quantity,
          unit_cost: Number(line.frozen_net_unit_cost),
          performed_by: userId,
        },
      });

      totalNetReturned = round2(totalNetReturned + line.quantity * Number(line.frozen_net_unit_cost));
    }

    // Ship voucher: Dr PURCHASE_ACCRUAL / Cr INVENTORY
    let journalId: string | null = null;
    if (totalNetReturned > 0) {
      const acc = await resolvePostingAccounts_orExplain(
        tenantId, ['PURCHASE_ACCRUAL', 'INVENTORY'] as const,
        { document: `Return shipment ${ret.return_number}`, partyId: ret.supplier_id, legalEntityId, client: tx },
      );
      if (!acc) throw new AppError('Return shipment posting accounts are unresolved.', 409, 'POSTING_PROFILE_UNRESOLVED');
      const entry = await postJournal({
        tenantId, legalEntityId, tx,
        date: input.shipped_date ? new Date(input.shipped_date) : new Date(),
        description: `Return shipment: ${ret.return_number}`,
        source: { module: 'PURCHASE_RETURN', id: ret.id },
        userId,
        lines: [
          { accountId: acc.PURCHASE_ACCRUAL, debit: totalNetReturned, description: `Goods returned to supplier - ${ret.return_number}` },
          { accountId: acc.INVENTORY, credit: totalNetReturned, description: `Inventory reduced - ${ret.return_number}` },
        ],
      });
      journalId = entry.id;
    }

    await tx.purchaseReturn.update({
      where: { id: ret.id },
      data: {
        status: 'SHIPPED',
        shipped_date: input.shipped_date ? new Date(input.shipped_date) : new Date(),
        shipment_reference: input.shipment_reference ?? null,
        shipped_by: userId,
        journal_entry_id: journalId,
      },
    });

    logger.info({ tenantId, return: ret.return_number, voucher: journalId, net: totalNetReturned }, 'Return shipped');
    return { id: ret.id, return_number: ret.return_number, journal_entry_id: journalId };
  }, { timeout: 60_000, maxWait: 20_000 });
}

// ── Create supplier credit ─────────────────────────────────────────────────────

export interface CreditLineInput {
  invoice_line_id: string;
  return_line_id?: string | null;
  quantity: number;
  description?: string | null;
}

export interface CreateCreditInput {
  invoice_id: string;
  purchase_return_id?: string | null;
  external_credit_number?: string | null;
  credit_date: string;
  posting_date?: string | null;
  lines: CreditLineInput[];
  notes?: string | null;
}

export async function createCredit(
  tenantId: string,
  userId: string,
  input: CreateCreditInput,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM vendor_invoices WHERE id = ${input.invoice_id}::uuid FOR UPDATE`;
    const invoice = await tx.vendorInvoice.findFirst({
      where: { id: input.invoice_id, tenant_id: tenantId },
      include: { lines: true },
    });
    if (!invoice) throw new AppError('Vendor invoice not found.', 404);
    if (invoice.status !== 'POSTED') {
      throw new AppError(`Source invoice ${invoice.internal_number} must be POSTED.`, 409, 'INVOICE_NOT_POSTED');
    }
    await assertLedgerCurrency(tenantId, invoice.currency, tx);
    if (!input.purchase_return_id) {
      throw new AppError('A shipped purchase return is required; credit-only service lines are deferred.', 409, 'SHIPPED_RETURN_REQUIRED');
    }
    await tx.$queryRaw`SELECT id FROM purchase_returns WHERE id = ${input.purchase_return_id}::uuid FOR UPDATE`;
    const ret = await tx.purchaseReturn.findFirst({
      where: { id: input.purchase_return_id, tenant_id: tenantId },
      include: { lines: true },
    });
    if (!ret) throw new AppError('Purchase return not found.', 404);
    if (ret.status !== 'SHIPPED' || ret.original_invoice_id !== invoice.id ||
        ret.supplier_id !== invoice.supplier_id || ret.legal_entity_id !== invoice.legal_entity_id) {
      throw new AppError('Supplier credit requires a shipped return in the same invoice scope.', 409, 'RETURN_CREDIT_SCOPE_MISMATCH');
    }
    if (!input.lines.length || input.lines.some(line => !line.return_line_id)) {
      throw new AppError('Every supplier-credit line must reference a shipped return line.', 400, 'RETURN_LINE_REQUIRED');
    }
    if (new Set(input.lines.map(line => line.return_line_id)).size !== input.lines.length) {
      throw new AppError('Each return line may appear only once.', 400, 'DUPLICATE_CREDIT_LINE');
    }
    const legalEntityId = invoice.legal_entity_id;

    const creditNumber = await allocateNumber({
      tenantId, reference: 'SUPPLIER_CREDIT', legalEntityId, tx,
    });

    // Copy amounts frozen on the return. Current tax configuration must never
    // rewrite the historical split of a posted invoice.
    let totalNet = 0, totalTax = 0;
    const linesData: Array<{
      original_invoice_line_id: string; return_line_id: string | null;
      product_id: string | null; variant_id: string | null; description: string | null;
      quantity: number; unit_price: number;
      net_amount: number; tax_amount: number; gross_amount: number; sort_order: number;
    }> = [];

    for (const [i, cl] of input.lines.entries()) {
      const invLine = invoice.lines.find(l => l.id === cl.invoice_line_id);
      if (!invLine) throw new AppError(`Invoice line ${cl.invoice_line_id} not found on invoice.`, 400);
      const returnLine = ret.lines.find(line => line.id === cl.return_line_id);
      if (!returnLine || returnLine.original_invoice_line_id !== invLine.id) {
        throw new AppError('Credit line does not belong to the selected return and invoice line.', 409, 'CREDIT_RETURN_LINE_MISMATCH');
      }
      const qty = Number(cl.quantity);
      if (!Number.isSafeInteger(qty) || qty <= 0) {
        throw new AppError('Credit quantity must be a positive whole number.', 400, 'CREDIT_INTEGER_QUANTITY_REQUIRED');
      }
      const credited = await tx.supplierCreditLine.aggregate({
        where: {
          return_line_id: returnLine.id,
          credit: { tenant_id: tenantId, status: { not: 'CANCELLED' } },
        },
        _sum: { quantity: true },
      });
      const alreadyCredited = Number(credited._sum.quantity ?? 0);
      if (alreadyCredited + qty > returnLine.quantity + EPSILON) {
        throw new AppError(
          `Credit quantity exceeds the shipped return; ${alreadyCredited} unit(s) are already credited.`,
          409,
          'EXCESS_CREDIT_QUANTITY',
        );
      }
      const ratio = qty / returnLine.quantity;
      const gross = round2(Number(returnLine.gross_amount) * ratio);
      const net = round2(Number(returnLine.net_amount) * ratio);
      const tax = round2(Number(returnLine.tax_amount) * ratio);
      totalNet = round2(totalNet + net);
      totalTax = round2(totalTax + tax);
      linesData.push({
        original_invoice_line_id: invLine.id,
        return_line_id: cl.return_line_id ?? null,
        product_id: invLine.product_id ?? null,
        variant_id: invLine.variant_id ?? null,
        description: cl.description ?? invLine.description ?? null,
        quantity: qty,
        unit_price: round2(gross / qty),
        net_amount: net,
        tax_amount: tax,
        gross_amount: gross,
        sort_order: i,
      });
    }

    const credit = await tx.supplierCredit.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        credit_number: creditNumber,
        external_credit_number: input.external_credit_number?.trim() || null,
        supplier_id: invoice.supplier_id,
        original_invoice_id: invoice.id,
        purchase_return_id: input.purchase_return_id ?? null,
        credit_date: new Date(input.credit_date),
        posting_date: new Date(input.posting_date ?? input.credit_date),
        currency: invoice.currency,
        net_amount: totalNet,
        tax_amount: totalTax,
        total_amount: round2(totalNet + totalTax),
        notes: input.notes ?? null,
        created_by: userId,
        lines: { create: linesData },
      },
    });

    logger.info({ tenantId, credit: creditNumber }, 'Supplier credit created');
    return { id: credit.id, credit_number: creditNumber };
  }, { timeout: 60_000, maxWait: 20_000 });
}

// ── Post supplier credit ───────────────────────────────────────────────────────

export async function postCredit(
  tenantId: string,
  userId: string,
  creditId: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM supplier_credits WHERE id = ${creditId}::uuid FOR UPDATE`;

    const credit = await tx.supplierCredit.findFirst({
      where: { id: creditId, tenant_id: tenantId },
      include: {
        lines: true,
        purchase_return: { select: { id: true, status: true } },
      },
    });
    if (!credit) throw new AppError('Supplier credit not found.', 404);
    if (credit.status !== 'DRAFT') {
      throw new AppError(`Only a DRAFT credit can be posted. This credit is ${credit.status}.`, 409, 'CREDIT_NOT_DRAFT');
    }
    await assertLedgerCurrency(tenantId, credit.currency, tx);
    if (!credit.external_credit_number?.trim()) {
      throw new AppError(
        'The supplier credit-note reference is required before posting.',
        409,
        'EXTERNAL_CREDIT_NUMBER_REQUIRED',
      );
    }
    if (!credit.purchase_return || credit.purchase_return.status !== 'SHIPPED') {
      throw new AppError('A shipped purchase return is required before posting.', 409, 'SHIPPED_RETURN_REQUIRED');
    }
    if (!credit.lines.length || credit.lines.some(line => !line.return_line_id)) {
      throw new AppError('Every posted credit line must reference a shipped return line.', 409, 'RETURN_LINE_REQUIRED');
    }
    const legalEntityId = credit.legal_entity_id;

    const document = `Supplier credit ${credit.credit_number}`;
    const net = Number(credit.net_amount);
    const tax = Number(credit.tax_amount);
    const total = Number(credit.total_amount);
    if (![net, tax, total].every(Number.isFinite) || total <= 0 || Math.abs(total - net - tax) >= 0.01) {
      throw new AppError('Supplier credit totals are invalid or do not reconcile.', 409, 'INVALID_CREDIT_TOTALS');
    }

    const returnLineIds = credit.lines.map(line => line.return_line_id!);
    const returnLines = await tx.purchaseReturnLine.findMany({
      where: { id: { in: returnLineIds }, return_id: credit.purchase_return.id },
      select: { id: true, frozen_net_unit_cost: true },
    });
    if (returnLines.length !== returnLineIds.length) {
      throw new AppError('Credit provenance is incomplete or outside the selected return.', 409, 'CREDIT_PROVENANCE_INVALID');
    }
    const returnCostById = new Map(returnLines.map(line => [line.id, Number(line.frozen_net_unit_cost)]));
    const returnedReceiptNet = round2(credit.lines.reduce(
      (sum, line) => sum + Number(line.quantity) * (returnCostById.get(line.return_line_id!) ?? 0),
      0,
    ));
    const variance = round2(net - returnedReceiptNet);

    await tx.$queryRaw`
      SELECT id FROM vendor_open_transactions
      WHERE tenant_id = ${tenantId}::uuid
        AND source_type = 'INVOICE'
        AND source_id = ${credit.original_invoice_id}::uuid
      FOR UPDATE`;
    const invoiceOpenTx = await tx.vendorOpenTransaction.findFirst({
      where: {
        tenant_id: tenantId,
        source_type: 'INVOICE',
        source_id: credit.original_invoice_id,
        direction: 'CREDIT',
      },
    });
    if (!invoiceOpenTx) {
      throw new AppError('The original invoice open transaction is unavailable.', 409, 'INVOICE_OPEN_TRANSACTION_REQUIRED');
    }
    if (
      invoiceOpenTx.supplier_id !== credit.supplier_id ||
      invoiceOpenTx.legal_entity_id !== legalEntityId ||
      invoiceOpenTx.currency !== credit.currency
    ) {
      throw new AppError('The invoice open transaction is outside this supplier, entity, or currency scope.', 409, 'SETTLEMENT_SCOPE_MISMATCH');
    }
    const settlements = await tx.vendorSettlement.findMany({
      where: {
        OR: [
          { debit_transaction_id: invoiceOpenTx.id },
          { credit_transaction_id: invoiceOpenTx.id },
        ],
      },
      select: { amount: true, reverses_settlement_id: true },
    });
    const settledSoFar = round2(settlements.reduce(
      (sum, row) => sum + (row.reverses_settlement_id ? -Number(row.amount) : Number(row.amount)),
      0,
    ));
    const invoiceOpen = round2(Number(invoiceOpenTx.amount) - settledSoFar);
    if (total > invoiceOpen + EPSILON) {
      throw new AppError(
        `Credit ${total.toFixed(2)} exceeds invoice open amount ${invoiceOpen.toFixed(2)}.`,
        409,
        'OVER_SETTLEMENT',
      );
    }

    const requiredAccounts = ['AP', 'PURCHASE_ACCRUAL', 'VAT_INPUT'] as const;
    const acc = await resolvePostingAccounts_orExplain(
      tenantId, requiredAccounts,
      { document, partyId: credit.supplier_id, legalEntityId, client: tx },
    );
    if (!acc) throw new AppError('Posting accounts unresolved; configure AP, PURCHASE_ACCRUAL and VAT_INPUT profiles.', 409);

    const lines: Array<{ accountId: string; debit?: number; credit?: number; description: string }> = [
      { accountId: acc.AP, debit: total, description: `AP reduced - ${credit.credit_number}` },
      { accountId: acc.PURCHASE_ACCRUAL, credit: returnedReceiptNet, description: `Return accrual - ${credit.credit_number}` },
    ];
    if (tax > 0) {
      lines.push({ accountId: acc.VAT_INPUT, credit: tax, description: `Input tax reversed - ${credit.credit_number}` });
    }
    if (Math.abs(variance) >= 0.01) {
      const pv = await resolvePostingAccounts_orExplain(
        tenantId, ['PRICE_VARIANCE'] as const,
        { document, partyId: credit.supplier_id, legalEntityId, client: tx },
      );
      if (!pv) throw new AppError('Price-variance posting account is unresolved.', 409, 'POSTING_PROFILE_UNRESOLVED');
      lines.push({
        accountId: pv.PRICE_VARIANCE,
        debit: variance < 0 ? -variance : undefined,
        credit: variance > 0 ? variance : undefined,
        description: `Purchase price variance reversed - ${credit.credit_number}`,
      });
    }

    const entry = await postJournal({
      tenantId, legalEntityId, tx,
      date: credit.posting_date,
      description: `Supplier credit: ${credit.credit_number}`,
      source: { module: 'SUPPLIER_CREDIT', id: credit.id },
      userId,
      lines,
    });

    // Create SUPPLIER_CREDIT DEBIT open transaction
    const basis = await resolveSubledgerAmounts({
      tenantId, legalEntityId, currency: credit.currency, amount: total, date: credit.posting_date, client: tx,
    });
    const debitTx = await tx.vendorOpenTransaction.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        supplier_id: credit.supplier_id,
        source_type: 'SUPPLIER_CREDIT',
        source_id: credit.id,
        direction: 'DEBIT',
        transaction_date: credit.credit_date,
        posting_date: credit.posting_date,
        currency: credit.currency,
        amount: total,
        ...basis,
        journal_entry_id: entry.id,
      },
    });

    await tx.vendorSettlement.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        supplier_id: credit.supplier_id,
        debit_transaction_id: debitTx.id,
        credit_transaction_id: invoiceOpenTx.id,
        currency: credit.currency,
        amount: total,
        ...basis,
        settlement_date: credit.posting_date,
        journal_entry_id: entry.id,
        created_by: userId,
      },
    });

    if (round2(invoiceOpen - total) <= EPSILON) {
      await tx.vendorInvoice.updateMany({
        where: { id: credit.original_invoice_id, tenant_id: tenantId },
        data: { paid_at: credit.posting_date },
      });
    }

    await tx.supplierCredit.update({
      where: { id: credit.id },
      data: {
        status: 'POSTED',
        posted_at: new Date(),
        posted_by: userId,
        journal_entry_id: entry.id,
        exchange_rate: basis.exchange_rate,
        amount_functional: basis.amount_functional,
      },
    });

    logger.info({ tenantId, credit: credit.credit_number, voucher: entry.id, total }, 'Supplier credit posted');
    return { id: credit.id, credit_number: credit.credit_number, journal_entry_id: entry.id };
  }, { timeout: 60_000, maxWait: 20_000 });
}

// ── List / get / cancel helpers ────────────────────────────────────────────────

export async function listReturns(tenantId: string, supplierId?: string, status?: string) {
  return db.purchaseReturn.findMany({
    where: { tenant_id: tenantId, ...(supplierId ? { supplier_id: supplierId } : {}), ...(status ? { status } : {}) },
    include: {
      supplier: { select: { code: true, name: true } },
      original_invoice: { select: { internal_number: true, invoice_number: true } },
      lines: { select: { id: true, quantity: true } },
    },
    orderBy: { created_at: 'desc' },
    take: 200,
  });
}

export async function getReturn(tenantId: string, id: string) {
  const ret = await db.purchaseReturn.findFirst({
    where: { id, tenant_id: tenantId },
    include: {
      supplier: true,
      original_invoice: { select: { internal_number: true, invoice_number: true, supplier_id: true } },
      lines: {
        include: {
          original_invoice_line: { select: { quantity: true, unit_price: true, description: true, product: { select: { sku: true, name: true } } } },
          original_receipt_line: { select: { quantity: true, receipt: { select: { receipt_number: true } } } },
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
  if (!ret) throw new AppError('Purchase return not found.', 404);
  return ret;
}

export async function cancelReturn(tenantId: string, id: string) {
  const updated = await db.purchaseReturn.updateMany({
    where: { id, tenant_id: tenantId, status: 'DRAFT' },
    data: { status: 'CANCELLED' },
  });
  if (updated.count === 0) throw new AppError('Return not found or not in DRAFT status.', 409);
}

export async function listCredits(tenantId: string, supplierId?: string, status?: string) {
  return db.supplierCredit.findMany({
    where: { tenant_id: tenantId, ...(supplierId ? { supplier_id: supplierId } : {}), ...(status ? { status } : {}) },
    include: {
      supplier: { select: { code: true, name: true } },
      original_invoice: { select: { internal_number: true, invoice_number: true } },
      lines: { select: { id: true } },
    },
    orderBy: { created_at: 'desc' },
    take: 200,
  });
}

export async function getCredit(tenantId: string, id: string) {
  const credit = await db.supplierCredit.findFirst({
    where: { id, tenant_id: tenantId },
    include: {
      supplier: true,
      original_invoice: { select: { internal_number: true, invoice_number: true } },
      purchase_return: { select: { return_number: true, status: true } },
      lines: {
        include: {
          original_invoice_line: { select: { quantity: true, unit_price: true, description: true, product: { select: { sku: true, name: true } } } },
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  });
  if (!credit) throw new AppError('Supplier credit not found.', 404);
  return credit;
}

export async function cancelCredit(tenantId: string, id: string) {
  const updated = await db.supplierCredit.updateMany({
    where: { id, tenant_id: tenantId, status: 'DRAFT' },
    data: { status: 'CANCELLED' },
  });
  if (updated.count === 0) throw new AppError('Credit not found or not in DRAFT status.', 409);
}
