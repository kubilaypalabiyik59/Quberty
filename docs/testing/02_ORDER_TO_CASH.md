# Quberty ERP: Manual Test Cases for Order to Cash, Storefront and Web POS

**Basis:** these cases come only from reading the code on branch `codex/rebuild-2026-09-07`. Nothing was executed, no file was changed, and no `.env` value was opened. Every expected result describes what the code does today. Where the code looks wrong, the case says what actually happens and marks it **(defect probe)**.

⚠️ = running this case on TEST **uses up a real FACTURA number**. Kubi must approve it first.

---

## 0. Global setup, tax reference and conventions

### 0.1 Where a FACTURA number is used, stock moves and the GL posts

| Step | Route | FACTURA | Stock | GL |
|---|---|---|---|---|
| Qualify lead / confirm quotation | `crm`, `quotation` | – | – | – |
| Order create | `POST /sales/orders` | – | – | – |
| Order confirm | `POST /:id/confirm` | – | `reserved_qty += qty` in the order's warehouse | – |
| Order ship | `POST /:id/ship` | – | `quantity −= qty` (cost layers use FIFO), `reserved_qty −=`, OUTBOUND transaction, shipment `SHP-<epoch>` | Dr COGS / Cr INVENTORY = qty × `product.cost_price`, one pair per item group (`SALES_COGS`) |
| Invoice | `POST /:id/invoice` | **+1** (allocated inside the transaction) | – | Dr AR (total), Dr TAX_TURNOVER_EXPENSE (IT) / Cr REVENUE (net, split by item group), Cr VAT_OUTPUT (IVA), Cr TAX_TURNOVER_PAYABLE (IT) (`SALES_INVOICE`) |
| Pay (full only) | `POST /:id/pay` | – | – | Dr account `account_code` (default 1102) / Cr AR (`SALES_PAYMENT`) |
| Return | `POST /:id/return` | **+1** (credit note, negative amounts) | `quantity += qty` on the first stock row in the order's warehouse, RETURN transaction | Invoice reversal only if invoiced. COGS reversal always (if cost > 0). Refund Dr AR / Cr BANK only if paid (`SALES_RETURN`) |
| Storefront checkout | `POST /sales/orders/storefront` | – | `quantity −=` immediately in the storefront warehouse. No reservation. Status CONFIRMED | – |
| POS sale | `POST /pos/sale` | **+1** | `quantity −=` in the session's warehouse | Dr AR / Cr REVENUE / Cr VAT_OUTPUT / Dr IT exp / Cr IT payable (`POS_SALE`) plus COGS (`POS_COGS`) |
| POS void | `POST /pos/sales/:id/void` | – (the factura stays ISSUED) | Stock goes back to the original locations | Dr REVENUE, Dr VAT_OUTPUT / Cr AR, plus Dr INVENTORY / Cr COGS (`POS_VOID`). **IT is not reversed** |
| Manual factura | `POST /finance/facturas` | **+1** | – | – |

### 0.2 Tax reference: run O2C-000 before anything else

Sales tax is computed on the **document total**. `computeDocumentTax` handles it (`documentTax.service.ts`), and `calculateTax` (`tax.service.ts:162`) rounds with `round2` per tax line. The result depends on the `TaxCode.base_kind` rows on TEST:

| Regime on TEST | Bs 1,130.00 gives net / IVA / IT | Bs 565.00 gives net / IVA / IT |
|---|---|---|
| **A. Engine, IVA GROSS + IT GROSS** (the Ley 843 decision in `BOLIVIA_TAX_BASIS.md`) | **983.10 / 146.90 / 33.90** | 491.55 / 73.45 / 16.95 |
| B. Engine, IVA NET-inclusive + IT GROSS (this is the arithmetic of the example in your brief) | 1,000.00 / 130.00 / 33.90 | 500.00 / 65.00 / 16.95 |
| C. Engine NET/NET, or the legacy fallback `config/tax.ts` (legacy values are not rounded until stored at 2 dp) | 1,000.00 / 130.00 / 30.00 | 500.00 / 65.00 / 15.00 |

The worked examples below assume **regime A**. If O2C-000 shows another regime, replace the figures from this table. Two things hold in every regime: the customer total stays 1,130.00 and IT is never added to it.

Invoice voucher for Bs 1,130 in regime A:
- Dr AR 1,130.00 and Dr IT expense 33.90
- Cr Revenue 983.10, Cr VAT output 146.90, Cr IT payable 33.90
- Both sides total 1,163.90

### 0.3 Common test data (create once on TEST; none of this uses a number)

- **Users:** one each for `admin`, `store_manager`, `cashier`, `employee`, `auditor`, and a storefront `customer`.
- **Warehouses:** WH-A (Sales parameters default warehouse, also used for the storefront) and WH-B.
- **P1 "TEST-SHOE-A":** selling 565.00, cost_price 250.00, published, stocked, no item-group picking or deduction requirements. Stock: 10 in WH-A, 0 in WH-B.
- **P2 "TEST-SHOE-HIDDEN":** `is_published=false`, cost_price 300.00, stock 5 in WH-A.
- **P3 "TEST-SHOE-B-ONLY":** published, selling 565.00, stock 0 in WH-A and 3 in WH-B.
- **Pipeline stages:** at least 2 active stages, e.g. "Prospecting" at 25% (sort 1) and "Proposal" at 60% (sort 2).
- **Reading state without SQL:**
  - `/inventory/stock` shows quantity and reserved
  - `/inventory/transactions`
  - `/finance/journal`
  - `/finance/facturas`
  - `/setup/numbering` shows the FACTURA next number and highest issued
  - `/finance/aging` is the AR aging report
- **"API" steps** mean no UI exists for that action. Use an HTTP client against `/api/v1` with `Authorization: Bearer <token>` and `X-Tenant-ID: <tenant uuid>`.
- **Error envelope:** `{ success:false, error:{ message, code } }`.
  - `AppError` without a code returns `APP_ERROR`.
  - A Zod failure returns 400 `VALIDATION_ERROR` with `details`.
  - A permission guard returns 403 `Permission denied: <first missing code>`.

### O2C-000 — Find out which tax regime and FACTURA mode TEST uses (read-only)
- **Priority:** P1  | **Role:** admin  | **Type:** boundary
- **Preconditions:** TEST tenant has ledger currency set up.
- **Test data:** amount 1130
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | API `GET /finance/tax/preview?amount=1130&side=SALES` | 200 with `subtotal`, `vat`, `turnover`, `lines[]` and `source` (`ENGINE` or `LEGACY`). Each line's `base` shows GROSS or NET: base 1130 means GROSS. |
| 2 | `/setup/numbering` → FACTURA row | Shows format `{######}`, manual flag, continuous flag and next number. Write down **N0 = next number**. |
| 3 | Compare the result with table 0.2 | Pick regime A, B or C for all later cases. |
- **Post-conditions / data checks:** nothing is written. If FACTURA `continuous=false`, the "failure does not burn a number" cases (O2C-040 and O2C-052) are expected to **fail**; see the defects section.

---

## A. CRM: leads and opportunities

### O2C-001 — Create a lead, plus field validation
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** LEAD number sequence exists.
- **Test data:** Company "Test Calzados SRL", first "Ana", email `ana@test.bo`, source REFERRAL, rating HOT, estimated 10000
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/crm/leads` → New lead → leave First name empty | Submit is blocked with "A first name is required." |
| 2 | Fill in the data → Create lead | Dialog closes. New row shows lead_number from the LEAD sequence, status **OPEN**, source REFERRAL, rating HOT, estimated 10,000. "Converted to" shows —. |
| 3 | New lead with email `not-an-email` | 400 VALIDATION_ERROR; the dialog shows the message. |
| 4 | Search box → type "Calzados" | The row is found (search covers company, first/last name, email, number). |
- **Post-conditions / data checks:** `currency` = ledger accounting currency. No customer is created and the lead is not in `/sales/customers`.

### O2C-002 — Qualify a lead: creates a customer and an opportunity
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy
- **Preconditions:** O2C-001 lead is OPEN; stages exist.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/crm/leads` → row → **Qualify** | 200. Status becomes **QUALIFIED** and "Converted to" shows a new customer code. |
| 2 | `/sales/customers` | New customer: first_name "Ana", last_name "" (the lead had no last name), email copied. |
| 3 | `/crm/leads/[id]` | Qualified date is set. The Opportunities table has 1 row addressed to the customer, stage = lowest sort_order active stage, probability = that stage default (25), estimated 10,000. |
| 4 | `/crm/opportunities` | Opportunity is OPEN, named "Test Calzados SRL". |
- **Post-conditions / data checks:** opportunity has `customer_id` set, `lead_id` null, `originating_lead_id` = lead. Weighted pipeline for the stage rises by 10,000 × 25% = 2,500.00.

### O2C-003 — Qualify refused when the lead is already qualified or disqualified
- **Priority:** P2  | **Role:** store_manager  | **Type:** negative
- **Preconditions:** lead L-Q is QUALIFIED; lead L-D is DISQUALIFIED.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | API `POST /crm/leads/{L-Q}/qualify` `{}` (UI hides the button) | 409 "Lead <no> is already qualified." |
| 2 | API `POST /crm/leads/{L-D}/qualify` | 409 "Lead <no> was disqualified. Reopen it before qualifying." |
| 3 | API qualify an OPEN lead with `customer_id` = random UUID | 404 "Customer not found". An OPPORTUNITY number was still allocated before the transaction, so a gap is expected (non-continuous sequence). |
- **Post-conditions / data checks:** no customer or opportunity rows are created.

### O2C-004 — Disqualify (with and without an opportunity) and reopen
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** lead L2 OPEN without an opportunity; lead L-Q (from O2C-002) has an opportunity.
- **Test data:** reason "No budget"
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/crm/leads` → L2 → Disqualify → type "No budget" | Status **DISQUALIFIED**; the lead detail shows Reason "No budget". |
| 2 | Row L2 → **Reopen** | Status OPEN; disqualified date, reason and qualified date are cleared. |
| 3 | API `POST /crm/leads/{L-Q}/disqualify` `{reason:"x"}` | 409 "Lead <no> has 1 opportunity attached and cannot be disqualified. Close the opportunity as lost instead." |
| 4 | Disqualify an already DISQUALIFIED lead through the API | 200, lead returned unchanged (no-op). |
- **Post-conditions / data checks:** reopening a QUALIFIED lead through the API returns it to OPEN but keeps `converted_customer_id`.

### O2C-005 — Convert to customer without qualifying (API only), idempotent
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / boundary
- **Preconditions:** OPEN lead L3 with company "Solo Company", no first name issue.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | API `POST /crm/leads/{L3}/convert-to-customer` | 200 with the customer. Lead status **stays OPEN**; `converted_customer_id` is set. |
| 2 | Repeat the same call | 200 with the **same** customer id; no second customer. |
| 3 | As `employee` repeat the call | 403 "Permission denied: crm.lead.maintain". |
- **Post-conditions / data checks:** exactly one customer. **Gap:** there is no UI button for this action.

### O2C-006 — Move opportunity stage and check the weighted pipeline
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** OPEN opportunity O1 (estimated 10,000, stage Prospecting 25%).
- **Test data:** target stage "Proposal" (60%)
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/crm/opportunities/[O1]` → Stage select → Proposal | 200. Probability becomes **60** (stage default). |
| 2 | `/crm/opportunities` | "Weighted" goes from 2,500 to **6,000.00** for this deal. Stage bar totals update. |
| 3 | Pick "— unstaged —" in the select | Nothing happens: the handler ignores an empty value, so an opportunity cannot be unstaged from the UI. |
| 4 | API `POST /opportunities/{O1}/stage` `{stage_id:<uuid not in tenant>}` | 404 "Pipeline stage not found". |
| 5 | API move with `{stage_id, probability: 90}` | Probability 90 (the override wins). |
- **Post-conditions / data checks:** `GET /crm/opportunities/pipeline` returns per stage `total`, `weighted` = Σ(amount × prob / 100), 2 dp.

### O2C-007 — Close opportunity as WON or LOST; LOST closes its open quotations
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** O2 is OPEN with quotation Q-a (DRAFT) and Q-b (SENT). O3 is OPEN.
- **Test data:** reason "Price too high"
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/crm/opportunities/[O2]` → **Lost** → type the reason | Status **LOST**, probability 0, Closed date set. |
| 2 | `/sales/quotations` | Q-a and Q-b are now **LOST**, outcome_reason "Price too high". |
| 3 | `/crm/opportunities/[O3]` → **Won** | Status WON, probability 100. **No sales order is created.** |
| 4 | API `POST /opportunities/{O3}/stage` | 409 "Opportunity <no> is WON and cannot be moved." |
| 5 | API `POST /opportunities/{O3}/close` `{outcome:"LOST"}` | 409 "Opportunity <no> is already WON." |
| 6 | API close with `{outcome:"MAYBE"}` | 400 "outcome must be WON, LOST or CANCELLED". |
| 7 | As `employee` press Won | 403 "Permission denied: crm.opportunity.close". |
- **Post-conditions / data checks:** closed opportunities drop out of the weighted pipeline.

---

## B. Sales quotations

### O2C-008 — Create a quotation for a customer (API) and check totals
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** customer C1; P1 exists. **Gap:** there is no UI to create a quotation.
- **Test data:** `{customer_id:C1, warehouse_id:WH-A, lines:[{product_id:P1, quantity:2, unit_price:565}]}`
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | API `POST /sales/quotations` with the data | 201. Number from SALES_QUOTATION. Status **DRAFT**, revision 0. `subtotal` 1,130.00 (gross). `tax_amount` = IVA of 1,130 (A: 146.90). `total_amount` 1,130.00. `valid_until` = today + quotation_validity_days (30). |
| 2 | `/sales/quotations/[id]` | Amounts: Net 983.10 ("Net" = subtotal − tax), "IVA 13% (included)" 146.90, Gross 1,130.00, Total 1,130.00 plus currency code. |
| 3 | API POST with both `customer_id` and `lead_id` | 400 VALIDATION_ERROR "Provide exactly one party: customer_id or lead_id". |
| 4 | API POST with `lines: []` | 400 VALIDATION_ERROR "At least one line is required". |
| 5 | API POST against an opportunity that is WON | 409 "Opportunity <no> is WON; cannot quote against it." |
| 6 | API POST with `currency:"USD"` (not the ledger currency) | 4xx `SALES_FX_NOT_IMPLEMENTED` (no quotation created). The SALES_QUOTATION number is allocated first, so a gap is expected. |
- **Post-conditions / data checks:** no GL, no stock effect.

### O2C-009 — Edit lines while DRAFT or SENT, read-only after confirm, fractional quantity
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / boundary
- **Preconditions:** Q1 DRAFT (O2C-008). QC CONFIRMED.
- **Test data:** new lines qty 3 × 565, discount_pct 10; then qty 2.5
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | API `PUT /sales/quotations/{Q1}/lines` `{lines:[{product_id:P1,quantity:3,unit_price:565,discount_pct:10}]}` | 200. line_total 1,525.50. subtotal 1,525.50. tax recomputed (A: 198.32). total 1,525.50. |
| 2 | Same call on QC | 409 "Quotation <no> is CONFIRMED and is read-only. Create a revision instead." |
| 3 | PUT Q1 with quantity 2.5 | 200 (quotation lines accept decimals). |
| 4 | `/sales/quotations/[Q1]` → Confirm → order | 400 "Cannot convert quotation <no>: sales order lines hold whole quantities only, but 1 line(s) have fractional quantities (2.5). Adjust the quotation first." No order is created. |
- **Post-conditions / data checks:** set Q1 back to integer quantities for later cases. **Gap:** there is no line-edit UI.

### O2C-010 — Send quotation
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** Q1 DRAFT.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/sales/quotations/[Q1]` → **Send** | Status **SENT**; Sent date set; valid_until kept, or defaulted if it was null. The Send button disappears. |
| 2 | API `POST /{Q1}/send` again | 409 "Only a DRAFT quotation can be sent; <no> is SENT." |
| 3 | As `employee` open the page and press Send | 403 "Permission denied: sales.quotation.send" shown in the error note. |
- **Post-conditions / data checks:** no GL.

### O2C-011 — Revise creates a new version
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** Q1 SENT, revision 0.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/sales/quotations/[Q1]` → **Revise** | 201; the browser goes to the new quotation Q1′. |
| 2 | Q1′ detail | **New quotation_number** (next SALES_QUOTATION). Status **DRAFT**, revision **1**, "Supersedes" links to Q1. Lines, amounts, currency, warehouse and valid_until are copied. |
| 3 | Open Q1 | Status **REVISED**, closed; "Superseded by" = Q1′. Buttons hidden (not editable). |
| 4 | API `POST /{Q1}/revise` | 409 "Quotation <no> has already been revised." |
| 5 | API revise a CONFIRMED quotation | 409 "…is already confirmed as order — revise the order instead." |
| 6 | (defect probe) API revise a LOST quotation | **201**: a closed or lost offer can be revived as a DRAFT revision. |
- **Post-conditions / data checks:** Q1 lines are unchanged (history kept).

### O2C-012 — Confirm a quotation for a lead-only prospect: customer and order are created
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy
- **Preconditions:** OPEN lead L4 (no customer). Sales parameter `auto_convert_lead_on_confirm` = true (default). Optional OPEN opportunity O4 addressed to L4.
- **Test data:** API `POST /sales/quotations {lead_id:L4, opportunity_id:O4, warehouse_id:WH-A, lines:[P1×2@565]}`
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Open the quotation | Blue banner: "addressed to a prospect… Confirming it will create the customer record automatically". Subtitle "Prospect <lead no> … — not a customer yet". |
| 2 | **Confirm → order** | 201. Status **CONFIRMED**; DocumentChain shows the Sales order number. |
| 3 | `/sales/customers` | New customer created from L4. |
| 4 | `/sales/orders/[new]` | Status **DRAFT**, source `manual`, customer = new customer, warehouse WH-A (site re-derived), subtotal / tax / total copied exactly (1,130 / 146.90 / 1,130), 1 line qty 2. |
| 5 | `/crm/leads/[L4]` | Status **QUALIFIED**, converted customer set. |
| 6 | `/crm/opportunities/[O4]` | Status **WON**, probability 100, outcome "Quotation <q> confirmed as order <SO>". |
| 7 | API `POST /{q}/confirm` again | 409 "Quotation <no> is already confirmed." |
| 8 | As `store_manager` the guard needs `sales.quotation.confirm` + `sales.order.create` + `customer.create`; repeat as `employee` on another quotation | 403 "Permission denied: sales.quotation.confirm". |
- **Post-conditions / data checks:** no stock reservation yet (the order is DRAFT). No GL. No FACTURA.

### O2C-013 — Confirm refused when auto-convert is off (configuration)
- **Priority:** P3  | **Role:** admin  | **Type:** negative
- **Preconditions:** set `SalesParameters.auto_convert_lead_on_confirm=false` on TEST (approval: this changes a tenant parameter). Lead-only quotation Q-L is SENT.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Q-L → Confirm → order | 409 "Quotation <no> is addressed to lead <lead>. Convert the lead to a customer first (auto_convert_lead_on_confirm is off)." |
| 2 | API convert-to-customer for the lead, then Confirm again | Still 409: confirm reads `q.customer_id` (null on the quotation), not the lead's converted customer **(defect probe)**. |
- **Post-conditions / data checks:** restore the parameter.

### O2C-014 — Mark lost / cancel, and a confirmed quotation cannot be closed
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** QX SENT, QY DRAFT, QC CONFIRMED.
- **Test data:** reasons
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | QX → **Lost** → "Competitor" | Status LOST, outcome "Competitor", buttons hidden. |
| 2 | QY → **Cancel** → "Duplicate" | Status CANCELLED. |
| 3 | API `POST /{QC}/lose` | 409 "Quotation <no> became an order and cannot be closed." |
| 4 | (defect probe) API `POST /{QX}/cancel` (already LOST) | **200**: the status is overwritten to CANCELLED. |
| 5 | As `employee` press Lost on another quotation | 403 "Permission denied: sales.quotation.close". |
- **Post-conditions / data checks:** no order and no GL.

### O2C-015 — Quotation expiry, and a stale quotation confirmed from its detail page
- **Priority:** P2  | **Role:** store_manager  | **Type:** boundary / defect probe
- **Preconditions:** none.
- **Test data:** two quotations with `valid_until` = yesterday (API): QE1 and QE2
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Send QE1 and QE2 from the detail page (do **not** open the list) | Both SENT; valid_until stays yesterday. |
| 2 | Navigate directly to `/sales/quotations/[QE2]` (the detail GET does not run the expiry sweep) → Confirm → order | **201, order created** even though validity has passed (confirm does not check `valid_until`) **(defect probe)**. |
| 3 | Open `/sales/quotations` (the list) | The list call runs `expireOverdueQuotations`: QE1 becomes **EXPIRED**, closed_at set. QE2 stays CONFIRMED. |
| 4 | QE1 detail → buttons | No buttons (not editable). API confirm → 409 "Quotation <no> is EXPIRED and cannot be confirmed." |
| 5 | A DRAFT quotation with a past valid_until | Stays DRAFT; only SENT quotations expire. |
- **Post-conditions / data checks:** "expired" means `valid_until < today 00:00` in server local time.

---

## C. Lead-to-cash end to end

### O2C-016 ⚠️ — Lead → opportunity → quotation → order → confirm → ship → invoice → pay
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy
- **Preconditions:** O2C-000 done (regime and N0 known). P1 has 10 in WH-A, reserved 0. FACTURA automatic. Posting profiles resolve AR, REVENUE, VAT_OUTPUT, TAX_TURNOVER_*, COGS, INVENTORY. Current accounting period open. Account 1102 exists.
- **Test data:** lead "E2E Tienda", est 1,130; quotation P1 × 2 @ 565 = Bs 1,130.00
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/crm/leads` → New lead → Qualify | Lead QUALIFIED, customer CE and opportunity OE created (O2C-002). |
| 2 | API create a quotation `{customer_id:CE, opportunity_id:OE, warehouse_id:WH-A, lines:[P1×2@565]}` | DRAFT, total 1,130.00. |
| 3 | Quotation → Send → **Confirm → order** | Quotation CONFIRMED, OE **WON**, SO created as **DRAFT** (`SO-YYYY-NNNNN`). |
| 4 | `/sales/orders/[SO]` → **Confirm** | Status **CONFIRMED**. `/inventory/stock` P1 WH-A: qty 10, **reserved 2**. A picking wave is created for WH-A. |
| 5 | **Ship** | Status **SHIPPED**, shipped_at set. Stock P1 WH-A **qty 8, reserved 0**. `/inventory/transactions`: OUTBOUND 2 referencing the SO. `/finance/journal`: `COGS: SO-…` Dr COGS **500.00** / Cr Inventory 500.00 (2 × 250). Customer CE lifetime_value +1,130, total_orders +1. |
| 6 | Invoice section → **Issue Factura** → NIT "1234567" → submit | 201. Panel "Invoice Issued — Factura #<N0 padded to 6>". Shows IVA **146.90**, IT **33.90**, Total **1,130.00**. |
| 7 | `/finance/journal` | "Sales Invoice: SO-… — Factura #…": Dr AR 1,130.00; Dr IT expense 33.90; Cr Revenue 983.10; Cr VAT output 146.90; Cr IT payable 33.90 (balanced 1,163.90). |
| 8 | `/sales/orders` → row → **Collect** → date today, Received Into "1102 — Bancos" → Record Payment | Message "Payment recorded for order SO-…". Row shows **Paid**. |
| 9 | `/finance/journal` | "AR Payment: SO-…": Dr 1102 1,130.00 / Cr AR 1,130.00. |
| 10 | Order → **Complete** | Status **COMPLETED**. |
- **Post-conditions / data checks:** FACTURA next number = **N0 + 1**. `/finance/facturas` has 1 new row (source SALE, status ISSUED, subtotal 983.10). AR net for this order = 0. The order does not appear in `/finance/aging`.

---

## D. Sales orders

### O2C-017 — Create a manual order, and the discount is silently dropped (defect probe)
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / defect probe
- **Preconditions:** customer C1, P1.
- **Test data:** P1 × 2 @ 565, header Discount Amount 100, warehouse WH-A
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/sales/orders` → New order → fill in the data | The form preview shows total 1,030.00 (1,130 − 100). |
| 2 | Save | 201, order **DRAFT**, source `manual`, site = WH-A's site, currency = ledger. |
| 3 | Open the order | **Total 1,130.00, discount 0.** `CreateSalesOrderSchema` has no `discount_amount`, so Zod strips it **(defect)**. `tax_amount` = IVA of 1,130. |
| 4 | New order with no lines | 400 VALIDATION_ERROR "At least one line is required". |
| 5 | New order line quantity 1.5 (API) | 400 "Quantity must be a positive integer". |
| 6 | New order with `customer_id` from another tenant (API) | Refused before an SO number is drawn (`assertTenantReferences`). |
- **Post-conditions / data checks:** no stock or GL change.

### O2C-018 — Confirm reserves stock; insufficient stock is refused
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** P1 WH-A qty 8, reserved 0. P3 WH-A qty 0 (3 in WH-B).
- **Test data:** SO-R: P1 × 3, WH-A. SO-X: P3 × 1, WH-A. SO-Y: P1 × 99, WH-A.
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/sales/orders` → SO-R → **Confirm** (list button) | CONFIRMED; stock P1 WH-A qty 8 / **reserved 3**. |
| 2 | SO-X → Confirm (list) | Alert: "Insufficient stock for TEST-SHOE-B-ONLY (<sku>). Available: 0, Required: 1". Status stays DRAFT. WH-B stock is **not** considered. |
| 3 | SO-Y → Confirm from the **detail page** | Nothing visible happens: the detail `confirmOrder` mutation has no `onError` **(UI defect)**. In the browser network tab: 400 "Insufficient stock … Available: 5, Required: 99". |
| 4 | API confirm SO-R again | 400 "Cannot confirm order in CONFIRMED status". |
- **Post-conditions / data checks:** available = Σqty − Σreserved in the order's warehouse. A non-stocked item group returns infinite availability.

### O2C-019 — Edit an order: warehouse change; editing a CONFIRMED order does not adjust the reservation
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / defect probe
- **Preconditions:** SO-D DRAFT (P3 × 1, WH-A). SO-R CONFIRMED (P1 × 3, reserved 3).
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/sales/orders` → SO-D → Edit → Warehouse WH-B → save | 200. The order detail shows WH-B and site = WH-B's site. |
| 2 | SO-D → Confirm | CONFIRMED; P3 WH-B reserved 1. |
| 3 | SO-R → Edit → change qty 3 → 5, discount 50 → save | 200. Lines replaced; subtotal 2,825.00. **total_amount = 2,825.00 (discount ignored)**. Stock reserved **still 3**: no re-check, no re-reservation **(defect)**. |
| 4 | An invoiced order → Edit (API PUT) | 400 "Cannot edit an order that has already been invoiced". |
| 5 | A SHIPPED order → API PUT | 400 "Can only edit DRAFT or CONFIRMED orders". |
- **Post-conditions / data checks:** after step 3, shipping SO-R would take 5 while only 3 were reserved.

### O2C-020 — Ship the whole order only (no partial shipment)
- **Priority:** P2  | **Role:** store_manager  | **Type:** boundary
- **Preconditions:** SO-R CONFIRMED with qty 5 on P1 (WH-A qty 8).
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Look for a ship-quantity input on the order detail or list | None. Ship posts `{}`; there is no line quantity in the API. |
| 2 | Ship | The **full** quantity 5 is deducted; SHIPPED. One shipment `SHP-<epoch>`. |
| 3 | API `POST /:id/ship` on the SHIPPED order | 400 "Cannot ship order in SHIPPED status". |
| 4 | API ship a DRAFT order | 400 "Cannot ship order in DRAFT status". |
- **Post-conditions / data checks:** partial shipment is **not supported**. OUTBOUND transactions may reference cost layers in **any** warehouse (FIFO `inventoryCostLayer` is not filtered by warehouse), so compare the `from_location` of each transaction with WH-A **(defect probe)**.

### O2C-021 — Picking requirement blocks ship (configuration)
- **Priority:** P3  | **Role:** store_manager  | **Type:** negative
- **Preconditions:** an item group with `pickingRequirements=true` on product P4. SO-P CONFIRMED with P4. No completed PICK work.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | SO-P → Ship (list) | Alert: "1 line(s) on SO-… require a completed picking list before the shipment can be posted. Complete the warehouse pick work first." (409 PICKING_REQUIRED) |
| 2 | Complete the PICK work in `/warehouse/work` → Ship | SHIPPED. |
- **Post-conditions / data checks:** no stock deducted on the refused attempt.

### O2C-022 ⚠️ — Invoice (FACTURA): amounts, voucher, deduction gate
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** SO-I CONFIRMED (not shipped), total 1,130, customer with NIT "7654321". N = FACTURA next number.
- **Test data:** notes "Test invoice"
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | SO-I detail → Issue Factura | Form shows Customer (read-only), NIT, the tax preview from `/finance/tax/preview` (lines per tax code), and the FACTURA sequence check. Submit is disabled until the sequence status is `ready`. |
| 2 | Submit with NIT blank | 201. Factura `factura_number` = N (format `{######}`), source_type SALE, customer_nit = the customer's NIT (fallback), subtotal 983.10, iva 146.90, it 33.90, total 1,130.00. Status ISSUED. |
| 3 | Check factura lines | `writeFacturaLines` creates lines from the SO lines; SO lines are marked invoiced. |
| 4 | `/finance/journal` | Voucher as in 0.2, description "Sales Invoice: SO-… — Factura #N". |
| 5 | Invoicing a CONFIRMED order without shipment | **Allowed** unless the item group has `deductionRequirements` (then 409 DEDUCTION_REQUIRED "…Ship SO-… first."). |
- **Post-conditions / data checks:** FACTURA next = **N+1**. AR increases by 1,130 (the order appears in `/finance/aging` bucket 0-30).

### O2C-023 — Invoice refused: invoice twice, DRAFT/CANCELLED, number supplied on an automatic series
- **Priority:** P1  | **Role:** store_manager  | **Type:** negative
- **Preconditions:** SO-I invoiced (O2C-022). SO-D2 DRAFT. SO-C CANCELLED. FACTURA automatic. Note N′ = next number.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | SO-I detail | Shows "Invoice Issued"; no Issue button. |
| 2 | API `POST /sales/orders/{SO-I}/invoice` `{}` | **409 "This order already has an invoice"**. |
| 3 | API invoice SO-D2 | 400 "Cannot invoice an order in DRAFT status. Confirm it first." |
| 4 | API invoice SO-C | 400 "Cannot invoice an order in CANCELLED status. Confirm it first." |
| 5 | API invoice an uninvoiced CONFIRMED order with `{factura_number:"999"}` | 400 NUMBER_SEQUENCE_NOT_MANUAL "…generates its own numbers, so one cannot be supplied…" (the transaction rolls back). |
| 6 | As `cashier` API invoice | 403 "Permission denied: sales.invoice.post" (the workforce gate lets a cashier through; the route guard refuses). |
- **Post-conditions / data checks:** FACTURA next number still **N′**: no number consumed by any of these steps.

### O2C-024 — Full payment only, duplicate payment refused, AR aging
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / negative / boundary
- **Preconditions:** SO-I invoiced and unpaid (1,130). SO-U CONFIRMED not invoiced.
- **Test data:** payment date today, account 1101
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/finance/aging` (AR) | SO-I in bucket **0-30** (age from order `created_at`, not invoice date), summary 0-30 includes 1,130. |
| 2 | Collect modal | **No amount field**: payment is always the full `total_amount`. Partial payment is not supported. |
| 3 | Record Payment → 1101 Caja | Message "Payment recorded for order SO-…". Voucher Dr 1101 1,130 / Cr AR 1,130. |
| 4 | API `POST /{SO-I}/pay` again | 409 "This order has already been paid". |
| 5 | API pay SO-U | 400 "Order has no invoice. Issue a Factura first." |
| 6 | API pay with `account_code:"9999"` on another invoiced order | 400 "Payment account '9999' does not exist in the chart of accounts." |
| 7 | Reload `/finance/aging` | SO-I no longer listed. |
- **Post-conditions / data checks:** `paid_at`, `paid_by` set; AR for SO-I nets to 0.

### O2C-025 — Complete an order
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** SO-S SHIPPED; SO-R2 CONFIRMED.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | SO-S → Complete | COMPLETED, completed_at set (no invoice required). |
| 2 | API complete SO-R2 | 409 ORDER_NOT_COMPLETABLE "Only a SHIPPED order can be completed (order is CONFIRMED)". |
- **Post-conditions / data checks:** no stock or GL change.

### O2C-026 — Cancel DRAFT/CONFIRMED releases the reservation; cancel after ship refused; store_manager refused
- **Priority:** P1  | **Role:** admin; store_manager  | **Type:** happy / negative / permission
- **Preconditions:** SO-K1 DRAFT. SO-K2 CONFIRMED P1 × 2 (reserved 2). SO-S SHIPPED. SO-CO COMPLETED.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | **store_manager**: `/sales/orders` → SO-K1 → Cancel → OK | The button is visible, but the alert shows "Permission denied: sales.order.cancel" (403). Only admin may cancel. |
| 2 | **admin**: SO-K1 → Cancel | CANCELLED. |
| 3 | admin: SO-K2 → Cancel | CANCELLED. P1 reserved −2. |
| 4 | admin: API cancel SO-S | 400 **"Cannot cancel order in SHIPPED status"**. |
| 5 | admin: API cancel SO-CO | 400 "Cannot cancel order in COMPLETED status". |
| 6 | (defect probe) Two CONFIRMED orders for P1 in **different warehouses**; cancel one | `releaseReservation` is not scoped by order or warehouse, so the other warehouse's reservation may be released. Check reserved in both. |
- **Post-conditions / data checks:** a cancelled order cannot be invoiced (see O2C-023).

### O2C-027 ⚠️ — Cancelling an invoiced CONFIRMED order is allowed (defect probe)
- **Priority:** P2  | **Role:** admin  | **Type:** negative / defect probe
- **Preconditions:** SO-V CONFIRMED and invoiced (uses 1 FACTURA), unpaid.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/sales/orders` → SO-V row | The Cancel button is shown (condition: DRAFT/CONFIRMED only, invoice not checked). |
| 2 | Cancel → OK | **200 CANCELLED**. Factura stays **ISSUED**; the AR voucher is not reversed; reservation released. |
| 3 | `/finance/aging` | SO-V drops out (CANCELLED excluded), yet GL AR still carries 1,130 → the AR subledger no longer ties to the GL. |
- **Post-conditions / data checks:** record this as a defect; do not repeat.

### O2C-028 ⚠️ — Return a shipped, invoiced and paid order (credit note)
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / negative
- **Preconditions:** SO-E2E from O2C-016 is COMPLETED, invoiced, paid; P1 WH-A qty 8. N = FACTURA next number.
- **Test data:** notes "Wrong size"
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Detail → Return → notes → confirm | "This will…" box lists the stock restore, the negative credit-note factura and the GL reversal. Message "Order SO-… returned. Stock restored, credit note created." |
| 2 | Order status | **RETURNED**, returned_at set; the Return button disappears. |
| 3 | `/inventory/stock` / transactions | P1 WH-A qty **10** (+2 on the first stock row by id in WH-A). RETURN transaction 2. |
| 4 | `/finance/facturas` | New factura #N, source RETURN, subtotal **−983.10**, IVA **−146.90**, IT **−33.90**, total **−1,130.00**, notes "Nota de crédito — Wrong size". |
| 5 | `/finance/journal` | JE1 "Return — Reverse Invoice": Dr Revenue 983.10, Dr VAT output 146.90, Dr IT payable 33.90 / Cr AR 1,130.00, Cr IT expense 33.90. JE2 "Return — Reverse COGS": Dr Inventory 500 / Cr COGS 500 (current cost × qty). JE3 "Return — Refund": Dr AR 1,130 / Cr **BANK** 1,130 (BANK posting type, whichever account the payment actually used). |
| 6 | Customer | lifetime_value −1,130, total_orders −1. |
| 7 | API return again | 409 "This order has already been returned". |
| 8 | API return a CONFIRMED order | 400 "Cannot return an order in CONFIRMED status. Must be SHIPPED or COMPLETED." |
| 9 | API return with an unknown key `{factura_no:"1"}` | 400 VALIDATION_ERROR (strict schema). |
| 10 | As `employee` open return | 403 "Permission denied: sales.return.post". |
- **Post-conditions / data checks:** FACTURA next = **N+1**. Tax on the credit note is recomputed from today's tax codes, not copied from the original factura.

### O2C-029 ⚠️ — Return of a shipped but not invoiced order still issues a credit note (defect probe)
- **Priority:** P2  | **Role:** store_manager  | **Type:** boundary / defect probe
- **Preconditions:** SO-NI SHIPPED, not invoiced, total 1,130. N = FACTURA next.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Return SO-NI | 200 RETURNED; stock restored; COGS reversal JE posted. |
| 2 | `/finance/facturas` | A **negative credit-note factura #N exists for a sale that was never invoiced**. No invoice-reversal JE (correctly skipped). |
- **Post-conditions / data checks:** FACTURA next = N+1; a legal number is spent on a credit note with no invoice behind it **(defect)**.

### O2C-030 ⚠️ — FACTURA sequence continuity: no gaps, no duplicates, failures do not burn numbers
- **Priority:** P1  | **Role:** admin  | **Type:** boundary
- **Preconditions:** O2C-000 shows FACTURA `continuous=true`, automatic. Two invoiceable orders SO-F1 and SO-F2. Admin can close and reopen the current accounting period (approval: this changes period state on TEST).
- **Test data:** N = next number
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/finance/periods` → close the current month | Period CLOSED. |
| 2 | SO-F1 → Issue Factura | Error: "Sales invoice … cannot be posted: period YYYY-MM is closed. Reopen the period, or change the voucher date." (400, raised inside the transaction). No factura row. |
| 3 | Reopen the period; `/setup/numbering` | FACTURA next is **still N** (rolled back). |
| 4 | SO-F1 → Issue Factura | Factura **#N**. |
| 5 | SO-F2 → Issue Factura | Factura **#N+1**. |
| 6 | `/finance/facturas` sorted by number | Sequential numbers with no gap and no duplicate (the `@@unique(tenant_id, factura_number)` constraint). Also include POS (O2C-044) and return numbers in the check. |
| 7 | (optional) Two browser tabs: Issue Factura on two different orders at the same second | Two distinct consecutive numbers (row lock). |
- **Post-conditions / data checks:** if `continuous=false` (the default from `provisionConfiguration.ts:364` on a newly provisioned tenant), step 3 shows **N+1**, i.e. a burned number **(defect)**.

### O2C-031 — Facturas list and PDFs
- **Priority:** P2  | **Role:** store_manager; auditor  | **Type:** happy
- **Preconditions:** at least one SALE, one POS_SALE and one RETURN factura exist.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/finance/facturas` | Columns include NIT/CI, Subtotal, "IVA 13%", "IT 3%", Total, Status. The SALE row links to its order. Headers are hard-coded "IVA 13% / IT 3%". |
| 2 | FacturaPDF view/download on the SALE factura | "N° 000NNN", NIT/CI, lines with line totals, "Subtotal (sin IVA)", IVA, IT and Total match the stored factura. Footer text says "El IT del 3% se aplica sobre el monto neto", which **contradicts** the GROSS engine (defect). |
| 3 | FacturaPDF on the RETURN factura | Negative amounts, titled as a regular factura (no "Nota de crédito" title) **(gap)**. |
| 4 | Order detail → SalesOrderPDF | Totals from the tax preview (one row per tax code), status in Spanish. |
| 5 | As `auditor`: `/finance/facturas` | The list loads (the GET has no guard). Cancel → 403 "Insufficient permissions". |
| 6 | As admin: Cancel a MANUAL test factura | Status CANCELLED **with no confirm dialog**. No GL reversal and no order unlink (see defects). |
- **Post-conditions / data checks:** factura numbers render as stored strings.

### O2C-032 — Customer orders, segments and lifetime value (API)
- **Priority:** P3  | **Role:** store_manager; employee; auditor  | **Type:** happy / permission
- **Preconditions:** customer CE with shipped and returned orders.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | API `GET /customers/{CE}/orders` (store_manager) | All of CE's orders with lines and product names, newest first. |
| 2 | Same as employee | 200 (has customer.read + sales.order.read). |
| 3 | API `GET /customers/segments` as store_manager | Groups by `segment` with `_count.id` and `_sum.lifetime_value` (storefront registrations use `regular`). |
| 4 | Same as employee | 403 "Permission denied: report.sales.read". As auditor: 200. |
| 5 | API `GET /customers/<random uuid>` | **200 with `data:null`** (not 404) (gap). |
- **Post-conditions / data checks:** lifetime value moves at **ship** (+) and **return** (−), never at invoice. POS sales never update it. **Gap:** no UI for segments or order history.

---

## E. Storefront

### O2C-033 — Storefront registration (happy path)
- **Priority:** P1  | **Role:** anonymous → customer  | **Type:** happy
- **Preconditions:** frontend built with `NEXT_PUBLIC_STOREFRONT_TENANT_SLUG=<TEST slug>`.
- **Test data:** first "Shop", last "Tester", email `shopper+1@test.bo`, password `Passw0rd!`
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/store/register` → fill in → Create Account | 201. Redirect to `/shop`. |
| 2 | `/account` | Profile loads through `/auth/account` (user + customer). |
| 3 | `/sales/customers` as admin | New customer, segment `regular`, code from the customer sequence, `user_id` linked. |
| 4 | Register the same email again | 409 "Email already registered". |
| 5 | Password "short" | Browser/API 400 "Password must be at least 8 characters". |
- **Post-conditions / data checks:** user role = **customer**. Note: the page writes `access_token` to localStorage (`register/page.tsx:39`); the API client ignores it and the session survives through the refresh cookie **(security gap)**.

### O2C-034 — Registration without a slug, unknown slug, smuggled role
- **Priority:** P1  | **Role:** anonymous  | **Type:** negative / permission
- **Preconditions:** (a) a frontend build **without** the env var; (b) API access.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | (a) `/store/register` → submit a valid form | Client-side error "Online registration is not configured for this store yet. Please contact the store." **No request sent.** |
| 2 | API `POST /auth/register` without `tenant_id` and `tenant_slug` | 400 VALIDATION_ERROR, detail "Name exactly one of tenant_id or tenant_slug". |
| 3 | API with both `tenant_id` and `tenant_slug` | Same 400. |
| 4 | API with `tenant_slug:"no-such-store"` | 404 TENANT_NOT_FOUND "Store not found". |
| 5 | API valid body plus `"role":"admin"` | **400 VALIDATION_ERROR** (`.strict()` unrecognized key "role"). No user created. |
| 6 | API plus `"segment":"vip"` or `"tenant_id"` with a slug | 400 (strict or refine). |
- **Post-conditions / data checks:** no user row for any refused attempt.

### O2C-035 — Shopper sees neither cost nor unpublished products
- **Priority:** P1  | **Role:** customer  | **Type:** permission
- **Preconditions:** logged in as the shopper; P1 published, P2 unpublished (cost 300).
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/shop` | P1 listed; **P2 not listed**. Network response for `/products?…published=true` has **no `cost_price`** field on any product; `additional_cost` on variants is present. |
| 2 | API `GET /products?published=false` as shopper | Still published only (the flag cannot widen the result). |
| 3 | `/shop/[P2 id]` or API `GET /products/{P2}` | 404 "Product not found". |
| 4 | API `GET /products/barcode/<P1 barcode>` | 403 "This area is not available to storefront accounts" (not on the storefront surface). |
| 5 | Log out, open `/shop` anonymously | Product calls fail with 400 "X-Tenant-ID header is required", so the shop is empty. **Anonymous browsing is not possible (gap).** |
- **Post-conditions / data checks:** as `store_manager` the same `/products` call includes `cost_price`.

### O2C-036 — Shopper blocked from ERP APIs (403)
- **Priority:** P1  | **Role:** customer  | **Type:** permission
- **Preconditions:** shopper token.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | API `GET /sales/orders` | **403 "This area is not available to storefront accounts"** (workforce gate, before the route guard). |
| 2 | API `GET /customers`, `/crm/leads`, `/finance/facturas`, `/pos/sessions`, `GET /sales/orders/{own order id}` | 403 with the same message for each. |
| 3 | API `GET /tenant/currency`, `GET /products/categories` | 200 (storefront surface). |
| 4 | Browser: go to `/sales/orders` | The ERP shell (sidebar/topbar) **renders** because `(erp)/layout.tsx` only checks "logged in". Data calls show 403 errors or empty tables **(UI gap)**. |
| 5 | Browser: `/pos/login` with shopper credentials | Login succeeds, then `/pos/sessions/current` returns 403. Error shows "Request failed with status code 403". |
- **Post-conditions / data checks:** no data returned.

### O2C-037 — Checkout places an order
- **Priority:** P1  | **Role:** customer  | **Type:** happy
- **Preconditions:** Sales parameters default warehouse = WH-A. P1 WH-A qty 10, reserved 0.
- **Test data:** cart P1 × 2 (565 each); shipping name/email/phone/address/city
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/shop/[P1]` → add 2 → `/cart` → Checkout | Summary: Subtotal (IVA incl.) 1,130.00, "IVA 13% (incluido)" **130.00** (hard-coded `total/1.13`, `checkout/page.tsx:73`, which disagrees with regime A 146.90), Total 1,130.00. |
| 2 | Place Order | "Order Placed!" with order number `SO-YYYY-NNNNN`. |
| 3 | Admin `/sales/orders/[id]` | Status **CONFIRMED**, source **storefront**, customer = the shopper's customer, warehouse WH-A, total 1,130, currency = ledger. shipping_address stored. |
| 4 | `/inventory/stock` | P1 WH-A qty **8, reserved 0** (deducted immediately, not reserved). Transactions: OUTBOUND "Storefront · SO …". |
| 5 | `/finance/journal`, `/finance/facturas` | **No** voucher and **no** factura. |
- **Post-conditions / data checks:** FACTURA unchanged. **(Defect probe, do not ship on TEST without approval):** shipping this order runs `fulfillOrder` and deducts stock **again**.

### O2C-038 — Checkout refusals: out of stock, empty cart, no warehouse, not signed in
- **Priority:** P2  | **Role:** customer  | **Type:** negative
- **Preconditions:** P3 published with 0 in WH-A, 3 in WH-B.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/shop/[P3]` | Shows stock (total_stock 3, counted across **all** warehouses) and allows adding to cart. |
| 2 | Checkout P3 × 1 | Error "\"TEST-SHOE-B-ONLY\" is out of stock. Available: 0, requested: 1" (400). No order. |
| 3 | API `POST /sales/orders/storefront` `{lines:[]}` | 400 "Cart is empty". |
| 4 | (config) tenant with no default warehouse and more than 1 warehouse, API checkout without `warehouse_id` | 422 STOREFRONT_WAREHOUSE_REQUIRED or a dimension error. |
| 5 | Logged out → `/checkout` with items | "Sign in to checkout" panel with Sign In / Create Account links. |
- **Post-conditions / data checks:** no SO number consumed on stock refusal (the check runs before `createOrder`).

### O2C-039 — Storefront price and field tampering (security probe)
- **Priority:** P1  | **Role:** customer  | **Type:** negative / permission
- **Preconditions:** shopper token; P1 selling 565.
- **Test data:** API body `{lines:[{product_id:P1, quantity:1, unit_price:1}], discount_amount:0, warehouse_id:<WH-B uuid>, currency:"USD"}`
| # | Step (screen → action) | Expected result (per code) |
|---|---|---|
| 1 | Send the body to `POST /sales/orders/storefront` | Expected-secure: price from the catalogue. **Actual:** no Zod validation; `unit_price` is taken from the client, so the order is created at **Bs 1.00** (`sales.routes.ts:67-118`) **(defect)**. |
| 2 | Inspect the order | `currency` = ledger (the USD override is dropped, correct). Warehouse = the client-chosen WH-B if active (the client can pick the shipping warehouse). |
| 3 | Body with `discount_amount: 500` | Total reduced by 500 (the spread passes it into `createOrder`) **(defect)**. |
| 4 | Body with `quantity: -1` or `1.5` | Not validated; behaviour undefined. Record the result. |
- **Post-conditions / data checks:** cancel the test orders as admin (stock is **not** restored by cancel; see defects).

---

## F. Web POS

### O2C-040 — POS login, open register, one open session per terminal
- **Priority:** P1  | **Role:** cashier  | **Type:** happy / negative
- **Preconditions:** tenant has WH-A and WH-B active; no open session for "POS-TEST-1".
- **Test data:** terminal "POS-TEST-1", opening float 200
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/pos/login` → cashier credentials | No open session, so the app goes to `/pos/open-register`. |
| 2 | Open Register without choosing a warehouse | "Choose the store warehouse this register sells from" (client). |
| 3 | Pick WH-A, float 200 → Open Register | 201 session OPEN, opening_float 200, warehouse WH-A, site = WH-A's site. The app goes to `/pos/main`. |
| 4 | API open again with the same terminal name | 409 "Terminal \"POS-TEST-1\" already has an open session (<id>)." |
| 5 | Wrong password at login | Message shown from `e.response.data.message` (undefined), so the generic axios message appears (UI defect). |
- **Post-conditions / data checks:** a single-warehouse tenant is chosen automatically. Terminal name is persisted client-side.

### O2C-041 ⚠️ — Cash sale with change
- **Priority:** P1  | **Role:** cashier  | **Type:** happy
- **Preconditions:** session OPEN on WH-A (float 200). P1 WH-A qty ≥ 2. N = FACTURA next. Ledger currency configured.
- **Test data:** P1 × 2 = Bs 1,130.00; cash tendered 1,200
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/pos/main` → search P1 → pick variant → qty 2 | Cart total **1,130.00**. Tax split from the preview (A: Subtotal 983.10, IVA 146.90, IT 33.90). "+" is disabled at the variant's available_stock. |
| 2 | COBRAR → CASH → numpad 1200 | "Change Due" **70.00**. CONFIRM SALE is enabled once the sequence is `ready`. |
| 3 | CONFIRM SALE | 201. Receipt `/pos/receipt`: "N° <N>", order number, Payment CASH, Subtotal (sin IVA) 983.10, "IVA 13%" 146.90, "IT 3%" 33.90, Total 1,130.00, Change **70.00**. |
| 4 | Admin `/sales/orders/[id]` | Status **COMPLETED**, source `pos`, paid_at set, invoice linked, warehouse WH-A, **no customer_id** even if a customer was selected. |
| 5 | Stock | P1 WH-A qty −2 (from the largest rows in WH-A); OUTBOUND transactions stamped with the order. |
| 6 | Journal | "POS Sale: SO — Factura #N": Dr AR 1,130; Cr Revenue 983.10; Cr VAT output 146.90; Dr IT expense 33.90; Cr IT payable 33.90. "COGS: SO": Dr COGS 500 / Cr Inventory 500. |
| 7 | Session | total_sales +1,130, transaction_count +1. |
- **Post-conditions / data checks:** FACTURA next = **N+1**. Factura source_type POS_SALE, customer "Cliente Mostrador" or the selected name. **Known defect (WORK-033):** AR is debited and never cleared.

### O2C-042 ⚠️ — Card sale
- **Priority:** P1  | **Role:** cashier  | **Type:** happy
- **Preconditions:** session from O2C-041. P1 WH-A qty ≥ 1. N = FACTURA next.
- **Test data:** P1 × 1 = Bs 565.00
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Add P1 × 1 → COBRAR → CARD | Text "Confirm card/POS terminal payment of 565.00"; no numpad; CONFIRM enabled. |
| 2 | CONFIRM SALE | Receipt Payment CARD, total 565.00, IVA 73.45, IT 16.95, subtotal 491.55 (A), no change row. |
| 3 | Journal | Same structure as O2C-041, with **Dr AR** (payment method is not used by the ledger). |
- **Post-conditions / data checks:** FACTURA N+1. Session total_sales now 1,695.00, count 2.

### O2C-043 — Change calculation boundaries (no sale posted)
- **Priority:** P2  | **Role:** cashier  | **Type:** boundary / negative
- **Preconditions:** cart total 1,130.00.
- **Test data:** tendered 1,129.99 / 1,130 / 0
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | CASH, tender 1129.99 | Change shows 0.00. CONFIRM **disabled** (`cashValid=false`). |
| 2 | Tender exactly 1130 | Change 0.00; CONFIRM enabled. (**Do not confirm** unless approved ⚠️.) |
| 3 | Switch CASH → CARD → CASH | Tendered resets to 0. |
| 4 | Cancel | Modal closes, cart intact. |
| 5 | (API probe, ⚠️ if run) `POST /pos/sale` with `cash_tendered:100` and total 1,130 | **201**; server returns `change_due: -1030` (no server-side check) **(defect)**. |
- **Post-conditions / data checks:** steps 1–4 consume no number.

### O2C-044 — Insufficient stock in the register's warehouse: no FACTURA burned
- **Priority:** P1  | **Role:** cashier  | **Type:** negative / boundary
- **Preconditions:** session on WH-A. P3: 0 in WH-A, 3 in WH-B. FACTURA continuous (O2C-000). N = next.
- **Test data:** P3 × 1
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Search P3 | Tile shows "Stock: 3" (total_stock across all warehouses); "+" allowed up to the variant's available stock (also cross-warehouse). |
| 2 | COBRAR → CARD → CONFIRM SALE | Refused: server 400 "Insufficient stock for product <id> in this register's warehouse. Available: 0, Requested: 1". The modal shows axios "Request failed with status code 400" (`PaymentModal.tsx:58` reads `e.message`) (UI defect). |
| 3 | `/setup/numbering` | FACTURA next **still N** (allocated in the transaction, rolled back). No SO, no factura. The SO number was drawn before the transaction, so an SO gap is expected. |
- **Post-conditions / data checks:** with `continuous=false`, next = N+1 **(defect)**.

### O2C-045 — Currency banner blocks payment when the tenant currency is missing
- **Priority:** P1  | **Role:** cashier  | **Type:** negative
- **Preconditions:** a **separate TEST tenant** with no ledger currency (FinanceParameters accounting currency not set), with a cashier user and a warehouse. Kubi approval needed to provision.
- **Test data:** any product
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/pos/main` | Amber banner: "The ledger currency is not set up yet — ask Finance to configure it under Setup → Currencies. No amounts can be shown until then." |
| 2 | Add an item | **COBRAR is disabled** (`!!currencyProblem`). |
| 3 | Force the modal open (not possible from the UI) or check PaymentModal | CONFIRM SALE is also blocked by the same banner. |
| 4 | API `POST /pos/sale` on that tenant | 422 **LEDGER_CURRENCY_NOT_CONFIGURED**, raised before the transaction, so no FACTURA is drawn. |
| 5 | API `POST /pos/sessions/open` | Allowed (no currency check on open). |
- **Post-conditions / data checks:** no sale, no number.

### O2C-046 ⚠️ — Void a POS sale as store_manager
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy
- **Preconditions:** a sale made today on POS-TEST-1 (for example O2C-042, Bs 565). Its receipt page is open, or you have the order id.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Receipt → **Void Sale** → confirm | Alert "Sale <SO> has been voided."; the app goes to `/pos/main`. |
| 2 | Order | Status **VOIDED**, returned_at set. |
| 3 | Stock | P1 restored to the original locations (+1). |
| 4 | Journal | "VOID: SO": Dr Revenue 491.55, Dr VAT output 73.45 / Cr AR 565.00; "VOID COGS": Dr Inventory 250 / Cr COGS 250. **No IT reversal** (IT payable 16.95 stays; known). |
| 5 | `/finance/facturas` | The POS factura **stays ISSUED** (no cancel, no credit note) **(defect)**. |
| 6 | Session | total_sales −565, count −1 on the **most recently opened OPEN session of the tenant**, which is not necessarily this terminal. |
| 7 | Void again | 404 "POS sale not found or cannot be voided (must be COMPLETED and from POS)". |
| 8 | API void a manual SO | Same 404. |
- **Post-conditions / data checks:** FACTURA unchanged. The void was on the same calendar day in server local time. A sale from a previous day returns 400 "POS sales can only be voided on the same day they were created".

### O2C-047 — Void refused for a cashier (pos.sale.void)
- **Priority:** P1  | **Role:** cashier  | **Type:** permission
- **Preconditions:** a COMPLETED POS sale from today (reuse O2C-041; no new sale needed).
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Cashier on the receipt page | The **Void Sale button is visible** (no role check in the UI). |
| 2 | Void Sale → confirm | Server **403 "Permission denied: pos.sale.void"**. The alert shows "Request failed with status code 403" (`receipt/page.tsx:34` reads the wrong path). |
| 3 | Order, stock, session | Unchanged (COMPLETED). |
- **Post-conditions / data checks:** no journal.

### O2C-048 — Close session: Z-report totals tie to sales
- **Priority:** P1  | **Role:** cashier  | **Type:** happy / defect probe
- **Preconditions:** POS-TEST-1 OPEN, float 200, with sales: cash 1,130 (O2C-041) and card 565 (O2C-042), no void. Physical cash in drawer = 200 + 1,130 = **1,330**.
- **Test data:** closing float 1,330
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Close Register (top bar) | `/pos/z-report` pre-close shows "Sales today" from the **client session snapshot** (it may show 0 / stale values). |
| 2 | Enter 1330 → Close Register & Print Z-Report | 200. Session **CLOSED**, closed_by/at, closing_float 1,330. |
| 3 | Z-report | Transactions **2**, Opening Float 200.00, Total Sales **1,695.00**, Cash Expected **1,895.00** (= float + all sales incl. card), Closing Float 1,330.00, **"Short 565.00"**. The drawer is actually correct: card sales are counted as cash **(defect, `pos.routes.ts:120`)**. |
| 4 | Tie-out | Σ POS_SALE factura totals for the session = 1,695.00 = total_sales. Σ journal POS_SALE AR debits = 1,695.00. |
| 5 | Try a sale after closing (stale client) | 400 "Register session not found or already closed". |
| 6 | API close again | 404 "Open session not found". |
- **Post-conditions / data checks:** no GL posted for the cash difference.

---

## G. Role checks

### O2C-049 — Cashier: POS only
- **Priority:** P1  | **Role:** cashier  | **Type:** permission
- **Preconditions:** cashier login.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | API `GET /products`, `GET /customers`, `POST /customers` | 200 / 200 / 201 (product.read, customer.read/create). |
| 2 | `/sales/orders` (UI) or API `GET /sales/orders` | 403 "Permission denied: sales.order.read". |
| 3 | `/sales/quotations`, `/crm/leads` | 403 sales.quotation.read / crm.lead.read. |
| 4 | API `POST /sales/orders/{id}/confirm` | 403 sales.order.confirm. |
| 5 | API `GET /customers/segments` | 403 report.sales.read. |
| 6 | POS open, sale, close | Allowed (pos.session.operate, pos.sale.post). Void → 403 (O2C-047). |
| 7 | API `GET /finance/facturas`, `/finance/ar-aging` | **200** (finance GETs are unguarded) (gap). |
- **Post-conditions / data checks:** —

### O2C-050 — Employee: read-only
- **Priority:** P1  | **Role:** employee  | **Type:** permission
- **Preconditions:** employee login.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `/sales/orders`, `/sales/orders/[id]`, `/sales/quotations/[id]`, `/crm/leads`, `/crm/opportunities`, `/sales/customers` | Load (200). |
| 2 | Orders list → New order → save | 403 "Permission denied: sales.order.create". |
| 3 | Lead → Qualify | 403 "Permission denied: crm.lead.maintain" (first missing of the three). |
| 4 | Quotation → Send / Confirm | 403 sales.quotation.send / sales.quotation.confirm. |
| 5 | Opportunity → Won | 403 crm.opportunity.close. |
| 6 | POS open register | 403 pos.session.operate. |
| 7 | API `GET /customers/segments` | 403 report.sales.read. |
- **Post-conditions / data checks:** no data changed.

### O2C-051 — Store manager: full O2C except order cancel
- **Priority:** P2  | **Role:** store_manager  | **Type:** permission
- **Preconditions:** store_manager login.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Create/confirm/ship/complete order, create/send/revise/confirm quotation, CRM maintain/close, POS incl. void, customer create/update, segments | All allowed. |
| 2 | Cancel order | 403 "Permission denied: sales.order.cancel" (the buttons are still visible). |
| 3 | API `POST /crm/stages` | 403 "Permission denied: crm.setup.maintain". |
| 4 | `/finance/facturas` → Cancel a factura | 403 "Insufficient permissions" (admin only). Create a manual factura is allowed ⚠️ (do not run). |
- **Post-conditions / data checks:** —

### O2C-052 — Auditor: read-only across O2C
- **Priority:** P1  | **Role:** auditor  | **Type:** permission
- **Preconditions:** auditor login.
- **Test data:** —
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | GET orders, order detail, quotations, leads, opportunities, pipeline, customers, `/customers/:id/orders`, `/customers/segments`, `/products` | 200 (all O2C `.read` codes including report.sales.read). |
| 2 | Any POST/PUT on sales, quotations, CRM, customers | 403 naming the specific write permission. |
| 3 | API `GET /pos/sessions` | 403 "Permission denied: pos.session.operate" (no `.read` code exists for POS, so the auditor cannot review sessions) (gap). |
| 4 | API `POST /sales/orders/storefront` | 403 "Permission denied: storefront.order.place". |
| 5 | `/products` response | Includes `cost_price` (auditor holds product.read). |
- **Post-conditions / data checks:** no writes.

---

## Suspected defects / gaps

The ones to look at first are **1, 2, 7, 10 and 17** (a shopper can set their own price, storefront orders lose stock twice, AR no longer ties to the GL, and legal FACTURA numbers can be burned or wasted).

| # | Severity | Location | Finding |
|---|---|---|---|
| 1 | **High (security/money)** | `backend/src/modules/sales/sales.routes.ts:67-118` | The storefront order route has no Zod validation and spreads the request body into `createOrder`. A shopper sets `unit_price`, `discount_amount` and `warehouse_id`. |
| 2 | **High (stock)** | `sales.routes.ts:122-175` + `sales.service.ts:175-216` | A storefront order deducts stock immediately and is set CONFIRMED with no reservation. Shipping it calls `fulfillOrder`, which deducts again. Cancelling it (`sales.service.ts:340`) releases unrelated reservations and does not restore the deducted stock. |
| 3 | High (stock) | `backend/src/modules/inventory/inventory.service.ts:175-183, 240-248` | `fulfillOrder` reads FIFO cost layers and the stock fallback **without a warehouse filter**. Shipping can deduct from another warehouse and leave the order's reservation behind. |
| 4 | High (stock) | `inventory.service.ts:123-149` | `releaseReservation` is not scoped to the order or warehouse, so it releases whichever `reserved_qty>0` rows it finds. |
| 5 | Medium | `sales.service.ts:175-330`, `128-169` | Ship and confirm are not transactional. If COGS posting fails after stock is deducted, the order stays CONFIRMED and a re-ship deducts twice. |
| 6 | Medium | `shared/schemas/index.ts:47-54`; `sales.service.ts:71-75` | `CreateSalesOrderSchema` strips `discount_amount` (the UI sends it). Tax is computed on the pre-discount subtotal. |
| 7 | Medium | `sales.routes.ts:477-532` | `PUT /sales/orders/:id`: no validation, `total_amount = subtotal` (discount lost), tax without party, and lines on a CONFIRMED order are replaced without re-checking or re-reserving stock. |
| 8 | Medium (ledger) | `sales.service.ts:332-348` | Cancelling an **invoiced** CONFIRMED order is allowed. The factura stays ISSUED and AR is not reversed. PACKED cancel does not release the reservation. |
| 9 | Medium | `sales.routes.ts:208, 423` | Invoice-twice and pay-twice checks run outside the transaction, so concurrent requests can create two facturas or two payments. |
| 10 | Medium (ledger) | `sales.routes.ts:416-474` | Pay has no status check. A RETURNED or CANCELLED invoiced order can still be paid after its AR was reversed. Only full payment is possible. |
| 11 | Medium (legal) | `sales.routes.ts:720-735` | A return issues a negative credit-note factura (uses a FACTURA number) even when the order was never invoiced. |
| 12 | Medium | `sales.routes.ts:693-699` | Return restores stock only if a stock row already exists (`stock` null means a transaction is logged but no quantity is restored). The refund credits the BANK posting type regardless of the account used at payment (e.g. 1101 Caja). Tax is recomputed at today's rates. |
| 13 | Medium | `backend/src/modules/finance/finance.routes.ts:622-642` | AR aging includes RETURNED orders, and ages from `created_at` rather than invoice date. |
| 14 | Medium | `finance.routes.ts:449-455` | Factura cancel posts no GL reversal and does not unlink the order. The UI (`facturas/page.tsx`) has no confirm dialog, and the alert reads the wrong error path (`:58`). |
| 15 | High (ledger, known WORK-033) | `backend/src/modules/pos/pos.routes.ts:364` | A POS sale debits AR and sets `paid_at`, but nothing ever clears AR or debits cash. |
| 16 | Medium | `pos.routes.ts:120` | Z-report `cash_expected` = float + **all** sales including CARD/TRANSFER, so over/short is wrong. |
| 17 | Medium | `pos.routes.ts:425-555` | Void leaves the POS factura ISSUED. IT is not reversed (`:496-502`). JE errors are swallowed inside the transaction (`:533-535`). It decrements the most recent OPEN session of **any** terminal (`:538-551`). |
| 18 | Low | `pos.routes.ts:248` | No server check that `cash_tendered ≥ total`; `change_due` can be negative. |
| 19 | Low | `pos.routes.ts:243, 265-293` vs `frontend/src/stores/posCartStore.ts:105` | The sale computes tax without the customer while the preview uses the selected customer, so they can differ. The POS order never stores `customer_id`, so no lifetime value or order history. |
| 20 | **High (legal)** | `backend/src/infrastructure/database/provisionConfiguration.ts:364` | New tenants get FACTURA `continuous: false`, while migration 023 set TEST to true. On a new tenant a failed invoice or POS sale burns a legal number. |
| 21 | Medium | `backend/src/modules/sales/quotation.service.ts:345-356` | Confirm does not check `valid_until`. Expiry only runs on the list GET (`quotation.routes.ts:47`). |
| 22 | Low | `quotation.service.ts:272-300, 493-498` | Revise is allowed from LOST/CANCELLED/EXPIRED and copies the old `valid_until`. `closeQuotation` overwrites REVISED/EXPIRED/LOST statuses. |
| 23 | Low | `quotation.service.ts:380-395` | With auto-convert off, confirm still reads `q.customer_id`, so a lead converted afterwards can never be confirmed. Lead conversion runs outside the order transaction (`:389`). |
| 24 | Low | `backend/src/modules/crm/crm.routes.ts:172-188, 271-289` | Lead and opportunity PUT pass the raw body through (e.g. `probability`, `customer_id`, `lead_id`, `created_by`), and a WON or LOST opportunity can still be edited. |
| 25 | Low | `backend/src/modules/customers/customer.routes.ts:80-83` | `GET /customers/:id` returns 200 `null` instead of 404. |
| 26 | Medium (UX) | `frontend/src/app/(erp)/sales/orders/[id]/page.tsx:70-83` | Confirm, ship, complete and cancel mutations on the detail page have no `onError`, so failures are silent. |
| 27 | Low (UX) | `frontend/src/components/pos/PaymentModal.tsx:58`; `frontend/src/app/pos/receipt/page.tsx:34`; `app/pos/z-report/page.tsx:34`; `app/pos/login/page.tsx:38`; `app/(store)/store/login/page.tsx:23` | These read `e.message` or `response.data.message` instead of `response.data.error.message`, so users see "Request failed with status code …". |
| 28 | Medium (tax display) | `frontend/src/app/(store)/checkout/page.tsx:11,73`; `app/pos/receipt/page.tsx:72-73`; `app/(erp)/sales/quotations/[id]/page.tsx:159`; `app/(erp)/finance/facturas/page.tsx:77,238-239`; `frontend/src/components/erp/finance/FacturaPDF.tsx:351-352` | Hard-coded "IVA 13% / IT 3%" labels. Checkout extracts IVA as `total/1.13`. The PDF says IT is on the net. All of these contradict the GROSS engine. |
| 29 | Medium (security) | `frontend/src/app/(store)/store/register/page.tsx:39` | Writes `access_token` to localStorage (and `refresh_token` as "undefined"), against the in-memory token policy in `lib/api.ts:3`. |
| 30 | Medium (UX/containment) | `frontend/src/app/(erp)/layout.tsx`; `frontend/src/lib/api.ts:52` | The ERP shell renders for any authenticated role, including `customer`. A failed refresh sends shoppers to the ERP `/login`. |
| 31 | Medium (product) | `backend/src/shared/middleware/tenantMiddleware.ts:12-13` | The storefront cannot be browsed anonymously: every `/api/v1` call needs `X-Tenant-ID` plus auth. |
| 32 | Low | `backend/src/modules/inventory/product.routes.ts` (`total_stock` and variant `available_stock` span all warehouses); storefront `GET /:id` does not filter `is_active` | The shop and POS tiles show stock that checkout or the register warehouse will refuse. |
| 33 | Gap (UI) | none | No UI for: create/edit quotation lines, create opportunity, convert-to-customer, customer segments/orders, POS void other than from the just-shown receipt, partial shipment, partial payment. |
| 34 | Gap | `backend/src/modules/finance/finance.routes.ts:293-307, 622` | Facturas and AR aging GETs have no permission guard, so cashier and employee can read them. |
| 35 | Low | `sales.service.ts:299` | Shipment number is `SHP-${Date.now()}`, not from a tenant number sequence. |
| 36 | Gap (permission) | `backend/src/shared/middleware/permissions.ts:52` | No `pos.*.read` code exists, so the auditor cannot review register sessions. |

## Uncertain — needs confirmation

1. **Which tax regime TEST actually runs.** `HANDOVER.md:458` quotes pre-GROSS figures, while `BOLIVIA_TAX_BASIS.md` says `scripts/reportTaxBasisImpact.ts` sets Bolivia's codes to GROSS. O2C-000 settles it; the IVA/IT figures in every case depend on it. Your example (net 1,000 / IVA 130 / IT 33.90) only matches regime B.
2. **FACTURA flags on TEST.** Confirm `continuous=true` and `manual=false` are really set (migration 023). Otherwise O2C-030 and O2C-044 will show burned numbers.
3. **Whether TEST posting profiles resolve BANK.** The return refund and `require_balanced_posting` decide whether a missing profile throws or silently skips GL.
4. **Whether any TEST item group has `pickingRequirements` or `deductionRequirements` enabled.** This changes O2C-016, O2C-021 and O2C-022.
5. **Legal questions on credit notes.** Whether Bolivian notas de crédito must use their own series, and must reference the original factura (HANDOVER §7). This decides whether O2C-028 and O2C-029 are correct at all.
6. **How `resolveInventoryDimensions` treats a storefront `warehouse_id` from the client.** Does it accept any active warehouse? Not traced in full.
7. **Which numbers O2C-044 would use when run through the POS UI.** A variant with no WH-A stock row may fail differently (`deductPosStock` filters `variant_id` exactly, including null).
8. **How to build the currency-banner precondition (O2C-045).** It needs a second tenant with no ledger currency. Confirm whether the `createTenant.ts` CLI can make one without seeding FinanceParameters.
9. **How `writeFacturaLines` spreads header tax across lines, and whether it can throw.** It was not read in detail. If it throws, the invoice transaction rolls back (no number burned when continuous).
10. **Time zone.** "Same-day void" and "quotation expiry" use server local time. Confirm the TEST server's time zone before running boundary cases near midnight.
