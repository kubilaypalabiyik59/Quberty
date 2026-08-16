import 'dotenv/config';
import { db } from '../src/infrastructure/database/client';
import {
  createLead,
  qualifyLead,
  disqualifyLead,
  pipelineSummary,
} from '../src/modules/crm/crm.service';
import {
  createQuotation,
  sendQuotation,
  reviseQuotation,
  confirmQuotation,
} from '../src/modules/sales/quotation.service';
import {
  createRequisition,
  submitRequisition,
  decideRequisition,
  createPurchaseOrderFromRequisition,
} from '../src/modules/purchase/requisition.service';
import {
  createRfqCaseFromRequisition,
  inviteVendors,
  sendRfq,
  recordReply,
  compareReplies,
  awardRfq,
} from '../src/modules/purchase/rfq.service';

/**
 * End-to-end proof that both chains work against the REAL database, with the
 * real services, the real tax engine and the real number sequences — not mocks.
 *
 *   Prospect to Quote   Lead → Opportunity → Quotation → revision → Sales Order
 *   Source to Pay       Requisition → approval → RFQ → 2 bids → award → PO
 *
 * Everything it creates is tagged with a run marker and deleted at the end, so
 * running it twice leaves the database as it found it. It asserts rather than
 * merely printing: a wrong number fails the script.
 *
 *   npx tsx scripts/verifyProcessChain.ts          run and clean up
 *   npx tsx scripts/verifyProcessChain.ts --keep   leave the documents behind
 */

const KEEP = process.argv.includes('--keep');
const MARK = `E2E-${Date.now()}`;

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? ` = ${JSON.stringify(actual)}` : `\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`}`);
}
function note(label: string, value: unknown) {
  console.log(`        ${label}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
}
function heading(s: string) {
  console.log(`\n${'─'.repeat(74)}\n${s}\n${'─'.repeat(74)}`);
}

(async () => {
  const tenant = await db.tenant.findFirst({ select: { id: true, slug: true } });
  if (!tenant) throw new Error('no tenant');
  const user = await db.user.findFirst({ where: { tenant_id: tenant.id }, select: { id: true, email: true } });
  if (!user) throw new Error('no user');
  const products = await db.product.findMany({
    where: { tenant_id: tenant.id, is_active: true },
    select: { id: true, sku: true, name: true, selling_price: true, cost_price: true },
    take: 2,
    orderBy: { sku: 'asc' },
  });
  if (products.length < 2) throw new Error('need at least 2 products');
  const warehouse = await db.warehouse.findFirst({ where: { tenant_id: tenant.id }, select: { id: true, code: true } });
  if (!warehouse) throw new Error('no warehouse');

  console.log(`tenant ${tenant.slug} · user ${user.email} · warehouse ${warehouse.code}`);
  console.log(`products: ${products.map((p) => p.sku).join(', ')}`);
  console.log(`run marker: ${MARK}`);

  // Captured before anything is created, so the regression and cleanup checks
  // compare against reality rather than against numbers hardcoded on the night
  // this script was written.
  const baseline = {
    salesOrders: await db.salesOrder.count({ where: { tenant_id: tenant.id } }),
    purchaseOrders: await db.purchaseOrder.count({ where: { tenant_id: tenant.id } }),
    directSalesOrders: await db.salesOrder.count({
      where: { tenant_id: tenant.id, source_document_type: 'DIRECT' },
    }),
    directPurchaseOrders: await db.purchaseOrder.count({
      where: { tenant_id: tenant.id, source_document_type: 'DIRECT' },
    }),
    journalEntries: await db.journalEntry.count({ where: { tenant_id: tenant.id } }),
    facturas: await db.factura.count({ where: { tenant_id: tenant.id } }),
  };
  console.log(
    `baseline: SO ${baseline.salesOrders} (${baseline.directSalesOrders} DIRECT) · ` +
    `PO ${baseline.purchaseOrders} (${baseline.directPurchaseOrders} DIRECT) · ` +
    `JE ${baseline.journalEntries} · facturas ${baseline.facturas}`,
  );

  const created = {
    leadIds: [] as string[],
    quotationIds: [] as string[],
    orderIds: [] as string[],
    opportunityIds: [] as string[],
    requisitionIds: [] as string[],
    rfqIds: [] as string[],
    poIds: [] as string[],
    customerIds: [] as string[],
  };

  /* ══════════════════ CHAIN 1 — Prospect to Quote (85) ══════════════════ */

  heading('CHAIN 1  Lead → Opportunity → Quotation → Sales Order');

  const lead = await createLead(
    tenant.id,
    {
      company_name: `Calzados del Sur SRL ${MARK}`,
      first_name: 'Mariana',
      last_name: 'Rojas',
      email: 'mariana@calzadosdelsur.bo',
      phone: '+591 700 11223',
      city: 'Santa Cruz',
      country: 'BO',
      source: 'REFERRAL',
      rating: 'HOT',
      estimated_amount: 12000,
      notes: `verification run ${MARK}`,
    },
    user.id,
  );
  created.leadIds.push(lead.id);
  check('lead created OPEN', lead.status, 'OPEN');
  note('lead number', lead.lead_number);

  // A lead with no opportunity may be disqualified; one with an opportunity may
  // not. Prove the first, then qualify and prove the second.
  const throwaway = await createLead(
    tenant.id,
    { first_name: 'Throwaway', company_name: `Dead lead ${MARK}`, source: 'WEB' },
    user.id,
  );
  created.leadIds.push(throwaway.id);
  const disq = await disqualifyLead(tenant.id, throwaway.id, 'Out of territory');
  check('lead without opportunities can be disqualified', disq.status, 'DISQUALIFIED');

  const qualified = await qualifyLead(
    tenant.id,
    lead.id,
    { opportunity_name: `Wholesale order — Calzados del Sur ${MARK}`, estimated_amount: 12000 },
    user.id,
  );
  created.customerIds.push(qualified.customer_id!);
  created.opportunityIds.push(qualified.opportunity!.id);
  check('lead is QUALIFIED', qualified.lead.status, 'QUALIFIED');
  check('customer was created from the lead', Boolean(qualified.customer_id), true);
  check('opportunity created', Boolean(qualified.opportunity), true);
  check('opportunity seeded probability from the first stage', qualified.opportunity!.probability, 20);
  // The bug migration 006 exists to fix: the party moves to the customer, so the
  // origin has to live in its own column or it is destroyed by qualification.
  check('opportunity party moved to the customer', qualified.opportunity!.customer_id, qualified.customer_id);
  check('opportunity still records the lead it came from', qualified.opportunity!.originating_lead_id, lead.id);
  note('opportunity number', qualified.opportunity!.opportunity_number);

  const custRow = await db.customer.findUnique({ where: { id: qualified.customer_id! } });
  note('customer code', custRow?.code);

  // [OFFICIAL] a lead with an opportunity cannot be disqualified.
  let refused = false;
  try {
    await disqualifyLead(tenant.id, lead.id, 'should not work');
  } catch {
    refused = true;
  }
  check('lead WITH an opportunity refuses disqualification', refused, true);

  // Quotation against the opportunity, priced from the real product list.
  const qLines = [
    { product_id: products[0].id, quantity: 6, unit_price: Number(products[0].selling_price) },
    { product_id: products[1].id, quantity: 4, unit_price: Number(products[1].selling_price) },
  ];
  const expectedGross = Number(
    qLines.reduce((s, l) => s + Number((l.quantity * l.unit_price).toFixed(2)), 0).toFixed(2),
  );

  const quotation = await createQuotation(
    tenant.id,
    {
      customer_id: qualified.customer_id!,
      opportunity_id: qualified.opportunity!.id,
      warehouse_id: warehouse.id,
      notes: `verification run ${MARK}`,
      lines: qLines,
    },
    user.id,
  );
  created.quotationIds.push(quotation.id);
  check('quotation created DRAFT', quotation.status, 'DRAFT');
  check('quotation gross equals the sum of its lines', Number(quotation.subtotal), expectedGross);
  note('quotation number', quotation.quotation_number);
  note('valid until', quotation.valid_until?.toISOString().slice(0, 10));

  // [OFFICIAL] Ley 843 art. 5 + art. 7: the IVA is inside the invoiced price and
  // the 13% is applied to that price. So the tax is 13% OF THE GROSS, not
  // `gross − gross/1,13` (which is 11,50% and is what this engine used to do).
  const iva = Number(quotation.tax_amount);
  const expectedIva = Number((expectedGross * 0.13).toFixed(2));
  check('IVA is 13% of the invoiced amount (IVA por dentro)', iva, expectedIva);
  note('gross / net / IVA', `${expectedGross} / ${(expectedGross - iva).toFixed(2)} / ${iva}`);
  note('effective burden on the true net',
    `${(((iva) / (expectedGross - iva)) * 100).toFixed(4)}% — the published 14,9425%`);

  const sent = await sendQuotation(tenant.id, quotation.id);
  check('quotation SENT', sent.status, 'SENT');

  // Revising must preserve the original rather than editing it.
  const revised = await reviseQuotation(tenant.id, quotation.id, user.id);
  created.quotationIds.push(revised.id);
  const original = await db.salesQuotation.findUnique({ where: { id: quotation.id } });
  check('original quotation retired as REVISED', original!.status, 'REVISED');
  check('revision is a NEW document', revised.id !== quotation.id, true);
  check('revision number incremented', revised.revision, 1);
  check('revision points back at its predecessor', revised.revised_from_id, quotation.id);
  note('revision number', revised.quotation_number);

  const confirmed = await confirmQuotation(tenant.id, revised.id, user.id);
  created.orderIds.push(confirmed.order.id);
  check('sales order created from the quotation', Boolean(confirmed.order.id), true);
  check('order provenance recorded', confirmed.order.source_document_type, 'QUOTATION');
  check('order points at the quotation', confirmed.order.source_document_id, revised.id);
  check('order channel unchanged', confirmed.order.source, 'manual');
  check('order starts DRAFT like every other order', confirmed.order.status, 'DRAFT');
  check('order total equals the quoted total', Number(confirmed.order.total_amount), Number(revised.total_amount));
  note('order number', confirmed.order.order_number);

  const orderLines = await db.salesOrderLine.findMany({ where: { order_id: confirmed.order.id } });
  check('every order line carries line-level provenance', orderLines.every((l) => l.source_line_id !== null), true);

  const quotationAfter = await db.salesQuotation.findUnique({ where: { id: revised.id } });
  check('quotation CONFIRMED', quotationAfter!.status, 'CONFIRMED');
  check('quotation links forward to the order', quotationAfter!.converted_order_id, confirmed.order.id);

  const oppAfter = await db.opportunity.findUnique({ where: { id: qualified.opportunity!.id } });
  check('opportunity closed WON by the confirmation', oppAfter!.status, 'WON');
  check('won opportunity is 100% probable', oppAfter!.probability, 100);

  const pipeline = await pipelineSummary(tenant.id);
  note('pipeline stages configured', pipeline.stages.length);
  note('open weighted pipeline', pipeline.weighted);

  /* ══════════════════ CHAIN 2 — Source to Pay (75) ══════════════════════ */

  heading('CHAIN 2  Requisition → RFQ → 2 bids → award → Purchase Order');

  const requisition = await createRequisition(
    tenant.id,
    {
      warehouse_id: warehouse.id,
      justification: `Winter restock — verification run ${MARK}`,
      required_date: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      lines: [
        { product_id: products[0].id, quantity: 20, estimated_unit_cost: Number(products[0].cost_price ?? 100) },
        { product_id: products[1].id, quantity: 10, estimated_unit_cost: Number(products[1].cost_price ?? 80) },
      ],
    },
    user.id,
  );
  created.requisitionIds.push(requisition.id);
  check('requisition created DRAFT', requisition.status, 'DRAFT');
  check('requisition has 2 lines', requisition.lines.length, 2);
  note('requisition number', requisition.requisition_number);
  note('estimated total', Number(requisition.estimated_total));

  const submitted = await submitRequisition(tenant.id, requisition.id, user.id);
  check('submitted requisition goes IN_REVIEW', submitted!.status, 'IN_REVIEW');
  check('every line goes IN_REVIEW with it', submitted!.lines.every((l) => l.status === 'IN_REVIEW'), true);

  // Approve one line only — the case a header-only status cannot express.
  const partly = await decideRequisition(tenant.id, requisition.id, 'APPROVED', user.id, {
    line_ids: [submitted!.lines[0].id],
  });
  check('header stays IN_REVIEW while a line is unreviewed', partly!.status, 'IN_REVIEW');

  const fully = await decideRequisition(tenant.id, requisition.id, 'APPROVED', user.id);
  check('header becomes APPROVED once review finishes', fully!.status, 'APPROVED');

  // Source it before ordering.
  const rfq = await createRfqCaseFromRequisition(
    tenant.id,
    requisition.id,
    { title: `Winter restock sourcing ${MARK}` },
    user.id,
  );
  created.rfqIds.push(rfq.id);
  check('RFQ type is set automatically from the requisition', rfq.purchase_type, 'PURCHASE_REQUISITION');
  check('RFQ inherits the requisition lines', rfq.lines.length, 2);
  check('RFQ case lines point back at requisition lines', rfq.lines.every((l) => l.requisition_line_id !== null), true);
  note('RFQ number', rfq.rfq_number);

  // Two vendors. The tenant has one supplier, so a second is created for the run.
  const existingSupplier = await db.supplier.findFirst({
    where: { tenant_id: tenant.id, code: { not: { startsWith: 'E2E-' } } },
    select: { id: true, code: true, name: true },
  });
  if (!existingSupplier) throw new Error('need at least one real supplier');

  // ONE rival, reused across runs. An earlier version minted a new supplier every
  // time, so each `--keep` run left another "Proveedor Rival" behind and the
  // supplier list slowly filled with test data.
  const RIVAL_CODE = 'E2E-RIVAL';
  const rival =
    (await db.supplier.findFirst({ where: { tenant_id: tenant.id, code: RIVAL_CODE } })) ??
    (await db.supplier.create({
      data: {
        tenant_id: tenant.id,
        code: RIVAL_CODE,
        name: 'Proveedor Rival (verification fixture)',
        country: 'BO',
        currency: 'BOB',
      },
    }));
  const supplierIds = [existingSupplier!.id, rival.id];

  await inviteVendors(tenant.id, rfq.id, supplierIds);
  const afterInvite = await sendRfq(tenant.id, rfq.id);
  check('RFQ case SENT', afterInvite.status, 'SENT');
  check('two vendors invited', afterInvite.requests.length, 2);
  check('aggregate status after sending is SENT..SENT', [afterInvite.lowest_status, afterInvite.highest_status], ['SENT', 'SENT']);

  // Bid A — cheaper on line 1, slower. Bid B — dearer, faster.
  const reqA = afterInvite.requests.find((r) => r.supplier_id === existingSupplier!.id)!;
  const reqB = afterInvite.requests.find((r) => r.supplier_id === rival.id)!;

  // Prices chosen so the two bid TOTALS differ and each vendor is cheapest on a
  // different line — otherwise "the award used the winning bid's numbers" would
  // pass by coincidence.
  const bidA = await recordReply(tenant.id, reqA.id, {
    score: 70,
    lead_time_days: 30,
    lines: rfq.lines.map((l, i) => ({ case_line_id: l.id, unit_price: i === 0 ? 90 : 75, lead_time_days: 30 })),
  });
  check('bid A registered as RECEIVED', bidA.status, 'RECEIVED');
  check('bid A total is the sum of its lines', Number(bidA.total_amount), 20 * 90 + 10 * 75); // 2550

  const bidB = await recordReply(tenant.id, reqB.id, {
    score: 90,
    lead_time_days: 10,
    lines: rfq.lines.map((l, i) => ({ case_line_id: l.id, unit_price: i === 0 ? 95 : 60, lead_time_days: 10 })),
  });
  check('bid B total', Number(bidB.total_amount), 20 * 95 + 10 * 60); // 2500
  check('the two bids differ, so the award assertion is meaningful',
    Number(bidA.total_amount) !== Number(bidB.total_amount), true);

  const midway = await compareReplies(tenant.id, rfq.id);
  check('comparison covers both demand lines', midway.lines.length, 2);
  check('comparison shows both vendors', midway.vendors.length, 2);
  check('cheapest on line 1 is vendor A', midway.lines[0].best_request_id, reqA.id);
  check('cheapest on line 2 is vendor B', midway.lines[1].best_request_id, reqB.id);
  check('aggregate after both replies is RECEIVED..RECEIVED', [midway.lowest_status, midway.highest_status], ['RECEIVED', 'RECEIVED']);

  // Award vendor B on everything — the dearer bid, chosen on lead time. That is
  // the point of recording score and lead time next to price.
  const award = await awardRfq(
    tenant.id,
    rfq.id,
    reqB.id,
    { reason_code: 'Fastest delivery', reject_others: true },
    user.id,
  );
  created.poIds.push(award.purchase_order.id);
  check('purchase order generated from the award', Boolean(award.purchase_order.id), true);
  check('PO provenance is RFQ', award.purchase_order.source_document_type, 'RFQ');
  check('PO points at the RFQ case', award.purchase_order.source_document_id, rfq.id);
  check('PO supplier is the awarded vendor', award.purchase_order.supplier_id, rival.id);
  check('PO subtotal is the winning bid total', Number(award.purchase_order.subtotal), Number(bidB.total_amount));
  check('PO lines carry bid-line provenance', award.purchase_order.lines.every((l) => l.source_line_id !== null), true);
  note('PO number', award.purchase_order.po_number);

  // ── The purchase arithmetic, now coherent ───────────────────────────────
  //
  // It used to decompose IVA out of the subtotal and then add it straight back
  // on: Bs 2 500 → tax 287,61 → total 2 787,61, an effective 11,5% and a total
  // that was neither the net nor the gross.
  //
  // Under Ley 843 a supplier's factura carries ONE amount with the IVA inside
  // it, and the buyer's crédito fiscal is 13% of that invoiced amount. So the
  // agreed figure IS the gross: AP owes it in full, 13% of it is recoverable,
  // and the remainder capitalises into inventory.
  const agreed = Number(award.purchase_order.subtotal);
  const poTax = Number(award.purchase_order.tax_amount);
  const poTotal = Number(award.purchase_order.total_amount);

  check('crédito fiscal is 13% of the invoiced amount', poTax, Number((agreed * 0.13).toFixed(2)));
  check('AP owes the supplier the invoiced amount, nothing added on top', poTotal, agreed);
  check('the effective purchase tax rate is exactly 13%',
    Number(((poTax / agreed) * 100).toFixed(2)), 13);
  note('capitalises to inventory (gross − recoverable IVA)', (poTotal - poTax).toFixed(2));

  check('requisition closed by the award', award.requisition_status, 'CLOSED');

  const reqLinesAfter = await db.purchaseRequisitionLine.findMany({
    where: { requisition_id: requisition.id },
    orderBy: { sort_order: 'asc' },
  });
  check('requisition lines CLOSED', reqLinesAfter.every((l) => l.status === 'CLOSED'), true);
  check('winning price written back onto the requisition', Number(reqLinesAfter[0].estimated_unit_cost), 95);
  check('winning vendor written back onto the requisition', reqLinesAfter[0].preferred_supplier_id, rival.id);
  check('requisition line records what fulfilled it', reqLinesAfter[0].fulfilled_by_type, 'RFQ');

  const loser = await db.rfqRequest.findUnique({ where: { id: reqA.id } });
  check('losing bid rejected', loser!.status, 'REJECTED');

  const rfqAfter = await db.rfqCase.findUnique({ where: { id: rfq.id } });
  check('RFQ case closed — nothing left open', rfqAfter!.status, 'CLOSED');

  // The comparison must still justify the decision AFTER the award. Awarding
  // flips the losing bids to REJECTED; if "cheapest" only counted RECEIVED bids
  // the marker would jump onto the winner and the record of why a dearer vendor
  // was chosen would be erased.
  // A requisition sourced through a tender must still lead to its order. The
  // awarded PO points at the RFQ CASE, not the requisition, so following only
  // REQUISITION provenance makes the requisition look like it produced nothing.
  const reachable = await db.purchaseOrder.findMany({
    where: {
      tenant_id: tenant.id,
      OR: [
        { source_document_type: 'REQUISITION', source_document_id: requisition.id },
        { source_document_type: 'RFQ', source_document_id: rfq.id },
      ],
    },
    select: { id: true, po_number: true },
  });
  check('the order is reachable from the requisition through its tender',
    reachable.map((p) => p.po_number), [award.purchase_order.po_number]);

  const afterAward = await compareReplies(tenant.id, rfq.id);
  check('cheapest on line 1 is STILL vendor A after the award', afterAward.lines[0].best_request_id, reqA.id);
  check('the awarded vendor was NOT the cheapest on line 1 — and the matrix still says so',
    afterAward.lines[0].best_request_id !== reqB.id, true);

  /* ══════════════════ REGRESSION — the old paths still work ═════════════ */

  heading('REGRESSION  nothing pre-existing moved');

  // The new orders carry QUOTATION / RFQ provenance, so the DIRECT count must be
  // exactly what it was: no historical row was touched or reclassified.
  const directSO = await db.salesOrder.count({
    where: { tenant_id: tenant.id, source_document_type: 'DIRECT' },
  });
  const directPO = await db.purchaseOrder.count({
    where: { tenant_id: tenant.id, source_document_type: 'DIRECT' },
  });
  check('every pre-existing sales order still reads DIRECT', directSO, baseline.directSalesOrders);
  check('every pre-existing purchase order still reads DIRECT', directPO, baseline.directPurchaseOrders);

  // The whole upstream chain is pre-financial. If any of it had touched the
  // ledger, these two would have moved.
  const je = await db.journalEntry.count({ where: { tenant_id: tenant.id } });
  const fac = await db.factura.count({ where: { tenant_id: tenant.id } });
  check('no journal entry was created by any of this', je, baseline.journalEntries);
  check('no factura was created by any of this', fac, baseline.facturas);

  /* ══════════════════════════════ cleanup ═══════════════════════════════ */

  if (KEEP) {
    heading('KEEPING the documents (--keep). Numbers above are live in the UI.');
  } else {
    heading('CLEANUP');
    // Order matters: children before parents, and the FK from quotation to order
    // has to be broken before the order can go.
    await db.salesQuotation.updateMany({
      where: { id: { in: created.quotationIds } },
      data: { converted_order_id: null },
    });
    await db.salesOrderLine.deleteMany({ where: { order_id: { in: created.orderIds } } });
    await db.salesOrder.deleteMany({ where: { id: { in: created.orderIds } } });
    await db.salesQuotation.deleteMany({ where: { id: { in: created.quotationIds } } });
    await db.opportunity.deleteMany({ where: { id: { in: created.opportunityIds } } });
    await db.lead.deleteMany({ where: { id: { in: created.leadIds } } });
    await db.customer.deleteMany({ where: { id: { in: created.customerIds } } });

    await db.purchaseOrderLine.deleteMany({ where: { po_id: { in: created.poIds } } });
    await db.purchaseOrder.deleteMany({ where: { id: { in: created.poIds } } });
    await db.rfqCase.deleteMany({ where: { id: { in: created.rfqIds } } });
    await db.purchaseRequisition.deleteMany({ where: { id: { in: created.requisitionIds } } });
    // Only if nothing else references it — the fixture is reused across runs and
    // a `--keep` run may have left a purchase order pointing at it.
    const rivalPos = await db.purchaseOrder.count({ where: { supplier_id: rival.id } });
    if (rivalPos === 0) await db.supplier.deleteMany({ where: { id: rival.id } });

    // Scoped to THIS run's ids, not to global counts. A previous `--keep` run
    // leaves documents behind on purpose, and a global "must be zero" assertion
    // would fail for a reason that has nothing to do with correctness.
    const leftLeads = await db.lead.count({ where: { id: { in: created.leadIds } } });
    const leftQuotes = await db.salesQuotation.count({ where: { id: { in: created.quotationIds } } });
    const leftReqs = await db.purchaseRequisition.count({ where: { id: { in: created.requisitionIds } } });
    const leftRfq = await db.rfqCase.count({ where: { id: { in: created.rfqIds } } });
    const leftOrders = await db.salesOrder.count({ where: { id: { in: created.orderIds } } });
    const leftPos = await db.purchaseOrder.count({ where: { id: { in: created.poIds } } });
    check('leads this run left behind', leftLeads, 0);
    check('quotations this run left behind', leftQuotes, 0);
    check('requisitions this run left behind', leftReqs, 0);
    check('RFQ cases this run left behind', leftRfq, 0);
    check('sales orders this run left behind', leftOrders, 0);
    check('purchase orders this run left behind', leftPos, 0);

    const soAfter = await db.salesOrder.count({ where: { tenant_id: tenant.id } });
    const poAfter = await db.purchaseOrder.count({ where: { tenant_id: tenant.id } });
    check('sales orders back to the baseline this run started from', soAfter, baseline.salesOrders);
    check('purchase orders back to the baseline this run started from', poAfter, baseline.purchaseOrders);
  }

  heading(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('\nERROR:', e.message);
  console.error(e.stack?.split('\n').slice(1, 5).join('\n'));
  await db.$disconnect();
  process.exit(1);
});
