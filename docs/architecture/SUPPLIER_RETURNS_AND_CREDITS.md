# Supplier Returns and Credits

**Work item:** WORK-019
**Status:** Implemented and accepted on Supabase TEST
**Date:** 2026-09-10

## 1. Business-process position

- **[OFFICIAL DOCUMENTATION]** `75.40.070.000 Manage supplier returns` is the physical return
  outcome in Source to pay, while `75.50.080.000 Receive supplier credits` is the accounts-payable
  outcome. The latter is explicitly one of the Manage accounts payable subprocesses:
  https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-manage-accounts-payable-overview
- **[OFFICIAL DOCUMENTATION]** A purchase return may cover all or part of received goods. The
  documented flow creates a return PO through the Credit note action, copies the original vendor
  invoice precisely with inverted quantities, marks each return line against the original inventory
  transaction, and records shipment back to the supplier through a product-receipt journal:
  https://learn.microsoft.com/dynamics365/supply-chain/procurement/tasks/create-purchase-return-order
- **[ARCHITECTURAL RECOMMENDATION]** Quberty should preserve that anatomy without reproducing the
  full D365 purchase-order form. An SME user starts from a posted vendor invoice, selects the lines
  and positive quantities to return, selects the current stock location, and receives two linked
  documents: a supplier return for the physical movement and a supplier credit for AP.

## 2. Repository findings

- **[REPO-VERIFIED]** `ProductReceipt` and `VendorInvoice` already split physical and financial
  updates. This is the correct attachment point; a return must preserve the same split rather than
  mutating either posted document.
- **[REPO-VERIFIED]** `VendorInvoiceMatch` links invoice lines to exact receipt lines and quantities.
  It supplies the provenance needed to prevent a return from exceeding what was invoiced and
  received.
- **[REPO-VERIFIED]** `InventoryTransaction` records physical and financial statuses, but a receipt
  line does not currently retain its exact inventory-transaction identifier. The return line must
  therefore keep the receipt-line FK as its durable marking. New receipt-line-to-inventory links are
  a useful later hardening hook, not a prerequisite for the bounded flow.
- **[REPO-VERIFIED]** `VendorOpenTransaction.source_type` already reserves `SUPPLIER_CREDIT`, and the
  settlement ledger already accepts a DEBIT against an invoice CREDIT. The missing part is the
  supplier-credit document and posting service.
- **[REPO-VERIFIED]** The current posted-invoice cancellation route refuses mutation and tells the
  user to use a credit note. That is a sound boundary, but no supplier return or credit workflow
  exists behind it.

## 3. Bounded SME flow

1. **Create from invoice.** Only a posted BOB vendor invoice is eligible. The request names one or
   more invoice lines and positive return quantities. The service copies supplier, legal entity,
   currency, product, variant, original unit price, original tax share, and receipt provenance.
2. **Prove physical provenance.** A stocked return line must be allocated to one or more
   `VendorInvoiceMatch` receipt lines. Total return quantity across active returns may never exceed
   the matched quantity. WORK-019 is physical-only; service credits remain deferred.
3. **Ship goods.** A user selects the current warehouse location for each physical line. Posting
   locks stock and cost layers, refuses unavailable or reserved quantity, consumes only cost layers
   originating from the original PO at the frozen receipt net unit cost, records an issue inventory
   transaction, and posts `Dr purchase accrual / Cr inventory` when separate receipt posting is on.
4. **Post supplier credit.** The user records the supplier's credit-note number and date. Posting
   creates `Dr AP / Cr purchase accrual / Cr recoverable input tax`, reverses purchase price
   variance when invoice and receipt costs differ, writes a DEBIT vendor open transaction, and
   settles the exact credit amount against the original invoice.
5. **Audit and correction.** Posted returns and credits are immutable. A later correction is another
   linked reversal document; delete and in-place edits are forbidden.

## 4. Data model

### `PurchaseReturn`

Tenant/legal-entity scoped internal number, supplier, original vendor invoice, warehouse, status,
reason, requested/shipped dates, shipment reference, journal entry, creator/poster, and optional
reversal link.

### `PurchaseReturnLine`

Return, original invoice line, original receipt line, product/variant, selected source location,
positive quantity, frozen gross and net unit costs, gross/net/tax amounts, and sort order. A unique
constraint on `(return_id, original_invoice_line_id, original_receipt_line_id)` prevents duplicate
allocation rows.

### `SupplierCredit`

Tenant/legal-entity scoped internal number, supplier's external credit-note number, original invoice,
optional purchase return, dates, status, currency/functional snapshots, net/tax/total, journal entry,
creator/poster, and optional reversal link.

### `SupplierCreditLine`

Credit, original invoice line, return-line hook, product/variant/description, positive quantity,
frozen unit price and money split, and sort order.

The tables use ordinary typed columns and FKs. No generic EAV or document JSON is introduced.

## 5. Parameters and numbering

- **[ARCHITECTURAL RECOMMENDATION]** `PURCHASE_RETURN` is an internal number sequence owned by
  Purchase Setup. `SUPPLIER_CREDIT` is also an internal sequence. The supplier's fiscal credit-note
  reference is a separate required field and must never consume our sequence.
- **[ARCHITECTURAL RECOMMENDATION]** No new toggle is needed for the first flow. The existing
  `post_product_receipt_in_ledger` parameter decides whether separate physical/accrual posting is
  available.
- **[ARCHITECTURAL RECOMMENDATION]** The first physical implementation fails closed when separate
  receipt posting is off. Correctly reversing the historical combined receipt/invoice mode requires
  document-specific allocation of its combined voucher, which the old records do not contain.

## 6. Bolivia boundary

- **[REPO-VERIFIED]** BOB and recoverable input IVA are already represented and must retain their
  current amounts through a proportional credit.
- **[ASSUMPTION NEEDING VALIDATION]** Which Bolivian supplier credit-note identifiers, CUF/CUFD
  references, authorization fields, issue deadlines, and IVA-book classifications are mandatory is
  not established by Microsoft Learn or this repository.
- **[ARCHITECTURAL RECOMMENDATION]** The bounded flow stores the supplier credit reference and a
  link to the original invoice, but does not claim regulatory filing readiness. Any export to a tax
  purchase ledger remains blocked until a Bolivian authority or the Finance co-founder validates the
  required fields.

## 7. Permissions and forms

Add stable permissions for return read/create/ship and supplier-credit read/create/post. Buyer can
create returns, receiver can ship them, AP clerk can create credits, finance approver can post them,
and auditor remains read-only.

The end-user surface consists of:

- **Purchase > Supplier returns:** list, create-from-invoice dialog, return detail, and Ship action.
- **Purchase > Supplier credits:** list and detail/post action.
- **Vendor invoice detail:** `Create return / credit` action showing remaining eligible quantities.

No setup-only backend capability is considered complete until its owning UI exists.

## 8. Acceptance boundary

The first accepted scenario must prove on Supabase TEST:

1. a partial return copied from a posted invoice and its matched receipt;
2. refusal of duplicate or excess returned quantity;
3. refusal when exact source-cost stock is unavailable or reserved;
4. physical stock and cost-layer reduction plus a balanced return-shipment voucher;
5. supplier-credit posting with a balanced voucher and DEBIT AP open transaction;
6. settlement against the original invoice and correct residual balance;
7. tenant, supplier, legal-entity, currency, and permission isolation;
8. immutable source links from credit to invoice and return to receipt lines.

Cross-currency credits, charges, credit-only stocked-item disputes, combined-mode historical reversal,
warehouse work for outbound staging, and formal Bolivian tax-book export remain deferred. Their
required attachment points exist in the document FKs, currency snapshots, status fields, and source
types; none requires an EAV redesign.

## 9. Acceptance evidence

Migration `029_supplier_returns_and_credits.sql` passed a clean 000–029 isolated Supabase rebuild
with empty Prisma drift, then applied to Supabase TEST as ledger ordinal 29. Permanent harness
`verify:supplier-return` created its source through the ordinary receipt and invoice services and
accepted marker `WORK019-1789045833082`: stock and the exact PO/cost/location layer each decreased
by one, both journals balanced, the 100 BOB supplier credit created a DEBIT AP transaction, exact
settlement closed the source invoice, and immutable invoice/receipt/return links remained present.

Repository validation: backend build, frontend TypeScript, script TypeScript, `git diff --check`,
and 17 suites / 372 tests passed. The historical invoices carrying non-recoverable tax remain
unchanged and correctly fail the bounded guard.
