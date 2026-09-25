# Quberty ERP: manual test cases for Source to Pay and Inventory/Warehouse

I read the frontend pages and backend services and did not run anything. I wrote no files, touched no database, started no servers and did not open `.env`. Every expected result below comes from the code at HEAD `905aeda`. Where the code differs from what the business needs, the test says what the code does and lists the gap under "Suspected defects / gaps".

Catalog areas covered: 75.40 Procure goods and services, 75.50 Manage accounts payable, 75.35 Source and contract, 60.10 Manage warehouse operations, 60.20 Maintain inventory levels, 60.30 Process inbound goods.

## Four facts to know before testing

1. **Foreign-currency purchasing does not work yet.** You can create a purchase order in USD. Every step after that is refused: receipt, arrival, invoice posting, payment, return and credit. Nothing stores or applies an exchange rate. This is planned as WORK-026. So the "USD order with a rate → BOB inventory value" scenario is written as an expected refusal (P2P-023).
2. **The UI covers less than the API.** Several scenarios need a REST client (Postman or curl) with a user token:
   - The receipt screen always receives everything still open. There is no way to enter a quantity per line.
   - The invoice screen always takes its lines from the receipts. You cannot type your own quantity or price.
   - The order screen has no currency field.
   - The Work screen's "Complete" button does not move stock.
   - The "New Journal" button on the arrival screen does nothing.
   - Purchase parameters have no setup screen. An admin has to set them.
3. **Costing is always FIFO** (first in, first out) by cost layer. You can set another costing method on an item model group, but nothing in the code reads it for valuation. Receipts are valued at the order price minus recoverable IVA, per unit, to 4 decimals. The difference between invoice price and receipt price is posted to the `PRICE_VARIANCE` account. It is never pushed back into the stock value.
4. **What posts to the ledger depends on the `post_product_receipt_in_ledger` parameter.**
   - When it is ON ("split" mode): the receipt posts Dr INVENTORY / Cr PURCHASE_ACCRUAL, and the invoice posts Dr PURCHASE_ACCRUAL + Dr VAT_INPUT (± PRICE_VARIANCE) / Cr AP.
   - When it is OFF (the database default, "legacy" mode): the receipt posts Dr INVENTORY + Dr VAT_INPUT / Cr AP in one entry, and the invoice posts no journal entry.
   - Returns only work when it is ON.

## Global test data (used by all cases unless a case says otherwise)

| Item | Value |
|---|---|
| Tenant | `skarpine-demo`. Ledger accounting currency BOB. Supplier tax group has purchase IVA at 13%, included in the price and recoverable. |
| Warehouses | **WH-A** (Store A) with locations `A-RCV-001` (receiving) and `A-STG-001` (storage/pick). **WH-B** (Store B) with location `B-STG-001`. |
| Item | **P1** "Oxford Negro 42", SKU `OXF-42`, no variant, group `STOCKED-FIFO`, no registration or receiving requirements, reorder point 15. |
| Suppliers | **S1** "Calzados Andinos SRL" (BOB), **S2** "Cueros del Sur" (BOB). |
| Users (one per role) | `req.user` purchasing_requester · `buyer.user` buyer · `rcv.user` receiver · `ap.user` ap_clerk · `fin.user` finance_approver · `wh.user` warehouse_worker · `sm.user` store_manager · `admin.user` admin |
| Purchase parameters (split baseline) | `post_product_receipt_in_ledger=true`, `requisition_approval_enabled=true`, threshold empty, `line_matching_policy=THREE_WAY`, `price_tolerance_pct=0.02`, `post_invoice_with_discrepancies=REQUIRE_APPROVAL`, `default_invoice_quantity=PRODUCT_RECEIPT` |
| Posting profiles | INVENTORY, PURCHASE_ACCRUAL, VAT_INPUT, AP and PRICE_VARIANCE all resolve. Payment method `BANK-BNB`, type BANK, offset account = bank ledger account, allowed currency BOB. |

**Worked money baseline (Bolivia, IVA included in price):** 10 × 250.00 = **2,500.00 gross**

| Figure | Value |
|---|---|
| Recoverable IVA | 325.00 |
| Net (what goes into stock) | 2,175.00 |
| Net unit cost | **217.5000** |
| Order header | `subtotal` 2,500 · `tax_amount` 325 · `total_amount` 2,500 |
| Invoice header | `subtotal` 2,175 · `tax_amount` 325 · `total_amount` 2,500 |

The order header shows the gross amount as "subtotal" but the invoice header shows the net amount. The labels are inconsistent.

---

## A. End-to-end

### P2P-001 — Requisition → RFQ → PO → receipt → invoice → payment (happy path, split mode)
- **Priority:** P1  | **Role:** requester → store_manager → buyer → receiver → ap_clerk → finance_approver  | **Type:** happy
- **Preconditions:** Split baseline parameters. P1 has no stock in WH-A. No open invoices for S1 or S2.
- **Test data:** Requisition: WH-A, P1 × 10, estimated cost 250. RFQ bids: S1 at 250.00, S2 at 262.00. Packing slip `GR-1001`. Factura `FAC-5501` dated today, NIT 1020304050.

| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `req.user`: /procurement/requisitions → New → warehouse WH-A, P1, qty 10, est. cost 250 → Save | 201. New number from sequence `PURCHASE_REQUISITION`. Status **DRAFT**. Estimated 2,500.00 BOB. |
| 2 | Open the requisition → **Submit** | Header and line status **IN_REVIEW**. `submitted_at` is set. (No threshold, so it is not auto-approved.) |
| 3 | `sm.user`: open it → **Send to tender** | 201. You are taken to /procurement/rfq/[id]. Number from sequence `RFQ`. Status **DRAFT**. Type "purchase requisition". Deadline is today + `rfq_response_days` (default 7). |
| 4 | `buyer.user`: Invite vendor… S1, then S2 → **Send** | Both bids go CREATED → **SENT**. Case status **SENT**. |
| 5 | Enter bid for S1: 250.00 → Save bid. Enter bid for S2: 262.00 → Save bid | Both bids **RECEIVED**. Totals 2,500.00 and 2,620.00. The comparison highlights S1 as cheapest. |
| 6 | Click **Award** on S1 | 201. A new **DRAFT** order is created for S1 (sequence `PURCHASE_ORDER`), WH-A, 10 × 250, notes "Awarded from RFQ …". S1 bid ACCEPTED, S2 **REJECTED** ("Not selected"). Case **CLOSED**. Requisition line **CLOSED** with price 250 and preferred supplier S1. Requisition header **CLOSED**. |
| 7 | /purchase/orders → the order row → **Confirm** | Status **CONFIRMED**. |
| 8 | `rcv.user`: **Receive** → location `A-RCV-001` → packing slip GR-1001 → "factura arrived?" No → Confirm & Receive | 200. Receipt number from sequence `PRODUCT_RECEIPT`. Order **RECEIVED**. |
| 9 | `ap.user`: /purchase/invoices → "Awaiting invoice" row → enter FAC-5501, date, NIT → create | 201. Invoice **DRAFT** with an internal number (sequence `VENDOR_INVOICE`). One line, qty 10 × 250, matched to the receipt. Match **PASSED**. |
| 10 | Open the invoice → **Post** | Banner: "Financial update posted: accrual reversed, recoverable tax recognised against the factura, payable created." Status **POSTED**. |
| 11 | `ap.user`: /purchase/payments → New payment → S1, BANK-BNB, 2500 → Create draft | Payment **DRAFT** (sequence `PAYMENT`), open amount shown as "—". |
| 12 | `fin.user`: **Post** → allocate 2500 to FAC-5501 → Post payment | Payment **POSTED**, open 0.00. Invoice open 0.00, `paid_at` set. |

- **Post-conditions / data checks:**
  - Stock: P1 at `A-RCV-001` = 10 (reserved 0). One `PURCHASE_RECEIPT` transaction, qty 10, unit cost 217.5, receipt status RECEIVED. One cost layer, 10 @ 217.5 BOB = **2,175.00**, `po_number` set.
  - Receipt journal: Dr INVENTORY 2,175.00 / Cr PURCHASE_ACCRUAL 2,175.00.
  - Invoice journal: Dr PURCHASE_ACCRUAL 2,175.00 + Dr VAT_INPUT 325.00 / Cr AP 2,500.00. No price variance line. The invoice stores `exchange_rate` 1 and `amount_functional` 2,500.
  - AP subledger: CREDIT 2,500 (invoice) and DEBIT 2,500 (payment), with one settlement of 2,500.
  - Payment journal: Dr AP 2,500.00 / Cr bank 2,500.00.
  - Order status **INVOICED** (received 10 and invoiced 10).
  - Net ledger effect: Inventory +2,175, VAT_INPUT +325, Bank −2,500. Accrual and AP both net to 0.

### P2P-002 — Direct requisition → PO (no RFQ), multi-line partial approval
- **Priority:** P2  | **Role:** purchasing_requester, buyer  | **Type:** happy
- **Preconditions:** Baseline.
- **Test data:** Line 1: P1 × 10 @ 250. Line 2: P2 × 5 @ 100.

| # | Step | Expected result |
|---|---|---|
| 1 | `req.user` creates and submits the requisition | IN_REVIEW, estimated 3,000.00. |
| 2 | `buyer.user` ticks line 2 → Reject (reason "not needed") | Line 2 REJECTED. Header stays **IN_REVIEW** because line 1 is still in review. Header `rejection_reason` is set. |
| 3 | With nothing ticked → Approve all | Line 1 APPROVED. Header **APPROVED**. |
| 4 | "Create PO from supplier…" → S1 | 201. DRAFT order with 1 line (P1 × 10 @ 250), `source_document_type=REQUISITION`. The "Purchase orders raised" table lists it. Line 1 CLOSED. |

- **Post-conditions / data checks:** Header status stays **APPROVED**, not CLOSED, because the rejected line counts as a live line (`documentChain.ts:203`, suspected defect). No journal entry and no stock movement.

---

## B. Purchase requisitions

### P2P-003 — Requester cannot approve own requisition (permission)
- **Priority:** P1  | **Role:** purchasing_requester  | **Type:** SoD / permission
- **Preconditions:** A requisition raised and submitted by `req.user`, now IN_REVIEW.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | `req.user` opens /procurement/requisitions/[id] | The Approve and Reject buttons are **still visible**. The UI does not hide them by role. |
| 2 | Click Approve all | Error banner. API 403 `{"error":{"message":"Permission denied: purchase.requisition.approve"}}`. |
| 3 | API: `POST /api/v1/procurement/requisitions/:id/reject` | 403, same permission message. |

- **Post-conditions / data checks:** Status stays IN_REVIEW. `approved_by` stays null.

### P2P-004 — store_manager approves own requisition (SoD gap)
- **Priority:** P1  | **Role:** store_manager  | **Type:** SoD
- **Preconditions:** `sm.user` holds both `purchase.requisition.create` and `purchase.requisition.approve`.
- **Test data:** P1 × 10 @ 250.

| # | Step | Expected result |
|---|---|---|
| 1 | `sm.user` creates and submits a requisition | IN_REVIEW, `requester_user_id = sm.user`. |
| 2 | The same user clicks Approve all | **Business requirement:** refused, because approver = requester. **What the code does:** 200, header APPROVED, `approved_by = requester_user_id`. |

- **Post-conditions / data checks:** Record as a **FAIL against the separation-of-duties (SoD) requirement**. There is no requester ≠ approver check (`requisition.service.ts:216-257`).

### P2P-005 — Auto-approval below threshold / approval disabled
- **Priority:** P2  | **Role:** purchasing_requester  | **Type:** boundary
- **Preconditions:** Case a: `requisition_approval_threshold = 1000`. Case b: `requisition_approval_enabled=false`.
- **Test data:** a1: P1 × 4 @ 250 = 1,000.00. a2: P1 × 4 @ 250.01 = 1,000.04.

| # | Step | Expected result |
|---|---|---|
| 1 | Submit a1 | Straight to **APPROVED** (total ≤ threshold, inclusive). `approved_by = requester`. |
| 2 | Submit a2 | **IN_REVIEW**. |
| 3 | With approval disabled, submit any requisition | **APPROVED**. |

- **Post-conditions / data checks:** Auto-approval records the requester as approver. That is by design, but auditors should know.

### P2P-006 — Requisition validation negatives
- **Priority:** P2  | **Role:** purchasing_requester  | **Type:** negative
- **Preconditions:** —
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | UI: New requisition with no warehouse | Button blocked with the text "Choose a warehouse." |
| 2 | UI: product selected, qty 0 | Blocked: "Every product line needs a quantity greater than zero." |
| 3 | API: `purpose:"REPLENISHMENT"` | 400: "REPLENISHMENT requisitions are not implemented yet…" |
| 4 | API: `lines: []` | 400 `VALIDATION_ERROR` "At least one line is required". |
| 5 | API: `currency:"EUR"` when EUR is not active | 422 `CURRENCY_INACTIVE`. |
| 6 | Submit an already-submitted requisition | 409: "Only a DRAFT requisition can be submitted; … is IN_REVIEW." |
| 7 | Approve a requisition with no lines in review | 409: "… has no lines in review (header is APPROVED)." |

- **Post-conditions / data checks:** No number is consumed when validation fails (steps 1–5).

### P2P-007 — Cancel requisition lines
- **Priority:** P3  | **Role:** purchasing_requester  | **Type:** negative
- **Preconditions:** Requisition R1 with line L1 APPROVED and line L2 CLOSED (already on an order).
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | API: `POST …/cancel {line_ids:[L2]}` | 409: "1 line(s) already have a purchase order and cannot be cancelled here. Cancel the purchase order instead." |
| 2 | `POST …/cancel {line_ids:[L1]}` | 200. L1 CANCELLED. Header becomes CLOSED (the only live line is closed). |

- **Post-conditions / data checks:** There is no Cancel button in the UI. This is API only.

### P2P-008 — Requisition → PO requires an approved line and a warehouse
- **Priority:** P2  | **Role:** buyer  | **Type:** negative
- **Preconditions:** R2 is IN_REVIEW. R3 is APPROVED and was created through the API without a warehouse.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | `POST /procurement/requisitions/R2/purchase-order {supplier_id:S1}` | 409: "… has no APPROVED lines. Its status is IN_REVIEW; approve it before ordering." |
| 2 | Same call for R3 without `warehouse_id` | 400: "A purchase order needs a warehouse. The requisition has none — pass warehouse_id." |

---

## C. RFQ

### P2P-009 — RFQ from an unapproved requisition bypasses approval (suspected defect)
- **Priority:** P1  | **Role:** store_manager / buyer  | **Type:** SoD
- **Preconditions:** R4 (P1 × 10) is **IN_REVIEW** and has not been approved.
- **Test data:** S1 bid at 250.

| # | Step | Expected result |
|---|---|---|
| 1 | Open R4 → Send to tender | 201. RFQ created (IN_REVIEW lines are accepted). |
| 2 | Invite S1 → Send → Enter bid 250 → Award | **Business requirement:** award refused until the requisition is approved. **What the code does:** 201. DRAFT order created, R4 line and header **CLOSED**, and `approved_by` never set. |

- **Post-conditions / data checks:** Record as FAIL. `awardRfq` closes requisition lines without checking they were approved (`rfq.service.ts:644-673`, together with `:131-135`).

### P2P-010 — Double ordering: direct PO while RFQ open
- **Priority:** P2  | **Role:** buyer  | **Type:** negative
- **Preconditions:** R5 APPROVED. RFQ sent from R5, with bids RECEIVED.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | On R5, "Create PO from supplier…" S2 | 201. Order #1 created, R5 line CLOSED. |
| 2 | On the RFQ, award S1 | **Expected:** refused, because the requisition line is already fulfilled. **Code:** 201. Order #2 created and the requisition line is overwritten to be fulfilled by the RFQ. |

- **Post-conditions / data checks:** The same demand is now ordered twice. Record as FAIL.

### P2P-011 — Bid registration rules
- **Priority:** P2  | **Role:** buyer  | **Type:** negative / boundary
- **Preconditions:** An RFQ with S1 SENT.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | API: bid with score 101 | 400 `VALIDATION_ERROR` (schema max 100). |
| 2 | Bid line with neither `line_id` nor `case_line_id` | 400: "Each bid line needs line_id or case_line_id". |
| 3 | Bid with unit_price 0 → then Award | Bid recorded as RECEIVED. Award returns 400: "1 of the selected lines have no price. A purchase order cannot be raised from an unpriced bid." |
| 4 | Award a bid that is still SENT (API) | 409: "Only a RECEIVED bid can be awarded; this one is SENT. Record the reply first." |
| 5 | Re-submit a bid after it was awarded | 409: "This bid is already ACCEPTED and cannot be re-submitted." |

### P2P-012 — Award without reject_others, then cancel
- **Priority:** P3  | **Role:** buyer  | **Type:** boundary
- **Preconditions:** S1 and S2 both RECEIVED.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | API: `POST /rfq/:id/award {request_id:S1, reject_others:false}` | 201. Case **AWARDED**, not CLOSED, because S2 is still RECEIVED. |
| 2 | `POST /rfq/:id/cancel` | 409: "RFQ … is AWARDED — a purchase order has already been raised from it." |
| 3 | Award S2 on the same case | 201. A **second order** is raised for the same lines (only a CANCELLED case is blocked). Suspected gap. |

### P2P-013 — RFQ without warehouse cannot be awarded
- **Priority:** P3  | **Role:** buyer  | **Type:** negative
- **Preconditions:** Manual RFQ created through the API without `warehouse_id`, with bid RECEIVED.

| # | Step | Expected result |
|---|---|---|
| 1 | Award | 400: "This RFQ case has no warehouse; a purchase order needs one." The UI gives no way to set the warehouse. |

### P2P-014 — Buyer SoD: cannot create/post vendor invoice or payment
- **Priority:** P1  | **Role:** buyer  | **Type:** SoD / permission
- **Preconditions:** A RECEIVED order and a DRAFT invoice exist.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | `buyer.user`: /purchase/invoices → create from "Awaiting invoice" | 403 "Permission denied: purchase.vendor_invoice.create". |
| 2 | Open the DRAFT invoice → Post | 403 "Permission denied: purchase.vendor_invoice.post". |
| 3 | Approve discrepancies | 403 "…purchase.vendor_invoice.approve_discrepancy". |
| 4 | /purchase/payments | List call returns 403 (`purchase.vendor_payment.read`). The page shows no data. |
| 5 | API `POST /purchase/payments` and `/payments/:id/post` | 403 `purchase.vendor_payment.create` and `…post`. |
| 6 | Order Receive → Confirm & Receive | 403 "Permission denied: purchase.receipt.post". |

- **Post-conditions / data checks:** Invoice stays DRAFT and no journal entry is created. Buyer **can** create, confirm and cancel orders and create returns.

### P2P-015 — AP clerk / finance approver split on payments and discrepancies
- **Priority:** P1  | **Role:** ap_clerk, finance_approver  | **Type:** SoD
- **Preconditions:** DRAFT payment created by `ap.user`. Invoice with header match FAILED.

| # | Step | Expected result |
|---|---|---|
| 1 | `ap.user` → Post payment | 403 "Permission denied: purchase.vendor_payment.post". |
| 2 | `ap.user` → Approve discrepancies | 403 "…approve_discrepancy". |
| 3 | `fin.user` → New payment | 403 "…vendor_payment.create". |
| 4 | `fin.user` → Post payment / Approve discrepancies | 200. |
| 5 | `ap.user` → Post a PASSED invoice | 200. ap_clerk holds `vendor_invoice.post`. |

- **Post-conditions / data checks:** SoD is enforced by role only. An `admin` user can create **and** post the same payment, and there is no maker ≠ checker check (gap).

---

## D. Purchase orders

### P2P-016 — Create and confirm PO (UI)
- **Priority:** P1  | **Role:** buyer  | **Type:** happy
- **Preconditions:** No trade agreement for S1 and P1.
- **Test data:** S1, WH-A, P1 × 10 @ 250.

| # | Step | Expected result |
|---|---|---|
| 1 | /purchase/orders → New Purchase Order → fill in → Save | 201. **DRAFT**. Number from `PURCHASE_ORDER`. Total 2,500.00. Currency = ledger (BOB). |
| 2 | Edit → change qty to 12 → Save | Lines rebuilt, subtotal 3,000, tax 390, total 3,000. |
| 3 | Confirm | **CONFIRMED**, `confirmed_at` set. Edit button hidden. Manage and Receive buttons shown. |
| 4 | API: confirm again | 400: "PO not found or cannot be confirmed". |
| 5 | API: `PUT /purchase/orders/:id` on the CONFIRMED order | 409 `CONFIRMED_ORDER_DIRECT_EDIT_FORBIDDEN`. |

- **Post-conditions / data checks:** No journal entry and no stock. Trade agreement price, when present, overrides the typed cost.

### P2P-017 — PO validation negatives
- **Priority:** P2  | **Role:** buyer  | **Type:** negative
- **Preconditions:** —

| # | Step | Expected result |
|---|---|---|
| 1 | API: qty 2.5 | 400 `VALIDATION_ERROR` (quantity must be an integer). |
| 2 | API: `unit_cost:-1` | 400 `VALIDATION_ERROR`. |
| 3 | API: `currency:"usd"` | 400 "currency must be a 3-letter uppercase code". |
| 4 | API: no `warehouse_id` | **Expected:** 400. **Suspected actual:** 500 "Internal server error", because the schema allows it but the database column is NOT NULL (`schemas/index.ts:236`). |
| 5 | API: `PUT` on the DRAFT order with `lines:[]` then confirm | **Expected:** refused. **Code:** order saved with 0 lines and total 0, confirm succeeds (`purchase.routes.ts:264`). |

### P2P-018 — Change confirmed PO: delivery date and remainder cancellation
- **Priority:** P2  | **Role:** buyer  | **Type:** happy / negative
- **Preconditions:** Order CONFIRMED, P1 × 10, 6 received (see P2P-025).
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | Manage → change requested date, reason "ok" | 400 `CHANGE_REASON_REQUIRED` (fewer than 3 characters). |
| 2 | Same with reason "Supplier delay" | 200. `expected_date` and open-line dates updated. Change history shows `DELIVERY_UPDATED`. |
| 3 | Cancel quantity 5 on the P1 line | 409 `CANCEL_QUANTITY_EXCEEDS_REMAINDER` "only 4 remains unreceived and uninvoiced." |
| 4 | Cancel quantity 4, reason "Short shipment accepted" | 200. `cancelled_qty` 4. Order becomes **RECEIVED** (effective qty 6 = received). History shows `LINE_REMAINDER_CANCELLED` with before/after snapshots. |
| 5 | API `POST /orders/:id/cancel` on the RECEIVED order | 409 `ORDER_REMAINDER_NOT_CANCELLABLE`. |

### P2P-019 — Cancel PO (DRAFT and CONFIRMED)
- **Priority:** P2  | **Role:** buyer  | **Type:** happy
- **Preconditions:** Order D1 DRAFT. Order C1 CONFIRMED with nothing received.

| # | Step | Expected result |
|---|---|---|
| 1 | API `POST /orders/D1/cancel` (the UI has no cancel button) | 200. **CANCELLED**. No reason needed. |
| 2 | `POST /orders/C1/cancel {}` | 400 `CHANGE_REASON_REQUIRED`. |
| 3 | `POST /orders/C1/cancel {reason:"No longer needed"}` | 200. Every line `cancelled_qty` = qty. Status **CANCELLED**. History `ORDER_REMAINDER_CANCELLED`. |
| 4 | Receive C1 | 409 `PO_NOT_CONFIRMED` "…is CANCELLED." |

### P2P-020 — Warehouse worker / receiver permissions on PO
- **Priority:** P2  | **Role:** warehouse_worker, receiver, ap_clerk  | **Type:** permission

| # | Step | Expected result |
|---|---|---|
| 1 | `wh.user` → New Purchase Order → Save | 403 "Permission denied: purchase.order.create". |
| 2 | `rcv.user` → Confirm a DRAFT order | 403 "…purchase.order.confirm". |
| 3 | `ap.user` → Receive | 403 "…purchase.receipt.post". |
| 4 | `rcv.user` → Receive with "factura arrived = Yes" | 403 "Permission denied: purchase.vendor_invoice.create". Receive-and-invoice needs 4 permissions and receiver only has `receipt.post`. |

### P2P-021 — Receive & Invoice in one action (store_manager)
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy
- **Preconditions:** Order CONFIRMED, P1 × 10 @ 250, split mode.
- **Test data:** Factura FAC-5601.

| # | Step | Expected result |
|---|---|---|
| 1 | Receive → A-RCV-001 → slip GR-2001 → factura arrived Yes → number and date → Receive & Invoice | 201. Receipt POSTED. Invoice POSTED (auto-matched). Order **INVOICED**. |

- **Post-conditions / data checks:** Two journal entries, same as P2P-001 (receipt 2,175 / invoice 2,175 + 325 → AP 2,500). Stock +10 and cost layer 10 @ 217.5.

### P2P-022 — Receive & Invoice with duplicate factura number is not atomic (suspected defect)
- **Priority:** P1  | **Role:** store_manager  | **Type:** negative
- **Preconditions:** S1 already has invoice number FAC-5601. A new CONFIRMED order for S1 exists.

| # | Step | Expected result |
|---|---|---|
| 1 | Receive & Invoice with factura FAC-5601 | **Expected:** 409 and nothing posted. **Code:** 409 `DUPLICATE_INVOICE_NUMBER` "Invoice FAC-5601 from this supplier already exists (…)" **but the receipt has already committed**. |
| 2 | Check /purchase/receipts, stock, journal | Receipt POSTED, stock +10, receipt journal entry posted, order RECEIVED, no invoice. |

- **Post-conditions / data checks:** Record as FAIL. The receipt and the invoice are two separate database transactions (`purchase.routes.ts:675-696`).

### P2P-023 — USD PO with exchange rate → BOB inventory value (not implemented)
- **Priority:** P1  | **Role:** buyer, receiver, ap_clerk, finance_approver  | **Type:** negative (feature gap)
- **Preconditions:** USD active for the tenant. BCB rate USD→BOB 6.96 for today. Supplier S3 in USD.
- **Test data:** P1 × 10 @ 25.00 USD. **Target** once WORK-026 exists: 250 USD × 6.96 = 1,740.00 BOB gross → net 1,513.80 BOB (unit 151.38).

| # | Step | Expected result |
|---|---|---|
| 1 | API `POST /purchase/orders {currency:"USD", …}` (the UI has no currency field) | 201. DRAFT with `currency` USD, total 250.00. **No exchange rate is stored on the order** (no column exists). |
| 2 | Confirm | CONFIRMED. |
| 3 | Receive | 409 `RECEIPT_FX_NOT_IMPLEMENTED` "Product receipts currently support documents in the ledger's accounting currency (BOB) only. Found USD; no exchange rate was inferred. Foreign-currency documents arrive with WORK-026." |
| 4 | API `POST /purchase/invoices` with explicit line 10 × 25 → Post | Create: 201 DRAFT (USD). Post: 409 `VENDOR_INVOICE_FX_NOT_IMPLEMENTED`. |
| 5 | Payment with `currency:"USD"` | 409 `VENDOR_PAYMENT_FX_NOT_IMPLEMENTED`. |
| 6 | Repeat step 1 with `currency:"EUR"` (not active) | 422 `CURRENCY_INACTIVE`. |

- **Post-conditions / data checks:** No stock, no cost layer and no journal entry. No `PRODUCT_RECEIPT` number consumed (the currency check runs before the number is allocated). The BOB-value requirement stays **open until WORK-026**.

---

## E. Receipts and arrival

### P2P-024 — Over-receipt refused
- **Priority:** P1  | **Role:** receiver  | **Type:** negative
- **Preconditions:** Order CONFIRMED, line L = P1 × 10, nothing received.

| # | Step | Expected result |
|---|---|---|
| 1 | API `POST /purchase/orders/:id/receive {packing_slip:"GR-3001", receive_location_id:A-RCV-001, lines:[{po_line_id:L, quantity:11}]}` | 409 `OVER_RECEIPT` "Cannot receive 11 of that line — only 10 is outstanding on PO-…. Over-delivery must be handled by amending the order…" |
| 2 | UI Receive | Always receives exactly the outstanding quantity. The UI cannot over-receive (and cannot receive part). |

- **Post-conditions / data checks:** Whole transaction rolled back: no receipt, no stock, `received_qty` still 0. A receipt number may have been consumed (numbering runs before line validation, within the same transaction; if the sequence is transactional it rolls back too, confirm).

### P2P-025 — Partial receipt then second receipt
- **Priority:** P1  | **Role:** receiver  | **Type:** happy / boundary
- **Preconditions:** Order CONFIRMED, P1 × 10 @ 250, split mode, putaway off.
- **Test data:** Receipt 1: 6 units, slip GR-4001. Receipt 2: 4 units, slip GR-4002.

| # | Step | Expected result |
|---|---|---|
| 1 | API receive `lines:[{po_line_id:L, quantity:6}]` | 200. `accrued_amount` 1,305.00. Order **PARTIALLY_RECEIVED**. |
| 2 | /purchase/orders → row still shows Receive | Yes. |
| 3 | UI Receive (remaining) → GR-4002 | 200. `accrued_amount` 870.00. Order **RECEIVED**. |
| 4 | Receive again (API with empty body plus slip) | 409 `NOTHING_TO_RECEIVE`. |
| 5 | Receive with empty `packing_slip:""` on another order | 400 `PACKING_SLIP_REQUIRED`. |
| 6 | Receive with no location and none on the order | 400 `RECEIVE_LOCATION_REQUIRED`. |

- **Post-conditions / data checks:**
  - Two receipts with sequential `PRODUCT_RECEIPT` numbers.
  - Stock at A-RCV-001 = 10.
  - Cost layers 6 @ 217.5 (1,305.00) and 4 @ 217.5 (870.00).
  - Journal entries: Dr INVENTORY 1,305 / Cr PURCHASE_ACCRUAL 1,305, then Dr INVENTORY 870 / Cr PURCHASE_ACCRUAL 870.
  - Order line `received_qty` 10.

### P2P-026 — Receipt in legacy mode (parameter off)
- **Priority:** P2  | **Role:** receiver, ap_clerk  | **Type:** happy (configuration variant)
- **Preconditions:** `post_product_receipt_in_ledger=false`.
- **Test data:** P1 × 10 @ 250.

| # | Step | Expected result |
|---|---|---|
| 1 | Receive | `posting_note` "Posted the legacy single voucher (inventory, recoverable tax and payable together)…" |
| 2 | Create and post the invoice | Status POSTED, `journal_entry_id` **null**. Banner shows "No invoice voucher: post_product_receipt_in_ledger is off…" |
| 3 | Create a return from this invoice → Ship | 409 `RECEIPT_LEDGER_MODE_REQUIRED`. |

- **Post-conditions / data checks:**
  - Receipt journal: Dr INVENTORY 2,175 + Dr VAT_INPUT 325 / Cr AP 2,500.
  - An AP open transaction of 2,500 is still created at invoice posting, so it can be paid.
  - IVA credit is recognised at receipt, not against the factura. Bolivian compliance risk; flag to Finance.

### P2P-027 — Receipt into a location outside the PO warehouse (validation gap)
- **Priority:** P2  | **Role:** receiver  | **Type:** negative
- **Preconditions:** Order for WH-A.

| # | Step | Expected result |
|---|---|---|
| 1 | Receive → pick location `B-STG-001`. The dropdown lists every location in the tenant. | **Expected:** refused, location not in the order's warehouse. **Code:** 200. Stock lands in WH-B, while the receipt and journal still carry WH-A. |

- **Post-conditions / data checks:** Record as FAIL (`productReceipt.service.ts:174`, line location `:275`).

### P2P-028 — Putaway work created on receipt; UI "Complete" does not move stock
- **Priority:** P1  | **Role:** receiver, warehouse_worker  | **Type:** happy / negative
- **Preconditions:** WH-A parameters: `require_putaway=true`, PUTAWAY directive with an EMPTY_LOCATION line on the storage zone. Order CONFIRMED P1 × 10.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | Receive into A-RCV-001 | Receipt posted. Work `WRK-PA-<receipt_no>-1`, type PUTAWAY, **OPEN**, priority 3, one PUT line A-RCV-001 → A-STG-001, qty 10, PENDING. |
| 2 | `wh.user`: /warehouse/work → Start | **IN_PROGRESS**, `assigned_to` = wh.user. |
| 3 | Click **Complete** | Card disappears (status COMPLETED). |
| 4 | /inventory/stock | **Expected:** A-STG-001 = 10, A-RCV-001 = 0. **Code:** A-RCV-001 still 10, A-STG-001 has nothing, the line is still PENDING, no TRANSFER transactions. Record as FAIL (`warehouse/work/page.tsx:33` calls `warehouse.routes.ts:379`). |

- **Post-conditions / data checks:** See INV-011 for the API line-completion path that does move stock.

### P2P-029 — Enable putaway without directive refused
- **Priority:** P3  | **Role:** store_manager  | **Type:** negative

| # | Step | Expected result |
|---|---|---|
| 1 | API `PUT /warehouse/parameters/:WH-A {require_putaway:true}` with no active PUTAWAY directive | 400 `PUTAWAY_NO_DIRECTIVE`. |
| 2 | `{availability_counts:"PICK_LOCATIONS_ONLY"}` on a warehouse with no pick location | 400 `NO_PICK_LOCATION`. |
| 3 | `wh.user` does step 1 | 403 "Insufficient permissions". |

### P2P-030 — Arrival journal (/warehouse/arrival)
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** Order CONFIRMED P1 × 10 @ 250 on WH-A.
- **Test data:** —

| # | Step | Expected result |
|---|---|---|
| 1 | /warehouse/arrival → New Journal | **Nothing happens.** The button has no handler (`arrival/page.tsx:33`). UI gap. |
| 2 | API `POST /warehouse/arrival-journals {purchase_order_id, warehouse_id:WH-A, lines:{create:[{product_id:P1, received_qty:10, receive_location_id:A-RCV-001}]}}` | 201. `ARJ-2026-000N`, DRAFT. The raw body is saved as sent, so `status` can be forced too (see defects). |
| 3 | `POST /warehouse/arrival-journals/:id/post` | 200. Journal POSTED. Stock +10 at A-RCV-001. INBOUND transaction. Putaway work with a PICK line (no from-location) and a PUT line to A-RCV-001. |
| 4 | Check the order and the ledger | **Expected:** order `received_qty` 10, cost layer at 217.5, journal entry. **Code:** order `received_qty` still 0 and status unchanged; cost layer `unit_cost` **0**; no journal entry; no receipt document. Record as FAIL. |
| 5 | `wh.user` posts a journal | 403 "Insufficient permissions". |
| 6 | Product with registration requirements: receive before arrival | 409 `REGISTRATION_REQUIRED`. After arrival is posted, the receipt succeeds and **stock is +10 again, 20 in total**. Record as FAIL. |

---

## F. Vendor invoices

### P2P-031 — Invoice price variance above tolerance: approval gate then post
- **Priority:** P1  | **Role:** ap_clerk, finance_approver  | **Type:** negative / happy
- **Preconditions:** Receipt of 10 @ 250 posted (accrual 2,175). Split mode, THREE_WAY, tolerance 0.02, REQUIRE_APPROVAL.
- **Test data:** API `POST /purchase/invoices {purchase_order_id, invoice_number:"FAC-7001", invoice_date, lines:[{po_line_id:L, product_id:P1, quantity:10, unit_price:260}]}`.

| # | Step | Expected result |
|---|---|---|
| 1 | Create (API) | 201 DRAFT. Subtotal 2,262.00, tax 338.00, total 2,600.00. Line price match **FAILED**, variance +4.0000%. Reason "unit price 260 vs ordered 250 — +4% exceeds the 2.00% tolerance". Receipt qty PASSED. Header **FAILED**. |
| 2 | `ap.user` → Post | 409 `MATCHING_DISCREPANCY_UNAPPROVED` listing the reasons. |
| 3 | `fin.user` → Approve discrepancies | Banner "Discrepancies approved…". `discrepancy_approved_by` = fin.user. |
| 4 | `ap.user` or `fin.user` → Post | 200 POSTED. `price_variance` 87.00. |

- **Post-conditions / data checks:**
  - Invoice journal: Dr PURCHASE_ACCRUAL 2,175.00 + Dr VAT_INPUT 338.00 + Dr PRICE_VARIANCE **87.00** / Cr AP 2,600.00. Check: 2,600 − (2,175 + 338) = 87 = (260 − 250) × 10 × 0.87.
  - Cost layer stays at 217.5. The variance is not revalued into stock.
  - AP open 2,600.
- **Variant:** with `post_invoice_with_discrepancies=ALLOW_WITH_WARNING`, step 2 posts without the gate.

### P2P-032 — Invoice quantity > received (THREE_WAY): quantity variance goes to PRICE_VARIANCE (suspected defect)
- **Priority:** P1  | **Role:** ap_clerk, finance_approver  | **Type:** negative
- **Preconditions:** Order P1 × 10 @ 250 with only 6 received (accrual 1,305).
- **Test data:** Invoice FAC-7101, lines 10 × 250.

| # | Step | Expected result |
|---|---|---|
| 1 | Create (API) | 201. Auto-match ties 6. Receipt qty **FAILED** "invoiced 10 but matched receipts total 6". Price PASSED. Header FAILED. |
| 2 | Post | 409 `MATCHING_DISCREPANCY_UNAPPROVED`. |
| 3 | Approve discrepancies → Post | 200 POSTED. Order line `invoiced_qty` 10. Order stays PARTIALLY_RECEIVED. |
| 4 | Journal | **Expected:** the 4 unreceived units stay as an open accrual difference, or posting is blocked. **Code:** Dr PURCHASE_ACCRUAL 1,305 + Dr VAT_INPUT 325 + **Dr PRICE_VARIANCE 870** / Cr AP 2,500. |
| 5 | Later receive the remaining 4 | Receipt journal Cr PURCHASE_ACCRUAL 870 that no invoice ever reverses. Accrual left at −870 and PRICE_VARIANCE at +870. |

- **Post-conditions / data checks:** Record as FAIL (`vendorInvoice.service.ts:764` and `:835`).

### P2P-033 — Invoice quantity beyond order remainder refused
- **Priority:** P2  | **Role:** ap_clerk  | **Type:** negative
- **Preconditions:** Order P1 × 10, already invoiced 10.

| # | Step | Expected result |
|---|---|---|
| 1 | API create, line qty 1 | 409 `INVOICE_QUANTITY_EXCEEDS_ORDER_REMAINDER` "Cannot invoice 1 of that line — only 0 remains on PO-…". |
| 2 | Create without lines | 409 `NOTHING_TO_INVOICE`. |
| 3 | Line qty 0 | 400 "Every invoice line needs a quantity greater than zero." |

### P2P-034 — Duplicate vendor invoice number refused (per supplier)
- **Priority:** P1  | **Role:** ap_clerk  | **Type:** negative / boundary
- **Preconditions:** S1 has invoice FAC-5501. S2 has none.

| # | Step | Expected result |
|---|---|---|
| 1 | Create an invoice for S1 order with number "FAC-5501" | 409 `DUPLICATE_INVOICE_NUMBER` "Invoice FAC-5501 from this supplier already exists (<internal no>)." |
| 2 | Same with " FAC-5501 " (spaces) | 409. The number is trimmed before the check. |
| 3 | Same number "FAC-5501" for an S2 order | 201. Allowed, because uniqueness is per supplier. |
| 4 | Same number different case "fac-5501" for S1 | 201. The check is case-sensitive, so it is accepted (flag to Finance). |
| 5 | Cancel a DRAFT S1 invoice FAC-8001, then re-enter FAC-8001 | 409 duplicate. Cancelled invoices still block the number (gap). |

### P2P-035 — Cancel invoice (draft vs posted)
- **Priority:** P2  | **Role:** finance_approver  | **Type:** negative
- **Preconditions:** DRAFT invoice matched 10 to a receipt line. A POSTED invoice.

| # | Step | Expected result |
|---|---|---|
| 1 | Cancel the DRAFT | "Invoice cancelled and its receipt matches released." Receipt line `matched_qty` −10. The order reappears in "Awaiting invoice". |
| 2 | Cancel the POSTED | 409 `INVOICE_ALREADY_POSTED` "…Reverse it with a credit note…". |
| 3 | Post the CANCELLED | 409 "A cancelled invoice cannot be posted." |
| 4 | `ap.user` cancel | 403 "…vendor_invoice.cancel". |

### P2P-036 — IVA credit fiscal fields and ledger
- **Priority:** P2  | **Role:** ap_clerk  | **Type:** happy
- **Preconditions:** Receipt of 10 @ 250.
- **Test data:** NIT 1020304050, authorisation code 29040011007, control code (API only) 7A-3F-2B.

| # | Step | Expected result |
|---|---|---|
| 1 | Create invoice from the UI with NIT and authorisation code | Saved on the invoice (`supplier_tax_id`, `fiscal_authorization_code`). |
| 2 | Post | VAT_INPUT debit **325.00** with description "Recoverable input tax — factura FAC-…". Journal date = posting date (defaults to invoice date). |

- **Post-conditions / data checks:** No check validates the NIT format or requires the authorisation code (Bolivia purchase ledger risk; confirm with Finance). IT 3% is **not** computed on purchases.

### P2P-037 — Match status re-run
- **Priority:** P3  | **Role:** ap_clerk  | **Type:** happy
- **Preconditions:** DRAFT invoice for 10, only 6 received at creation. Then 4 more received.

| # | Step | Expected result |
|---|---|---|
| 1 | Update match status | Auto-match adds 4 more (oldest receipt first). Banner "Match status: PASSED." `last_matched_at` updated. |

### P2P-038 — Receiving requirement blocks invoice
- **Priority:** P3  | **Role:** ap_clerk  | **Type:** negative
- **Preconditions:** Product in an item model group with receiving requirements. Invoice line not matched to any receipt.

| # | Step | Expected result |
|---|---|---|
| 1 | Post | 409 `RECEIVING_REQUIRED` "1 line(s) belong to an item model group with receiving requirements…". |

---

## G. Vendor payments

### P2P-039 — Partial then full payment
- **Priority:** P1  | **Role:** ap_clerk, finance_approver  | **Type:** happy / boundary
- **Preconditions:** Posted invoice FAC-5501, open 2,500.00.
- **Test data:** PAY1 = 1,000.00. PAY2 = 1,500.00.

| # | Step | Expected result |
|---|---|---|
| 1 | `ap.user` New payment S1, BANK-BNB, 1000 → Create draft | DRAFT, PAYMENT sequence number. |
| 2 | `fin.user` Post, allocate 1000 to FAC-5501 | POSTED. Payment open 0.00. Invoice open **1,500.00**. `paid_at` null. |
| 3 | PAY2 1500 → Post, allocate 1500 | Invoice open **0.00**. `paid_at` = settlement date. |

- **Post-conditions / data checks:**
  - Journal PAY1: Dr AP 1,000 / Cr bank 1,000.
  - Journal PAY2: Dr AP 1,500 / Cr bank 1,500.
  - Settlements 1,000 and 1,500 against the invoice's AP open transaction.
  - Order line "Pay Supplier" button only shows for status RECEIVED without `paid_at`. INVOICED orders never show it.

### P2P-040 — Unallocated payment then settle; over-settlement
- **Priority:** P2  | **Role:** finance_approver  | **Type:** negative / boundary
- **Preconditions:** Invoice open 1,500. DRAFT payment PAY3 of 2,000.

| # | Step | Expected result |
|---|---|---|
| 1 | Post PAY3 with no allocation | POSTED. Payment open 2,000. |
| 2 | Settle: allocate 1,600 to the invoice | UI allows it (1,600 ≤ payment open). API 409 `OVER_SETTLEMENT` "Settlement 1600.00 exceeds invoice open amount 1500.00." Nothing settled. |
| 3 | Settle 1,500 | Invoice open 0. Payment open 500 (overpayment left as a vendor debit balance). |
| 4 | API: post a DRAFT payment of 1,000 allocating 1,200 | 409 `OVER_SETTLEMENT` "…exceeds the payment's open amount 1000.00". **The whole post rolls back** and the payment stays DRAFT. |
| 5 | API: same invoice twice in `allocations` | 400 `DUPLICATE_SETTLEMENT_TARGET`. |

### P2P-041 — Payment reversal
- **Priority:** P2  | **Role:** finance_approver  | **Type:** happy / negative
- **Preconditions:** PAY1 posted and settled 1,000 against FAC-5501.

| # | Step | Expected result |
|---|---|---|
| 1 | Reverse with empty reason | UI blocked "Enter the business reason…". API 400 `REVERSAL_REASON_REQUIRED`. |
| 2 | Reason "Bank rejected transfer" → Post reversal | New POSTED payment (new PAYMENT number) with notes "Reversal: …". Reversing journal entry. Settlement reversed. Invoice open back up by 1,000. `paid_at` null. |
| 3 | Reverse PAY1 again | Reverse button hidden. API 409 "This vendor payment has already been reversed." |
| 4 | Reverse a DRAFT | 409 "Only a posted vendor payment with a voucher can be reversed." |

- **Post-conditions / data checks:** Reversing journal is Dr bank 1,000 / Cr AP 1,000, dated the reversal date.

### P2P-042 — Payment method setup and validation
- **Priority:** P3  | **Role:** buyer (setup.maintain), ap_clerk  | **Type:** negative

| # | Step | Expected result |
|---|---|---|
| 1 | /purchase/setup/payment-methods → New, type other than BANK/CASH/LEDGER (API) | 400 "account_type must be BANK, CASH, or LEDGER." |
| 2 | Inactive offset account | 404 "Active offset account not found for this tenant." |
| 3 | Method with allowed currency USD, then a BOB payment | 409 "Payment method … only allows USD." |
| 4 | Deactivate method after the draft, then post | 409 "The selected payment method is inactive." |
| 5 | Payment amount 0 | UI blocked. API 400 "Payment amount must be greater than zero." |
| 6 | `ap.user` creates a method | 403 `purchase.setup.maintain`. |

### P2P-043 — Payment to inactive supplier
- **Priority:** P3  | **Role:** ap_clerk  | **Type:** negative

| # | Step | Expected result |
|---|---|---|
| 1 | Deactivate S2, then API create payment for S2 | 404 "Active supplier not found." (The UI list only shows active suppliers.) |

---

## H. Returns and supplier credits

### P2P-044 — Return to supplier reduces stock; credit note settles invoice
- **Priority:** P1  | **Role:** buyer → receiver → ap_clerk → finance_approver  | **Type:** happy
- **Preconditions:** Split mode. P2P-001 done up to the posted invoice (not yet paid). Stock A-RCV-001 = 10, layer 10 @ 217.5.
- **Test data:** Return 2 units. Supplier credit note ref NC-0091.

| # | Step | Expected result |
|---|---|---|
| 1 | `buyer.user`: invoice → Create return → select receipt line → qty 2 → location A-RCV-001 → reason "Defective" → Create return | 201. Number from `PURCHASE_RETURN`. **DRAFT**. Line: gross 500.00, tax 65.00, net 435.00, frozen net unit 217.5. |
| 2 | `rcv.user`: /purchase/returns/[id] → reference "GUIA-77" → Ship | "Shipped and voucher posted." **SHIPPED**. |
| 3 | `ap.user`: /purchase/credits → New → return → NC-0091 → line qty 2 → create | 201 DRAFT (sequence `SUPPLIER_CREDIT`). Net 435, tax 65, total 500. |
| 4 | `fin.user`: open credit → Post | POSTED. |

- **Post-conditions / data checks:**
  - Stock A-RCV-001 = **8**. `PURCHASE_RETURN` transaction qty 2 @ 217.5 (issue status DEDUCTED). Cost layer 8 remaining.
  - Ship journal: Dr PURCHASE_ACCRUAL 435.00 / Cr INVENTORY 435.00.
  - Credit journal: Dr AP 500.00 / Cr PURCHASE_ACCRUAL 435.00 / Cr VAT_INPUT 65.00. No variance line.
  - Supplier-credit DEBIT open transaction 500, settled against the invoice. Invoice open **2,000**.
  - Order line `received_qty` stays 10. Return is not reflected on the order (gap).
  - Transactions page type filter has no `PURCHASE_RETURN` option.

### P2P-045 — Return validation negatives
- **Priority:** P2  | **Role:** buyer, receiver  | **Type:** negative
- **Preconditions:** Invoice posted and matched to 10 units.

| # | Step | Expected result |
|---|---|---|
| 1 | Return from a DRAFT invoice (API) | 409 `INVOICE_NOT_POSTED`. |
| 2 | Qty 11 | 409 `EXCESS_RETURN_QUANTITY` "…would exceed the matched quantity of 10…". |
| 3 | Qty 1.5 | 400 `RETURN_INTEGER_QUANTITY_REQUIRED`. |
| 4 | Source location in WH-B for a WH-A return | 409 `RETURN_LOCATION_MISMATCH`. |
| 5 | Ship when stock was moved out of A-RCV-001 | 409 `INSUFFICIENT_STOCK` "…Need 2, available 0." |
| 6 | Ship when stock is present but was moved in and back (layer from another order) | 409 `INSUFFICIENT_PO_COST_LAYERS`. |
| 7 | Ship a SHIPPED return again | 409 `RETURN_NOT_DRAFT`. |
| 8 | Cancel a SHIPPED return | 409 "Return not found or not in DRAFT status." |
| 9 | `buyer.user` Ship | 403 `purchase.return.ship`. |

### P2P-046 — Credit validation negatives
- **Priority:** P2  | **Role:** ap_clerk, finance_approver  | **Type:** negative

| # | Step | Expected result |
|---|---|---|
| 1 | Credit without return (API) | 409 `SHIPPED_RETURN_REQUIRED`. |
| 2 | Credit against a DRAFT return | 409 `RETURN_CREDIT_SCOPE_MISMATCH`. |
| 3 | Credit qty 3 on a return of 2 | 409 `EXCESS_CREDIT_QUANTITY`. |
| 4 | Post without the supplier's reference | 409 `EXTERNAL_CREDIT_NUMBER_REQUIRED`. |
| 5 | `ap.user` Post | 403 `purchase.supplier_credit.post`. |

### P2P-047 — Credit after invoice fully paid (suspected gap)
- **Priority:** P2  | **Role:** finance_approver  | **Type:** negative
- **Preconditions:** Invoice 2,500 fully paid. Return of 2 shipped. Credit of 500 DRAFT.

| # | Step | Expected result |
|---|---|---|
| 1 | Post credit | **Expected:** posted, leaving a supplier debit balance or refund. **Code:** 409 `OVER_SETTLEMENT` "Credit 500.00 exceeds invoice open amount 0.00." Stock and inventory have already been reduced at ship. |

- **Post-conditions / data checks:** The accrual keeps 435 debited with no credit. Record as a gap (`purchaseReturn.service.ts:~660-672`).

### P2P-048 — Return in non-recoverable-tax invoice refused
- **Priority:** P3  | **Role:** buyer  | **Type:** negative
- **Preconditions:** Posted invoice with `non_recoverable_tax` ≠ 0.

| # | Step | Expected result |
|---|---|---|
| 1 | Create return | 409 `NON_RECOVERABLE_TAX_NOT_SUPPORTED`. |

---

## I. Inventory and warehouse

### INV-001 — Stock overview reflects receipt
- **Priority:** P1  | **Role:** any workforce role (e.g. cashier)  | **Type:** happy / permission
- **Preconditions:** P2P-001 receipt done.

| # | Step | Expected result |
|---|---|---|
| 1 | /inventory/stock → search "OXF-42" | Row: WH-A / A-RCV-001, on hand 10, reserved 0, available 10. |
| 2 | Log in as a storefront `customer` and call `GET /api/v1/inventory/stock` | 403 "This area is not available to storefront accounts". |

- **Post-conditions / data checks:** The route has no permission check. Every workforce role (auditor, cashier, ap_clerk) can read stock. The page's "low stock" badge uses a fixed ≤ 5 rule, not the product's reorder point.

### INV-002 — Transactions audit trail
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy
- **Preconditions:** P2P-001, INV-004 and INV-008 executed.

| # | Step | Expected result |
|---|---|---|
| 1 | /inventory/transactions → Type "Purchase Receipt" | Receipt row, qty 10, To A-RCV-001, notes "PO … · packing slip GR-1001". |
| 2 | Type "Transfer Out" / "Transfer In" | One pair per transfer, same qty. From/To both filled. |
| 3 | Type "Count Adjustment" | **Empty.** Count adjustments are stored as `ADJUSTMENT`. |
| 4 | Look for purchase return rows | Only under "All Types". No filter option. |

### INV-003 — Manual adjustment (+/−) at existing location
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy
- **Preconditions:** A-STG-001 P1 = 10.

| # | Step | Expected result |
|---|---|---|
| 1 | /inventory/stock → row → Adjust → Add 3, note "Found in backroom" | Stock 13. `ADJUSTMENT` transaction qty 3, To A-STG-001, receipt status PURCHASED, physical and financial dates set. |
| 2 | Subtract 2 | Stock 11. `ADJUSTMENT` qty 2, From A-STG-001, issue status SOLD. |
| 3 | `wh.user` tries to adjust | 403 "Insufficient permissions". |

- **Post-conditions / data checks:** **No journal entry and no cost-layer change.** Layers still total 10 units while stock is 11. The inventory value does not reconcile (gap; count posting is WORK-032).
- **Uncertain:** step 1 may return 500 for a product without variants (see Uncertain #1).

### INV-004 — Negative stock prevention on adjustment (suspected defect)
- **Priority:** P1  | **Role:** store_manager  | **Type:** negative / boundary
- **Preconditions:** A-STG-001 P1 = 3, reserved 0.

| # | Step | Expected result |
|---|---|---|
| 1 | Adjust → Subtract 5 | **Expected:** refused, "insufficient stock". **Code:** 200, on hand **−2**. No database check stops it (`inventory.routes.ts:83-133`). |
| 2 | Subtract 0 | 400 "Quantity cannot be zero". (The UI shows "Adjustment failed" because it reads `data.message`.) |

### INV-005 — Adjustment to invalid location (known residual)
- **Priority:** P1  | **Role:** store_manager  | **Type:** negative (**expected-to-fail / suspected defect**)
- **Preconditions:** API client.
- **Test data:** a) random UUID. b) `"LOC-XYZ"`. c) a location UUID from another warehouse. d) a location UUID from another tenant, if one exists in TEST.

| # | Step | Expected result |
|---|---|---|
| 1 | `POST /inventory/adjust {product_id:P1, location_id:<a>, quantity:5}` | **Required:** 400/404 `LOCATION_NOT_FOUND`. **Likely actual:** 500 "Internal server error" (foreign-key error). No validation message. |
| 2 | Location (b) | **Required:** 400. **Likely actual:** 500. |
| 3 | Location (c), valid but not the intended store | 200 accepted. No warehouse-scope check. |
| 4 | Location (d) | **Required:** 404. **Likely actual:** 200, creating a stock row for this tenant on another tenant's location (tenant-isolation risk; flag for security review). |

- **Post-conditions / data checks:** Record as FAIL. Location is never validated in `/adjust`.

### INV-006 — Transfer Store A → Store B (no in-transit)
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / gap
- **Preconditions:** A-STG-001 P1 = 10 with layer 10 @ 217.5. B-STG-001 has none.
- **Test data:** Qty 4.

| # | Step | Expected result |
|---|---|---|
| 1 | /inventory/transfers → P1, From A-STG-001, To B-STG-001, qty 4 → Execute Transfer | "Transfer completed!" |
| 2 | Look for an in-transit status or a "receive at B" step | **Required:** transfer order shipped → in transit → received at B. **Code:** none. The move is immediate, with no document, no number and no in-transit warehouse. Record the in-transit and receive-at-B requirement as **FAIL / not implemented** (WORK-040). |
| 3 | /inventory/stock | A-STG-001 = 6. B-STG-001 = 4. |

- **Post-conditions / data checks:**
  - Transactions: TRANSFER_OUT and TRANSFER_IN, qty 4, `reference_type` "transfer", no reference number, notes blank.
  - Cost layers: A layer 6 @ 217.5 (1,305.00). New B layer 4 @ 217.5 (870.00) keeping the original received date and order number.
  - No journal entry (same legal entity).
  - Low-stock report unchanged (tenant-wide total still 10).

### INV-007 — Transfer negatives
- **Priority:** P2  | **Role:** store_manager, warehouse_worker  | **Type:** negative

| # | Step | Expected result |
|---|---|---|
| 1 | Qty 7 when available is 6 | API 400 "Insufficient stock at source location". **UI shows "Transfer failed"** (reads the wrong error field). |
| 2 | Source 6 on hand with 3 reserved → transfer 4 | 400. Available is on hand minus reserved. |
| 3 | From = To = A-STG-001 | **Expected:** refused. **Code:** 200, net zero, but two transactions logged and the cost layer split. |
| 4 | `wh.user` transfer | 403 "Insufficient permissions". |
| 5 | Two browsers transfer 6 at the same moment from a location with 6 | **Expected:** one fails. **Risk:** both pass and stock goes −6, because the check runs outside the database transaction. |

### INV-008 — Count with variance posts adjustment
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy
- **Preconditions:** A-STG-001 P1 = 20, cost layer 20 @ 217.5 (4,350.00).
- **Test data:** Counted 18.

| # | Step | Expected result |
|---|---|---|
| 1 | /inventory/counting → New Counting Session → notes "Sept count" | New `CNT-2026-000N`, **IN_PROGRESS**, one line per stock row **for the whole tenant** (the UI cannot scope by location). System qty 20. |
| 2 | Open → Counted 18 on the P1/A-STG-001 line | Saved. Difference −2. |
| 3 | Finalize Count | Redirect to the list. Status **FINALIZED**. |
| 4 | /inventory/stock and /inventory/transactions | Stock **18**. `ADJUSTMENT` qty 2, from A-STG-001, notes "Count CNT-…: system 20 → counted 18", issue status SOLD. |
| 5 | Lines left blank | Not adjusted. |

- **Post-conditions / data checks:**
  - **No journal entry.** Cost layers stay 20 × 217.5 = 4,350 against the correct 18 × 217.5 = 3,915. Unposted shrink of 435.00 BOB (WORK-032).
  - Finalize is not a single database transaction. A failure halfway leaves some lines adjusted.

### INV-009 — Count negatives and stale baseline
- **Priority:** P2  | **Role:** store_manager, warehouse_worker  | **Type:** negative / boundary

| # | Step | Expected result |
|---|---|---|
| 1 | Counted −1 (API) | 400 `VALIDATION_ERROR`. |
| 2 | Counted 2.5 | 400 `VALIDATION_ERROR` (must be an integer). |
| 3 | Edit a line after finalize | 409 `COUNT_NOT_EDITABLE` "This count is finalized…". |
| 4 | Finalize again | 404 "Count not found or already finalized". |
| 5 | Line id from another count | 404 `COUNT_LINE_NOT_FOUND`. |
| 6 | Create count (system 20) → receive 5 more (stock 25) → count 20 → finalize | **Expected:** variance 0 against the frozen snapshot, or a warning. **Code:** difference is 0 against system 20, so the line is skipped and stock stays 25. Counted 18 instead: stock is **overwritten to 18**, and the 5 received units vanish silently. |
| 7 | `wh.user` creates or finalizes a count | 403 "Insufficient permissions". |

### INV-010 — Low-stock report threshold
- **Priority:** P2  | **Role:** store_manager  | **Type:** boundary
- **Preconditions:** P1 reorder point 15. P3 reorder point 0.
- **Test data:** a) A 8 + B 4 = 12. b) total 15. c) total 16. d) total 20 with 6 reserved.

| # | Step | Expected result |
|---|---|---|
| 1 | Data (a) → /inventory/low-stock | P1 listed. Available 12, reorder point 15, shortfall 3. |
| 2 | Data (b) | Listed, shortfall 0 (inclusive ≤). |
| 3 | Data (c) | Not listed. |
| 4 | Data (d) | Listed, available 14, shortfall 1. |
| 5 | P3 with 0 stock | Never listed (reorder point 0 is not monitored). |
| 6 | Store A alone at 0 while B has 20 | **Not listed.** The report is tenant-wide, not per store (gap for a 3-store retailer). |

### INV-011 — Putaway work line completion via API moves stock
- **Priority:** P1  | **Role:** warehouse_worker  | **Type:** happy / negative
- **Preconditions:** P2P-028 step 1 work exists (PUT A-RCV-001 → A-STG-001, qty 10). Stock A-RCV-001 = 10.

| # | Step | Expected result |
|---|---|---|
| 1 | API `POST /warehouse/work/:id/lines/:lineId/complete {quantity_done:11}` | 400 `WORK_LINE_OVER_COMPLETION`. |
| 2 | `{quantity_done:0}` | 400 "A completed work line must move a positive quantity." |
| 3 | `{quantity_done:10}` | 200. Line DONE. Work **COMPLETED**. |
| 4 | Repeat step 3 | 409 `WORK_LINE_ALREADY_DONE`. |
| 5 | Another work where A-RCV-001 has 3 reserved of 10 | 409 `WORK_SOURCE_STOCK_INSUFFICIENT` "Cannot move 10: only 7 is available…". |
| 6 | Log in as `auditor` or `cashier` and repeat step 3 on a fresh work | **Expected:** 403. **Code:** 200. Work routes have no guard. |

- **Post-conditions / data checks:** Stock A-RCV-001 0 → A-STG-001 10. Layer moved (10 @ 217.5 at A-STG-001, original received date kept). TRANSFER_OUT/IN pair with reference WAREHOUSE_WORK and notes "PUTAWAY — WRK-PA-…". No journal entry.

### INV-012 — Partial (short) work line
- **Priority:** P3  | **Role:** warehouse_worker  | **Type:** boundary

| # | Step | Expected result |
|---|---|---|
| 1 | Complete qty 6 of 10 | Line **SHORT**, 6 moved. Work stays open. |
| 2 | Complete the same line again with 4 | Allowed (SHORT ≠ DONE). Moves 4 more. `quantity_done` overwritten to 4 and line still SHORT (4 < 10), so the work never completes (suspected defect). |

### INV-013 — Wave release and pick work for a confirmed sales order
- **Priority:** P2  | **Role:** store_manager, warehouse_worker  | **Type:** happy / negative
- **Preconditions:** A-STG-001 P1 = 5 and nothing else in WH-A. WH-A has a shipping zone with location A-SHP-001. Sales order SO-1 for P1 × 5 on WH-A is **confirmed**, which reserves 5 and adds it to the open wave.

| # | Step | Expected result |
|---|---|---|
| 1 | /warehouse/waves | Wave OPEN with work count 0. |
| 2 | `wh.user` → Release | 403 "Insufficient permissions". |
| 3 | `sm.user` → Release | Wave **RELEASED**. Work `WRK-<ts>-SO-1` PICK OPEN, lines: PICK (from location?) and PUT (to A-SHP-001). |
| 4 | Inspect the PICK line from-location | **Expected:** A-STG-001. **Suspected actual:** empty, because the only 5 are reserved by SO-1 itself and pick-location lookup excludes reserved stock (`warehouse.service.ts:75`). |
| 5 | API complete the PUT line qty 5 | **Suspected actual:** 409 `WORK_SOURCE_LOCATION_MISSING`, or `WORK_SOURCE_STOCK_INSUFFICIENT` if a location resolved. Pass only if stock moves A-STG-001 → A-SHP-001 and SO-1 goes to PICKING. |
| 6 | Release a wave with no confirmed orders | 400 "No confirmed orders in wave". Release twice returns 404 "Wave not found or already released". |

- **Post-conditions / data checks:** If step 5 passes, reserved quantity stays on A-STG-001 while the units are at A-SHP-001 (reservation does not follow the move). Check shipment afterwards.

### INV-014 — Warehouse setup (locations)
- **Priority:** P3  | **Role:** store_manager, warehouse_worker  | **Type:** happy / permission

| # | Step | Expected result |
|---|---|---|
| 1 | /warehouse/locations → create warehouse without site and without create_site | 422 "A warehouse must belong to a site…" |
| 2 | Bulk locations (dry run) → aisle 1–2 × rack 1–3 | Plan shows total 6 and a sample, nothing written. With `dry_run:false`: created 6; re-run returns created 0, already exist 6. |
| 3 | `wh.user` create zone or location | 403 "Insufficient permissions". |
| 4 | Quick setup with country "Bolivia" | 400 `SITE_COUNTRY_REQUIRED`. |

### INV-015 — Costing method is FIFO regardless of configuration
- **Priority:** P2  | **Role:** admin  | **Type:** negative (gap)
- **Preconditions:** Item model group for P4 set to WEIGHTED_AVG or STANDARD, with no transactions yet.
- **Test data:** Receipt 1: 10 @ 250 (net 217.5). Receipt 2: 10 @ 300 (net 261.0).

| # | Step | Expected result |
|---|---|---|
| 1 | Receive both | **Expected for weighted average:** one average unit cost of 239.25. **Code:** two FIFO layers, 10 @ 217.5 and 10 @ 261.0. `costingMethod` is resolved but not used. |
| 2 | Sell or return 12 | Consumes the 217.5 layer first, then 2 @ 261.0 (FIFO). |

- **Post-conditions / data checks:** Inventory value 4,785.00 in both methods for the full 20 units. They differ only after partial consumption.

---

## Priority summary

| Priority | Cases |
|---|---|
| **P1 (22)** | P2P-001, 003, 004, 009, 014, 015, 016, 022, 023, 024, 025, 028, 031, 032, 034, 039, 044 · INV-001, 003, 004, 005, 006, 008, 011 |
| **P2 (24)** | P2P-002, 005, 006, 008, 010, 011, 017, 018, 019, 020, 021, 026, 027, 030, 033, 035, 036, 040, 041, 045, 046, 047 · INV-002, 007, 009, 010, 013, 015 |
| **P3** | The rest |

---

## Suspected defects / gaps

| # | Area | Finding | Location |
|---|---|---|---|
| 1 | SoD | No requester ≠ approver check. store_manager (and admin) approve their own requisitions. | `backend/src/modules/purchase/requisition.service.ts:216-257`; roles `shared/middleware/permissions.ts:138-145` |
| 2 | SoD / approval | RFQ can be created from an IN_REVIEW requisition, and awarding it closes the requisition and raises an order with no approval. | `rfq.service.ts:131-135`, `:644-673` |
| 3 | Double ordering | Requisition lines are not locked while an RFQ is open. Awarding does not check they are still open. A second award on an AWARDED case raises another order. | `rfq.service.ts:524`, `:644-659`; `requisition.service.ts:348` |
| 4 | SoD | No maker ≠ checker on vendor payments or invoice discrepancy approval (role-only). store_manager holds `order.create` + `receipt.post` + `vendor_invoice.post`. | `vendorPayment.service.ts:242-315`; `permissions.ts:140-142` |
| 5 | Atomicity | Receive-and-invoice commits the receipt before the invoice. A duplicate factura or any invoice failure leaves stock and journal posted with no invoice. | `purchase.routes.ts:675-696` |
| 6 | Accounting | Unreceived quantity on a partially matched invoice line posts to PRICE_VARIANCE. The later receipt accrual is never reversed. | `vendorInvoice.service.ts:764`, `:835` |
| 7 | Accounting | Credit note after full payment refused (`OVER_SETTLEMENT`) after stock and inventory were already reduced at ship. | `purchaseReturn.service.ts:~655-672` |
| 8 | Validation / tenancy | `/inventory/adjust` does not validate location (existence, warehouse, tenant). | `inventory/inventory.routes.ts:83-110` |
| 9 | Negative stock | `/inventory/adjust` allows the quantity to go below zero. No database check on `inventory_stock.quantity`. | `inventory.routes.ts:102`; `prisma/sql/000_baseline.sql:181` |
| 10 | Validation | Receipt location (header and line) not validated against the order's warehouse or tenant. The UI lists every location in the tenant. | `productReceipt.service.ts:174`, `:275`, `:301`; `frontend/.../purchase/orders/page.tsx:145` |
| 11 | Warehouse work | UI "Complete" calls `/work/:id/complete`, which marks COMPLETED without moving stock. It is also unguarded. | `frontend/.../warehouse/work/page.tsx:33`; `warehouse.routes.ts:379-385` |
| 12 | Permissions | `/warehouse/work/:id/start`, `/lines/:lineId/complete` and `/complete` have no role or permission check, so auditor and cashier can move stock. | `warehouse.routes.ts:359`, `:367`, `:379` |
| 13 | Arrival journal | (a) body spread straight into the database, so `status` and other fields can be forced; (b) cost layer at 0 because order lines are not loaded; (c) order `received_qty` not updated; (d) no journal entry or receipt document; (e) fallback zone type `'receive'` never matches `'receiving'`; (f) putaway PICK line has no source, so completion fails; (g) with registration requirements, arrival plus receipt doubles stock; (h) "New Journal" button inert. | `warehouse.routes.ts:414-425`; `warehouse.service.ts:304`, `:340`, `:350-360`, `:374`, `:397-405`, `:421-437`; `frontend/.../warehouse/arrival/page.tsx:33` |
| 14 | Pick work | Pick location lookup and stock move exclude the order's own reservation, so pick work for a fully reserved order cannot complete. Reservation does not move with the stock. | `warehouse.service.ts:75`, `:597` |
| 15 | Work SHORT | Re-completing a SHORT line overwrites `quantity_done`, and the work never reaches COMPLETED. | `warehouse.service.ts:535-546` |
| 16 | Transfers | No transfer order, no in-transit, no receive step, no number. Stock check outside the transaction (race). From = To allowed. Destination not validated. UI error message lost. | `inventory.service.ts:346-403`; `frontend/.../inventory/transfers/page.tsx:18` |
| 17 | Counting | Finalize overwrites stock with the counted quantity against a stale snapshot. No journal entry. No cost-layer adjustment. Not transactional. The UI cannot scope a count by location. | `inventory-count.routes.ts:103-161` (overwrite `:126`) |
| 18 | Inventory value | Adjustments and counts never touch cost layers or the ledger, so subledger and GL diverge. Matches the TEST fact "layers 40,277 vs GL 5,397". | `inventory.routes.ts:83-133`; `inventory-count.routes.ts:103-161` |
| 19 | Costing | Item model group `costing_method` (WEIGHTED_AVG, MOVING_AVG, STANDARD, LIFO) is accepted and stored but never used. Everything is FIFO. | `shared/services/itemPolicy.service.ts:32,57`; `inventory/product.routes.ts:378-389` |
| 20 | FX | No exchange rate on the purchase order. USD orders can be created and confirmed but cannot be received, invoiced or paid (WORK-026). | `shared/services/currency/documentCurrency.ts:18-34`; `prisma/schema.prisma` model PurchaseOrder |
| 21 | Low stock | Tenant-wide aggregate, not per store or warehouse. | `inventory.routes.ts:41-74` |
| 22 | Order validation | `warehouse_id` optional in the schema but NOT NULL in the database (likely 500). `PUT` with `lines:[]` leaves a zero-line order that can be confirmed. | `shared/schemas/index.ts:236`; `purchase.routes.ts:264-265`, `:404-411` |
| 23 | Duplicate invoice | Check includes CANCELLED invoices, so a cancelled factura number cannot be re-entered. Case-sensitive. | `vendorInvoice.service.ts:124-134` |
| 24 | Requisition status | Header never reaches CLOSED when any line was REJECTED. | `shared/services/documentChain.ts:201-205` |
| 25 | Bid rules | A bid can be recorded on a CREATED (unsent) or DECLINED request through the API. | `rfq.service.ts:303-308` |
| 26 | Return / order link | A shipped return does not reduce the order's received or invoiced quantities. | `purchaseReturn.service.ts:228-420` |
| 27 | UI | Partial receipt, invoice line editing, order currency, order cancel and purchase parameters have no UI. `PayModal` posts to a non-existent `/purchase/orders/:id/pay` (dead code). Stock adjust, transfer and count-finalize errors read `data.message` instead of `data.error.message`. Transactions filter has no PURCHASE_RETURN option; COUNT_ADJUSTMENT label unused. | `frontend/.../purchase/orders/page.tsx:28`, `:151-163`; `inventory/stock/page.tsx`; `inventory/counting/[id]/page.tsx`; `inventory/transactions/page.tsx:8-20` |
| 28 | Unenforced parameters | `require_requisition_for_po`, `vat_input_recognition` and `receipt_invoice_flow` exist in the schema but no code reads them. | `prisma/schema.prisma` model PurchaseParameters |
| 29 | Bolivia | No validation of NIT, authorisation code or control code before crediting IVA. Legacy mode recognises IVA credit at receipt, without a factura. | `vendorInvoice.service.ts:201-219`; `productReceipt.service.ts:627-717` |

## Uncertain — needs confirmation

1. **Prisma `upsert` with a null `variant_id`** in the compound unique key (`/inventory/adjust` at `inventory.routes.ts:93`, count finalize at `inventory-count.routes.ts:~117`). A comment in `warehouse.service.ts:612-615` says Prisma rejects null there. If so, adjustments and count finalization return 500 for every product without variants, which is most shoes-by-SKU setups. Run INV-003 and INV-008 on a no-variant product first.
2. **Number consumption on rollback.** `allocateNumber` runs inside the receipt, invoice, return and credit transactions. I did not confirm whether it rolls back or leaves gaps. This matters for factura sequence rules, even though these are internal numbers.
3. **Actual state of the purchase parameters in TEST.** No row means split mode OFF (legacy), approval ON, matching NONE and discrepancy ALLOW_WITH_WARNING. Confirm the row before running cases that depend on the baseline (P2P-031, 032, 044).
4. **Whether a purchase-parameter setup screen exists outside `(erp)/purchase`.** I found none. Preconditions currently need an admin or script to set them.
5. **Document number formats** (prefix and padding) come from the number sequence setup rows. The cases name the sequence reference, not the exact format.
6. **Whether posting profiles for PRICE_VARIANCE and PURCHASE_EXPENSE exist in TEST.** If they don't, invoice posting returns `journal_entry_id` null with note "…unresolved and require_balanced_posting is off", or refuses, depending on `require_balanced_posting`.
7. **Catalog Level 3/4 IDs** under 75.40, 75.50 and 60.x. The matrix marks them UNVERIFIED pending the workbook, so the cases cite Level 2 IDs only.
8. **P2P-013 step 4 and INV-005 (d):** whether a cross-tenant location UUID gets past the foreign key. It is a plain FK to `warehouse_locations.id`, so it would be accepted. Needs one controlled check in TEST with a second tenant, and a security review.
9. **INV-013:** whether sales confirm in TEST really adds orders to a wave and reserves at the same location the wave picks from. The reservation defect (#14) comes from reading the code, not from running it.
