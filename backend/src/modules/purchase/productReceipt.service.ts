import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/logger';
import { physicalStatusFor } from '../../shared/services/inventoryTransactionStatus';
import { allocateNumber } from '../../shared/services/numberSequence.service';
import { postJournal } from '../../shared/services/journal.service';
import { contextForPurchaseOrder } from '../../shared/services/dimension.service';
import { resolveItemPolicies, groupByItemGroup, ItemPolicy } from '../../shared/services/itemPolicy.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { computePurchaseMoney } from '../../shared/services/documentTax.service';
import { resolveWarehouseParameters } from '../../shared/services/warehouseParameters.service';
import { WarehouseService } from '../warehouse/warehouse.service';

const warehouseService = new WarehouseService();

/**
 * Product receipt — the PHYSICAL half of a purchase.
 *
 * **[OFFICIAL]** "A vendor invoice completes the cycle from purchase order to
 * product receipt to vendor invoice." The receipt asserts that goods arrived; the
 * invoice asserts that the supplier has billed us. They are different events, on
 * different dates, with different accounting consequences.
 * learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-invoices-overview
 *
 * ── WHAT POSTS HERE, AND WHAT DELIBERATELY DOES NOT ────────────────────────
 * **[OFFICIAL]** for the physical transaction to reach the ledger, "Post product
 * receipt in ledger" must be on AND the item model group must have "Post physical
 * inventory" and "Accrue liability on product receipt".
 * learn.microsoft.com/dynamics365/finance/general-ledger/purchase-order-posting
 *
 *     DR  INVENTORY / PURCHASE_EXPENSE     net cost of goods received
 *         CR  PURCHASE_ACCRUAL             net cost of goods received
 *
 * Recoverable tax is NOT recognised here, and neither is accounts payable. Both
 * belong to the invoice. Every receipt-side account in the official model is a
 * clearing account for exactly this reason — the accrual balance is goods
 * received not invoiced, and it must net to zero once the invoice arrives.
 *
 * For Bolivia this is not a stylistic preference: IVA crédito fiscal is claimed
 * against the supplier's factura, and at goods receipt no factura exists.
 *
 * ── THE COST THAT CAPITALISES ──────────────────────────────────────────────
 * `net_unit_cost` is the agreed price less recoverable tax, computed per line at
 * receipt time from the tax codes in force on that date. It is stored, not
 * recomputed, and it is what the inventory batch is written at.
 *
 * That last point fixes a real divergence: batches used to be created at the
 * GROSS unit cost while the voucher capitalised the NET, so the inventory
 * subledger and the general ledger disagreed by the VAT on every receipt, and
 * COGS drawn from those batches was overstated by the same amount.
 */

type Tx = Prisma.TransactionClient;

export interface ReceiptLineInput {
  po_line_id: string;
  quantity: number;
  location_id?: string | null;
}

export interface CreateReceiptInput {
  purchase_order_id: string;
  /** **[OFFICIAL]** required for accounting — the supplier's packing slip reference. */
  packing_slip: string;
  receipt_date?: string | null;
  location_id?: string | null;
  notes?: string | null;
  /** Omitted → every open line at its full outstanding quantity. */
  lines?: ReceiptLineInput[];
}

export interface PostedReceipt {
  id: string;
  receipt_number: string;
  journal_entry_id: string | null;
  accrued_amount: number;
  lines: number;
  /** Explains a null journal, so "no voucher" is never silent. */
  posting_note: string;
}

/* ────────────────────────────── helpers ──────────────────────────────────── */

/**
 * Split one line's agreed (gross) amount into what capitalises and what is
 * reclaimable, using the tenant's own tax codes. No jurisdiction branch: for
 * Bolivia the tax is inside the price so net < gross; for Turkey it is added on
 * top so net == the agreed price. Same call, opposite arithmetic, decided by
 * TaxCode rows.
 */
async function netOf(
  tenantId: string,
  grossLineAmount: number,
  supplierId: string | null,
  tx: Tx,
): Promise<number> {
  const money = await computePurchaseMoney(tenantId, grossLineAmount, {
    partyId: supplierId, client: tx,
  });
  return money.net;
}

/* ──────────────────────────── create + post ──────────────────────────────── */

export async function createAndPostReceipt(
  tenantId: string,
  userId: string,
  input: CreateReceiptInput,
  legalEntityId: string | null = null,
): Promise<PostedReceipt> {
  return db.$transaction(
    async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where: { id: input.purchase_order_id, tenant_id: tenantId },
        include: { lines: true },
      });
      if (!po) throw new AppError('Purchase order not found', 404);
      if (!['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(po.status)) {
        throw new AppError(
          `A product receipt needs a confirmed purchase order. ${po.po_number} is ${po.status}.`,
          409,
          'PO_NOT_CONFIRMED',
        );
      }
      if (!input.packing_slip?.trim()) {
        throw new AppError(
          'A packing slip reference is required. It is what lets the supplier\'s delivery note be ' +
            'audited against what was received and what was accounted.',
          400,
          'PACKING_SLIP_REQUIRED',
        );
      }

      const params = await tx.purchaseParameters.findFirst({
        where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
        select: { post_product_receipt_in_ledger: true },
      });
      const postToLedger = params?.post_product_receipt_in_ledger ?? false;

      const policies = await resolveItemPolicies(tenantId, po.lines.map(l => l.product_id), tx);

      // ── Which lines, and how much ──────────────────────────────────────────
      const requested: ReceiptLineInput[] =
        input.lines?.length
          ? input.lines
          : po.lines
              .map(l => ({
                po_line_id: l.id,
                quantity: Number(l.quantity) - Number(l.received_qty),
              }))
              .filter(l => l.quantity > 0);

      if (requested.length === 0) {
        throw new AppError(
          `Nothing outstanding to receive on ${po.po_number} — every line is already fully received.`,
          409,
          'NOTHING_TO_RECEIVE',
        );
      }

      const locationId = input.location_id ?? po.receive_location_id ?? null;
      if (!locationId) {
        throw new AppError(
          'A receiving location is required. Set one on the order or pass it with the receipt.',
          400,
          'RECEIVE_LOCATION_REQUIRED',
        );
      }

      // ── Arrival registration gate ─────────────────────────────────────────
      // **[OFFICIAL]** "Registration requirements" blocks a product receipt until
      // an arrival registration exists.
      const needRegistration = requested.filter(r => {
        const line = po.lines.find(l => l.id === r.po_line_id);
        return line && policies.get(line.product_id)?.registrationRequirements;
      });
      if (needRegistration.length > 0) {
        const registered = await tx.arrivalJournal.count({
          where: { tenant_id: tenantId, purchase_order_id: po.id, status: 'POSTED' },
        });
        if (registered === 0) {
          throw new AppError(
            `${needRegistration.length} line(s) require arrival registration before a product ` +
              `receipt can be posted. Post an arrival journal for ${po.po_number} first.`,
            409,
            'REGISTRATION_REQUIRED',
          );
        }
      }

      const receiptNumber = await allocateNumber({
        tenantId, reference: 'PRODUCT_RECEIPT', legalEntityId, tx,
      });

      const receipt = await tx.productReceipt.create({
        data: {
          tenant_id:         tenantId,
          legal_entity_id:   legalEntityId,
          receipt_number:    receiptNumber,
          packing_slip:      input.packing_slip.trim(),
          purchase_order_id: po.id,
          supplier_id:       po.supplier_id,
          warehouse_id:      po.warehouse_id,
          location_id:       locationId,
          status:            'POSTED',
          receipt_date:      input.receipt_date ? new Date(input.receipt_date) : new Date(),
          notes:             input.notes ?? null,
          created_by:        userId,
          posted_at:         new Date(),
          posted_by:         userId,
        },
      });

      // ── Lines: inventory, batches, accumulators ───────────────────────────
      type Priced = {
        poLineId: string;
        productId: string;
        variantId: string | null;
        qty: number;
        unitCost: number;
        netUnitCost: number;
        lineNet: number;
        policy: ItemPolicy | undefined;
        /// Where this line's goods actually landed. Needed by putaway, which must
        /// take them FROM here — **[OFFICIAL]** "the first pick is always from the
        /// location where the registration occurs".
        locationId: string;
      };
      const priced: Priced[] = [];

      for (const [i, r] of requested.entries()) {
        const line = po.lines.find(l => l.id === r.po_line_id);
        if (!line) throw new AppError(`Purchase order line ${r.po_line_id} is not on ${po.po_number}`, 400);

        const qty = Number(r.quantity);
        if (!(qty > 0)) throw new AppError('A receipt line needs a quantity greater than zero.', 400);

        const outstanding = Number(line.quantity) - Number(line.received_qty);
        if (qty > outstanding + 1e-9) {
          throw new AppError(
            `Cannot receive ${qty} of that line — only ${outstanding} is outstanding on ${po.po_number}. ` +
              `Over-delivery must be handled by amending the order, so the order stays the record of what was agreed.`,
            409,
            'OVER_RECEIPT',
          );
        }

        const unitCost = Number(line.unit_cost);
        const grossLine = Number((qty * unitCost).toFixed(2));
        const net = await netOf(tenantId, grossLine, po.supplier_id, tx);
        const netUnitCost = qty !== 0 ? Number((net / qty).toFixed(4)) : 0;

        priced.push({
          poLineId: line.id,
          productId: line.product_id,
          variantId: line.variant_id ?? null,
          qty,
          unitCost,
          netUnitCost,
          lineNet: net,
          policy: policies.get(line.product_id),
          locationId: r.location_id ?? locationId,
        });

        await tx.productReceiptLine.create({
          data: {
            receipt_id:      receipt.id,
            po_line_id:      line.id,
            product_id:      line.product_id,
            variant_id:      line.variant_id ?? null,
            quantity:        qty,
            unit_cost:       unitCost,
            net_unit_cost:   netUnitCost,
            line_net_amount: net,
            location_id:     r.location_id ?? locationId,
            sort_order:      i,
          },
        });

        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { received_qty: { increment: qty } },
        });

        // A not-stocked line closes the document but keeps no inventory.
        if (policies.get(line.product_id)?.stocked === false) continue;

        const lineLocation = r.location_id ?? locationId;
        const existing = await tx.inventoryStock.findFirst({
          where: {
            tenant_id: tenantId, product_id: line.product_id,
            variant_id: line.variant_id ?? null, location_id: lineLocation,
          },
        });
        if (existing) {
          await tx.inventoryStock.update({ where: { id: existing.id }, data: { quantity: { increment: qty } } });
        } else {
          await tx.inventoryStock.create({
            data: {
              tenant_id: tenantId, product_id: line.product_id,
              variant_id: line.variant_id ?? null, location_id: lineLocation,
              quantity: qty, reserved_qty: 0,
            },
          });
        }

        await tx.inventoryTransaction.create({
          data: {
            tenant_id:        tenantId,
            transaction_type: 'PURCHASE_RECEIPT',
            ...physicalStatusFor('PURCHASE_RECEIPT'),
            reference_type:   'PRODUCT_RECEIPT',
            reference_id:     receipt.id,
            reference_number: receipt.receipt_number,
            product_id:       line.product_id,
            variant_id:       line.variant_id ?? null,
            to_location_id:   lineLocation,
            quantity:         qty,
            // The subledger is valued at what capitalises, so it agrees with the GL.
            unit_cost:        netUnitCost,
            notes:            `PO ${po.po_number} · packing slip ${receipt.packing_slip}`,
            performed_by:     userId,
          },
        });

        await tx.inventoryCostLayer.create({
          data: {
            tenant_id:    tenantId,
            product_id:   line.product_id,
            variant_id:   line.variant_id ?? null,
            location_id:  lineLocation,
            source_po_id: po.id,
            po_number:    po.po_number,
            quantity:     qty,
            unit_cost:    netUnitCost,
            received_at:  new Date(),
          },
        });
      }

      // ── Putaway work ──────────────────────────────────────────────────────
      // **[OFFICIAL]** the two-step inbound flow: "the receipt is posted first to
      // record the increase of inventory … The warehouse worker then registers the
      // put-away to make the items available to pick."
      //   learn.microsoft.com/dynamics365/business-central/design-details-inbound-warehouse-flow
      //
      // Until now the receipt WAS the whole story: goods landed in a receiving
      // location and nothing ever moved them, so stock could sit visibly on the
      // dock while a sales order failed for want of it.
      //
      // Only the destination is directive-resolved. **[OFFICIAL]** "during purchase
      // registration, the first pick is always from the location where the
      // registration occurs" — so the source is the receiving location, recorded on
      // the work rather than looked up.
      const whParams = await resolveWarehouseParameters(po.warehouse_id, tx);
      let putawayWork = 0;

      if (whParams.requirePutaway) {
        for (const p of priced) {
          // A not-stocked line has no inventory to put away.
          if (p.policy?.stocked === false) continue;

          const lineLocation = p.locationId;
          const destination = await warehouseService.resolvePutawayLocation(
            tenantId, po.warehouse_id, p.productId, p.qty,
          );

          if (!destination || destination === lineLocation) {
            // No directive matched, or it resolved back to where the goods already
            // are. Creating work that moves nothing would be worse than creating
            // none: it would report a job done and change nothing, which is exactly
            // the failure this whole step exists to remove.
            logger.warn(
              { tenantId, receipt: receiptNumber, product: p.productId, warehouse: po.warehouse_id },
              'Putaway required but no location directive resolved a destination — no work created',
            );
            continue;
          }

          await tx.warehouseWork.create({
            data: {
              tenant_id:      tenantId,
              // Derived from the receipt rather than drawn from a NumberSequence:
              // `WAREHOUSE_WORK` is not a configured sequence reference, and adding
              // one is a setup decision, not something to slip in here. The code is
              // unique because the receipt number is.
              work_id_code:   `WRK-PA-${receiptNumber}-${putawayWork + 1}`,
              work_type:      'PUTAWAY',
              status:         'OPEN',
              warehouse_id:   po.warehouse_id,
              reference_type: 'PRODUCT_RECEIPT',
              reference_id:   receipt.id,
              priority:       3,
              lines: {
                create: [{
                  sequence:         1,
                  line_type:        'PUT',
                  product_id:       p.productId,
                  variant_id:       p.variantId,
                  quantity:         p.qty,
                  from_location_id: lineLocation,
                  to_location_id:   destination,
                  status:           'PENDING',
                }],
              },
            },
          });
          putawayWork++;
        }

        logger.info(
          { tenantId, receipt: receiptNumber, putawayWork },
          'Putaway work created for product receipt',
        );
      }

      // ── Order status ──────────────────────────────────────────────────────
      const refreshed = await tx.purchaseOrderLine.findMany({
        where: { po_id: po.id }, select: { quantity: true, received_qty: true },
      });
      const fullyReceived = refreshed.every(l => Number(l.received_qty) >= Number(l.quantity) - 1e-9);
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status:              fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
          received_at:         fullyReceived ? new Date() : po.received_at,
          received_by:         userId,
          receive_location_id: locationId,
        },
      });

      // ── The physical voucher ──────────────────────────────────────────────
      const accrued = Number(
        priced
          .filter(p => p.policy?.postPhysicalInventory !== false && p.policy?.accrueLiabilityOnReceipt !== false)
          .reduce((s, p) => s + p.lineNet, 0)
          .toFixed(2),
      );

      let journalId: string | null = null;
      let note: string;

      if (!postToLedger) {
        // The tenant has not moved to the split yet. Reproduce the single voucher
        // it has always posted — inventory, recoverable tax and payable together —
        // so switching this feature on is a decision, not something that happened
        // to a tenant's books the day the code shipped.
        journalId = await postLegacyCombinedVoucher(tx, {
          tenantId, legalEntityId, userId, receiptId: receipt.id,
          receiptNumber: receipt.receipt_number, poNumber: po.po_number, purchaseOrderId: po.id,
          supplierId: po.supplier_id, priced,
        });
        note =
          'Posted the legacy single voucher (inventory, recoverable tax and payable together), ' +
          'because post_product_receipt_in_ledger is off for this tenant. Recoverable tax is ' +
          'therefore still recognised at receipt rather than against the vendor factura. Turn the ' +
          'parameter on to separate the physical and financial updates.';
      } else if (accrued === 0) {
        note =
          'No receipt voucher: every line belongs to an item model group with post_physical_inventory ' +
          'or accrue_liability_on_receipt switched off.';
      } else {
        journalId = await postReceiptVoucher(tx, {
          tenantId, legalEntityId, userId, receiptId: receipt.id,
          receiptNumber: receipt.receipt_number, poNumber: po.po_number, purchaseOrderId: po.id,
          supplierId: po.supplier_id, priced, accrued,
        });
        note = journalId
          ? 'Physical update posted: inventory debited, purchase accrual credited. Tax and payable follow the invoice.'
          : 'Receipt voucher skipped — posting profiles unresolved and require_balanced_posting is off.';
      }

      if (journalId) {
        await tx.productReceipt.update({ where: { id: receipt.id }, data: { journal_entry_id: journalId } });
      }

      return {
        id: receipt.id,
        receipt_number: receipt.receipt_number,
        journal_entry_id: journalId,
        accrued_amount: accrued,
        lines: priced.length,
        posting_note: note,
      };
    },
    { timeout: 60_000, maxWait: 20_000 },
  );
}

/**
 * DR inventory (split by item group) / DR purchase expenditure for not-stocked
 * lines, CR purchase accrual. One voucher, not D365's two — the second exists to
 * carry a standard-cost variance we do not have under FIFO. Same posting types,
 * so adding standard cost later adds accounts rather than a redesign.
 */
async function postReceiptVoucher(
  tx: Tx,
  ctx: {
    tenantId: string;
    legalEntityId: string | null;
    userId: string;
    receiptId: string;
    receiptNumber: string;
    poNumber: string;
    purchaseOrderId: string;
    supplierId: string;
    priced: { productId: string; lineNet: number; policy: ItemPolicy | undefined }[];
    accrued: number;
  },
): Promise<string | null> {
  const document = `Product receipt ${ctx.receiptNumber}`;

  const base = await resolvePostingAccounts_orExplain(ctx.tenantId, ['PURCHASE_ACCRUAL'] as const, {
    document, partyId: ctx.supplierId, legalEntityId: ctx.legalEntityId, client: tx,
  });
  if (!base) return null;

  const postable = ctx.priced.filter(
    p => p.policy?.postPhysicalInventory !== false && p.policy?.accrueLiabilityOnReceipt !== false,
  );
  const stocked = postable.filter(p => p.policy?.stocked !== false);
  const expensed = postable.filter(p => p.policy?.stocked === false);

  const policyMap = new Map(postable.map(p => [p.productId, p.policy!]).filter(([, v]) => !!v) as [string, ItemPolicy][]);
  const debits: { account_id: string; debit_amount: number; credit_amount: number; description: string }[] = [];

  for (const bucket of groupByItemGroup(stocked, policyMap, l => l.productId, l => l.lineNet)) {
    if (bucket.amount <= 0) continue;
    const acc = await resolvePostingAccounts_orExplain(ctx.tenantId, ['INVENTORY'] as const, {
      document: `${document}${bucket.itemGroupCode ? ` (${bucket.itemGroupCode})` : ''}`,
      partyId: ctx.supplierId, itemGroupId: bucket.itemGroupId ?? undefined,
      legalEntityId: ctx.legalEntityId, client: tx,
    });
    if (!acc) return null;
    debits.push({
      account_id: acc.INVENTORY,
      debit_amount: bucket.amount,
      credit_amount: 0,
      description: `Inventory received${bucket.itemGroupCode ? ` [${bucket.itemGroupCode}]` : ''} — ${ctx.poNumber}`,
    });
  }

  const expensedAmount = Number(expensed.reduce((s, p) => s + p.lineNet, 0).toFixed(2));
  if (expensedAmount > 0) {
    // **[OFFICIAL]** "Purchase expenditure for expense … used when posting a
    // product receipt or invoice for a purchase order where the items aren't
    // stocked". Previously this landed in COGS, which was the closest configured
    // account rather than the right one.
    const acc = await resolvePostingAccounts_orExplain(ctx.tenantId, ['PURCHASE_EXPENSE'] as const, {
      document: `${document} (not stocked)`, partyId: ctx.supplierId,
      legalEntityId: ctx.legalEntityId, client: tx,
    });
    if (!acc) return null;
    debits.push({
      account_id: acc.PURCHASE_EXPENSE,
      debit_amount: expensedAmount,
      credit_amount: 0,
      description: `Expensed (not stocked) — ${ctx.poNumber}`,
    });
  }

  if (debits.length === 0) return null;

  // Rounding guard — an unbalanced voucher is worse than a cent in the wrong bucket.
  const debited = Number(debits.reduce((s, d) => s + d.debit_amount, 0).toFixed(2));
  if (debited !== ctx.accrued) {
    debits[0].debit_amount = Number((debits[0].debit_amount + (ctx.accrued - debited)).toFixed(2));
  }

  const entry = await postJournal({
    tenantId:      ctx.tenantId,
    legalEntityId: ctx.legalEntityId,
    tx,
    description:   `Product receipt: ${ctx.receiptNumber} (${ctx.poNumber})`,
    source:        { module: 'PRODUCT_RECEIPT', id: ctx.receiptId },
    userId:        ctx.userId,
    dimensions:    await contextForPurchaseOrder(ctx.tenantId, ctx.purchaseOrderId, tx),
    lines: [
      ...debits.map(d => ({
        accountId:   d.account_id,
        debit:       d.debit_amount,
        credit:      d.credit_amount,
        description: d.description,
      })),
      {
        accountId:   base.PURCHASE_ACCRUAL,
        credit:      ctx.accrued,
        description: `Goods received not invoiced — ${ctx.poNumber}`,
      },
    ],
  });

  logger.info(
    { tenantId: ctx.tenantId, receipt: ctx.receiptNumber, voucher: entry.entry_number, accrued: ctx.accrued },
    'Product receipt posted (physical update)',
  );
  return entry.id;
}

/**
 * The pre-split voucher, kept verbatim in behaviour for tenants that have not
 * migrated: inventory (or expense) debited net, recoverable tax debited, payable
 * credited — all at receipt.
 *
 * This is not the correct accounting and it is not the recommended configuration.
 * It exists so that shipping the split changes nobody's books until they choose
 * it. The only deliberate difference from what shipped before is that not-stocked
 * lines now reach PURCHASE_EXPENSE instead of COGS, which was previously "the
 * closest configured account" rather than the right one.
 */
async function postLegacyCombinedVoucher(
  tx: Tx,
  ctx: {
    tenantId: string;
    legalEntityId: string | null;
    userId: string;
    receiptId: string;
    receiptNumber: string;
    poNumber: string;
    purchaseOrderId: string;
    supplierId: string;
    priced: { productId: string; lineNet: number; unitCost: number; qty: number; policy: ItemPolicy | undefined }[];
  },
): Promise<string | null> {
  const document = `Product receipt ${ctx.receiptNumber} (legacy combined posting)`;

  const acc = await resolvePostingAccounts_orExplain(ctx.tenantId, ['VAT_INPUT', 'AP'] as const, {
    document, partyId: ctx.supplierId, legalEntityId: ctx.legalEntityId, client: tx,
  });
  if (!acc) return null;

  const gross = Number(ctx.priced.reduce((s, p) => s + p.qty * p.unitCost, 0).toFixed(2));
  const net = Number(ctx.priced.reduce((s, p) => s + p.lineNet, 0).toFixed(2));
  const tax = Number((gross - net).toFixed(2));

  const stocked = ctx.priced.filter(p => p.policy?.stocked !== false);
  const expensed = ctx.priced.filter(p => p.policy?.stocked === false);
  const policyMap = new Map(
    ctx.priced.filter(p => p.policy).map(p => [p.productId, p.policy!]),
  );

  const debits: { account_id: string; debit_amount: number; credit_amount: number; description: string }[] = [];

  for (const bucket of groupByItemGroup(stocked, policyMap, l => l.productId, l => l.lineNet)) {
    if (bucket.amount <= 0) continue;
    const inv = await resolvePostingAccounts_orExplain(ctx.tenantId, ['INVENTORY'] as const, {
      document, partyId: ctx.supplierId, itemGroupId: bucket.itemGroupId ?? undefined,
      legalEntityId: ctx.legalEntityId, client: tx,
    });
    if (!inv) return null;
    debits.push({
      account_id: inv.INVENTORY,
      debit_amount: bucket.amount,
      credit_amount: 0,
      description: `Inventory${bucket.itemGroupCode ? ` [${bucket.itemGroupCode}]` : ''} — ${ctx.poNumber}`,
    });
  }

  const expensedAmount = Number(expensed.reduce((s, p) => s + p.lineNet, 0).toFixed(2));
  if (expensedAmount > 0) {
    const exp = await resolvePostingAccounts_orExplain(ctx.tenantId, ['PURCHASE_EXPENSE'] as const, {
      document: `${document} (not stocked)`, partyId: ctx.supplierId,
      legalEntityId: ctx.legalEntityId, client: tx,
    });
    if (!exp) return null;
    debits.push({
      account_id: exp.PURCHASE_EXPENSE,
      debit_amount: expensedAmount,
      credit_amount: 0,
      description: `Expensed (not stocked) — ${ctx.poNumber}`,
    });
  }

  if (debits.length === 0) return null;

  const debited = Number(debits.reduce((s, d) => s + d.debit_amount, 0).toFixed(2));
  if (debited !== net) {
    debits[0].debit_amount = Number((debits[0].debit_amount + (net - debited)).toFixed(2));
  }

  const entry = await postJournal({
    tenantId:      ctx.tenantId,
    legalEntityId: ctx.legalEntityId,
    tx,
    description:   `PO Receipt: ${ctx.poNumber}`,
    source:        { module: 'PURCHASE', id: ctx.receiptId },
    userId:        ctx.userId,
    dimensions:    await contextForPurchaseOrder(ctx.tenantId, ctx.purchaseOrderId, tx),
    lines: [
      ...debits.map(d => ({
        accountId:   d.account_id,
        debit:       d.debit_amount,
        credit:      d.credit_amount,
        description: d.description,
      })),
      { accountId: acc.VAT_INPUT, debit:  tax,   description: 'Recoverable input tax' },
      { accountId: acc.AP,        credit: gross, description: `AP — ${ctx.poNumber}` },
    ],
  });
  return entry.id;
}
