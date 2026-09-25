# Defect remediation design: register, target behaviour, UI and configuration directive, work items

**Author:** Claude solution-architect agent (Opus), read-only. **Basis:** `codex/rebuild-2026-09-07` @ `20a28a7`, clean tree.
**Evidence boundary:** I re-read the code for every row marked VERIFIED or PARTIAL. Rows marked REPORTED come from the area documents and I did not re-read them. Nothing was executed: no tests, no database, no TEST harness. I read `CLAUDE.md` rather than `AGENTS.md`; the worklog says their content is the same. The coordinator's endpoint coverage findings (A) and (B) are included. I spot-checked (B): no route or service writes `PostingProfile`, `SalesParameters`, `PurchaseParameters`, `InventoryParameters`, `TaxCode`, `MatchingPolicy`, `PriceTolerance` or `WorkTemplate`. The only writes are in provisioning and seed scripts.

Labels: **[OFF]** official documentation (with URL) · **[REPO]** repo-verified · **[REC]** architectural recommendation · **[VAL]** assumption needing validation.

---

## 0. Premise corrections

1. **"Storefront stock deducted twice" is true, and the full picture is worse.**
   - The storefront deducts stock and consumes one cost layer per stock row with no transaction (`sales.routes.ts:123-170`). It then sets the order to CONFIRMED with no reservation (`:172-175`).
   - `shipOrder` accepts CONFIRMED (`sales.service.ts:178`) and calls `fulfillOrder` again. That consumes layers from any warehouse (`inventory.service.ts:175-183`).
   - `fulfillOrder` never checks that it deducted enough (`:238-276`). A second ship that finds no stock succeeds silently.
   - Cancelling the order releases other orders' reservations (`inventory.service.ts:123-149`) and never restores the deducted stock.
2. **The root cause of the FIFO failure is missing primitives, not one bug.** There is no reservation record, no issue-to-layer settlement, and no rule that stock must stay non-negative. Every path invents its own deduction: ERP ship, storefront, POS, adjust, count, void and return. Patching each path would fail again. Section 4 builds the primitives once (WORK-043/044) and moves every path onto them.
3. **"No frontend form" is half the problem.** (B) shows that the most important configuration has no **API** either: posting profiles, tax codes and groups, and the Sales, Purchase and Inventory parameter records. The Ley 1733 IVA transition would be a new `TaxCode` row, and today only a script can write one. This is a legal-readiness defect, not a UX gap.
4. **Two items should not get a UI (behaviour cuts, recorded).**
   - Data import is a stub that reports COMPLETED without importing anything (REPORTED, `import.service.ts`). It must **fail closed**, not get a nicer screen.
   - Work templates and product dimensions have no reader in the code. They stay hook-only, shown read-only, with the UI recorded as an open gap as §4.1 rule 5 requires.

---

## 1. Consolidated defect register

**Status column:** V = verified by re-reading · P = partial · D = disproved · R = reported, not re-read.
**Severity:** S1 = data corruption, legal, money or security · S2 = wrong result · S3 = UX.
**Schema column:** the new object needed, if any. File references are relative to `backend/src/` unless they start with `frontend/` or `prisma/`.

### 1.1 Inventory quantity, reservation, costing

| ID | Defect | Evidence | St | Sev | Schema |
|---|---|---|---|---|---|
| DEF-001 | Storefront deducts at order creation (non-transactional, one layer per stock row), sets CONFIRMED with no reservation; ship deducts again | `sales.routes.ts:122-175`; `sales.service.ts:178,216` | V | S1 | `InventoryReservation` |
| DEF-002 | `releaseReservation` is not scoped to the order or the warehouse | `inventory.service.ts:123-149` | V | S1 | `InventoryReservation` |
| DEF-003 | `fulfillOrder` consumes layers from any warehouse; stock falls in the layer's location while the order's own reservation stays behind | `inventory.service.ts:175-214` | V | S1 | — |
| DEF-004 | **New.** A line with null `variant_id` consumes layers and stock of **every** variant of the product | `inventory.service.ts:179,203,244` | V | S1 | — |
| DEF-005 | **New.** `fulfillOrder` never checks for a shortfall; ship succeeds when nothing or too little was deducted. The fallback path moves stock without layers | `inventory.service.ts:238-276` | V | S1 | — |
| DEF-006 | Ship is not atomic (stock, COGS voucher, shipment, status in separate writes); a COGS failure leaves the order CONFIRMED and a re-ship deducts again | `sales.service.ts:216-316` | V | S1 | — |
| DEF-007 | COGS = qty × `Product.cost_price` (ERP ship, POS, POS void, return); the OUTBOUND `unit_cost` stores the **sales price** | `sales.service.ts:239-258`; `pos.routes.ts:224-247,477-485`; `sales.routes.ts:764-771`; `inventory.service.ts:229,269` | V | S1 | `InventoryCostSettlement`, `InventoryTransaction.cost_layer_id/cost_amount` |
| DEF-008 | **New.** POS deducts no cost layer (layers are overstated) and ignores `reserved_qty` and the pick-location filter, so the till can sell reserved stock | `posStock.service.ts:67-78` | V | S1 | — |
| DEF-009 | POS void and customer return restore no cost layer; return COGS uses today's `cost_price`; return restores stock only if a row already exists | `posStock.service.ts:204-222`; `sales.routes.ts:693-717,762-786` | V | S1 | `InventoryCostLayer.source_type` |
| DEF-010 | `/inventory/adjust`: upsert with null `variant_id` in a compound-unique `where` fails for no-variant products; negative quantity allowed; negative on a new row clamped to 0 while the transaction records the full quantity; location not validated; no GL, no layer, no reason, no number | `inventory.routes.ts:83-133`; the repo's own note `warehouse.service.ts:612-615`; Prisma ^5.9 | V (static; one TEST reproduction advised) | S1 | `InventoryJournal` |
| DEF-011 | Count finalize: same null-variant upsert; overwrites stock with the counted quantity against a stale snapshot; not transactional; no GL, no layer; `count()+1` reference | `inventory-count.routes.ts:43-48,103-161` | V | S1 | `InventoryJournal` |
| DEF-012 | **New.** The `inventory_stock` unique index is NULLS DISTINCT, so duplicate no-variant stock rows are possible (findFirst-then-create races) | `prisma/sql/000_baseline.sql:793` | V | S1 | new index NULLS NOT DISTINCT + CHECKs |
| DEF-013 | No database guard on `quantity >= 0` or `reserved_qty <= quantity` | `000_baseline.sql:175-185` | V | S1 | CHECK constraints |
| DEF-014 | `POST /warehouse/work/:id/complete` marks COMPLETED without moving stock, is unguarded, and **satisfies the PICKING_REQUIRED ship gate** | `warehouse.routes.ts:379-385`; `sales.service.ts:195-211` | V | S1 | — |
| DEF-015 | Work start and line-complete routes are unguarded (030b) | `warehouse.routes.ts:359,367` | V | S1 | — |
| DEF-016 | Re-completing a SHORT line overwrites `quantity_done`; work never completes | `warehouse.service.ts:535-546` | R | S2 | — |
| DEF-017 | Pick location lookup and move exclude the order's own reservation, so pick work for a fully reserved order cannot complete | `warehouse.service.ts:75,597` | P (`moveStock` subtracts `reserved_qty` at :597) | S2 | `InventoryReservation` fixes it |
| DEF-018 | Transfer: availability read outside the transaction; from = to allowed; foreign location not refused; no number; UI reads the wrong error path | `inventory.service.ts:346-403` | V | S2 | — |
| DEF-019 | Item model group `costing_method` accepts non-FIFO values that nothing implements | `product.routes.ts:381-389` | V | S2 | — |
| DEF-020 | PACKED cancel releases no reservation | `sales.service.ts:340` | V | S2 | — |
| DEF-021 | Arrival journal: body spread into create (mass assignment incl. nested `lines`); layer at 0; no receipt or voucher; doubles stock with registration requirements; "New Journal" button inert | `warehouse.routes.ts:414-425`; `warehouse.service.ts:304-437` | P (spread verified; the rest R) | S1 | — |
| DEF-022 | Low-stock report is tenant-wide, not per warehouse | `inventory.routes.ts:41-74` | V | S2 | — |
| DEF-023 | Product `total_stock` and variant `available_stock` span all warehouses (shop and POS tiles misleading) | `product.routes.ts` | R | S3 | — |

### 1.2 POS

| ID | Defect | Evidence | St | Sev | Schema |
|---|---|---|---|---|---|
| DEF-030 | POS sale debits AR and sets `paid_at`; nothing debits cash or clears AR | `pos.routes.ts:278,364` | V | S1 | `SalesPaymentMethod`, `PosTender` |
| DEF-031 | **New.** Tender not persisted: `payment_method` and `cash_tendered` are dropped; no split tender; `change_due` can be negative | `pos.routes.ts:144-153,248,265-294` | V | S1 | `PosTender` |
| DEF-032 | Z report `cash_expected` = float + all sales incl. card/transfer; no per-tender declaration; no over/short posting | `pos.routes.ts:120-136` | V | S1 | `RegisterSessionDeclaration` |
| DEF-033 | Void leaves the factura ISSUED, does not reverse IT, recomputes tax at today's rates instead of the stored amounts, and swallows journal errors inside the transaction | `pos.routes.ts:451-535` | V | S1 (legal) | `Factura.cancel_*` |
| DEF-034 | Void decrements the tenant's latest open session of any terminal; the sales order carries no session link | `pos.routes.ts:537-551`; `schema.prisma:2431` | V | S1 | `SalesOrder.register_session_id` |
| DEF-035 | **New.** Void race: status read outside the transaction, update not status-guarded, so a double void restores stock twice. Same-day check uses server local time | `pos.routes.ts:430-457` | V | S1 | — |
| DEF-036 | POS order stores no `customer_id`; sale tax computed without the customer while the preview uses it | `pos.routes.ts:243,265-293` | V | S2 | — |
| DEF-037 | **Disproved.** "`deductPosStock` filters `variant_id` exactly incl. null" — Prisma renders `variant_id: null` as `IS NULL`, which is correct | `posStock.service.ts:71` | D | — | — |

### 1.3 Sales order, return, payment, factura, numbering

| ID | Defect | Evidence | St | Sev | Schema |
|---|---|---|---|---|---|
| DEF-040 | New tenants get FACTURA `continuous: false` (TEST was set true by migration 023) | `provisionConfiguration.ts:364`; `023_…sql:123` | V | S1 legal | — |
| DEF-041 | **New.** An admin can switch FACTURA to `continuous:false` and jump `next_number` forward (only a backwards resume is guarded) | `setup.routes.ts:472-566`; `schemas/index.ts:592` | V | S1 legal | — |
| DEF-042 | Return on an uninvoiced order issues a negative credit-note FACTURA | `sales.routes.ts:684,720-735` | V | S1 legal | — |
| DEF-043 | Cancelling an invoiced CONFIRMED order is allowed; factura stays ISSUED; AR not reversed | `sales.service.ts:332-348` | V | S1 | — |
| DEF-044 | Invoice-twice and pay-twice checks run outside the transaction; the FACTURA lock serializes the two, but the second still commits a second factura | `sales.routes.ts:208,277-323,423,449-453` | V | S1 legal | — |
| DEF-045 | Pay has no status guard (a RETURNED or CANCELLED order can be paid after AR reversal); account is a free-text code defaulting to `'1102'` | `sales.routes.ts:416-474`; `schemas/index.ts:99` | V | S1 | `SalesPaymentMethod` |
| DEF-046 | Manual factura posts no journal, accepts any `invoice_date` (backdating in a legal series), and takes `source_type`/`source_id` from the client | `finance.routes.ts:314-369` | V | S1 legal | — |
| DEF-047 | Factura cancel only flips status: no reason, no reversal, no order unlink, no 404/409 feedback, no UI confirm | `finance.routes.ts:449-455` | V | S1 | `Factura.cancel_*` |
| DEF-048 | Storefront order: no schema; client `unit_price`, `discount_amount`, `warehouse_id`; unpublished or inactive products orderable (D-15) | `sales.routes.ts:67-118` | V | S1 money | — |
| DEF-049 | `CreateSalesOrderSchema` strips `discount_amount`; tax on pre-discount subtotal | `schemas/index.ts:47-54`; `sales.service.ts:71-75` | V | S2 | — |
| DEF-050 | `PUT /sales/orders/:id`: no schema; `total_amount = subtotal`; tax without party; CONFIRMED lines replaced without re-reservation | `sales.routes.ts:477-532` | V | S1 | — |
| DEF-051 | Return refund credits the `BANK` posting type regardless of how the order was paid; whole-order only; tax recomputed at today's rates | `sales.routes.ts:586-590,789-803` | V | S2 | — |
| DEF-052 | Shipment number `SHP-${Date.now()}`; count `CNT-count()+1`; arrival `ARJ-count()+1`; employee `EMP-count()+1` | `sales.service.ts:299`; `inventory-count.routes.ts:47`; `warehouse.routes.ts:416`; `hr.routes.ts:71` | V | S2 | sequence references |
| DEF-053 | Quotation confirm ignores `valid_until`; revise allowed from LOST/CANCELLED/EXPIRED; close overwrites terminal statuses; confirm reads `q.customer_id` after lead conversion; list GET writes (expiry) | `quotation.service.ts:272-300,345-395,493-498` | R | S2 | — |
| DEF-054 | Lead and opportunity PUT pass the raw body; WON/LOST still editable | `crm.routes.ts:172-188,271-289` | R | S2 | — |
| DEF-055 | AR aging includes RETURNED orders and ages from `created_at` | `finance.routes.ts:622-642` | R (matrix agrees) | S2 | (WORK-034) |

### 1.4 Finance / Record to Report

| ID | Defect | Evidence | St | Sev | Schema |
|---|---|---|---|---|---|
| DEF-060 | Journal post: no closed-period re-check, no balance or active-account re-check, no `posted_by`, no creator ≠ poster option | `finance.routes.ts:249-256` | V | S1 | `JournalEntry.posted_by` (if absent) |
| DEF-061 | Journal form sends `description: null`; schema rejects null, so saving with blank line descriptions fails | `frontend/…/journal/page.tsx:51`; `schemas/index.ts:140` | V | S2 | — |
| DEF-062 | Account PUT: deactivate with postings allowed, and every report filters `is_active`, so the trial balance and balance sheet stop balancing; type/code editable after postings; P2002 gives 500 | `finance.routes.ts:45-56,485,652,695` | V | S1 | — |
| DEF-063 | Manual journals cannot be reversed (`reverseJournal` has no route) | `journal.service.ts:728` | R | S2 | — |
| DEF-064 | Period close/reopen accept any year/month; reopen erases `closed_by/closed_at` | `finance.routes.ts:768-794` | V | S2 | `AccountingPeriodEvent` |
| DEF-065 | Month boundaries in server-local time on UTC-stored dates (periods, IVA report, bank rec) | `journal.service.ts:247`; `finance.routes.ts:463-464` | V | S1 [VAL V-6] | `Tenant.timezone` exists |
| DEF-066 | Bank reconciliation hard-codes account `1101`; no match/unmatch | `finance.routes.ts:812` | R (matrix agrees) | S2 | — |
| DEF-067 | Every finance and report read open to any workforce role; auditor gets 403 on reports and audit | `finance.routes.ts` GETs; `report.routes.ts:18-81`; `audit.routes.ts:11` | V (finance) / R | S1 security | — (030c) |
| DEF-068 | Dashboard revenue: order totals incl. IVA by creation date; first row only; no currency; CEO dashboard counts DRAFT | `report.service.ts:215-223`; `ceoDashboard.service.ts:283-290` | R | S2 | — |
| DEF-069 | Hard-coded "IVA 13% / IT 3% sobre neto" labels; checkout extracts `total/1.13`; year dropdowns hard-coded; TopBar opens a 404 | 02 #28; 04 D19, D20, D22 | R | S2 (tax display) | — |
| DEF-070 | Schema strips `dimensions` from journal lines, so required-dimension accounts can never take a manual entry | `schemas/index.ts:136-141` vs `finance.routes.ts:238` | V | S2 | — |
| DEF-071 | Imbalanced or two-sided lines give 500; IVA net report 500 on a setup problem | `journal.service.ts:439-499`; `finance.routes.ts:539-546` | R | S3 | — |

### 1.5 Source to Pay

| ID | Defect | Evidence | St | Sev | Schema |
|---|---|---|---|---|---|
| DEF-080 | Requester can approve their own requisition | `requisition.service.ts:216-257` | V | S1 SoD | parameter enum |
| DEF-081 | RFQ from an IN_REVIEW requisition bypasses approval; lines not locked while an RFQ is open; second award on an AWARDED case raises another PO | `rfq.service.ts:131-135,524,644-673` | R | S1 | — |
| DEF-082 | No maker ≠ checker on vendor payment post or discrepancy approval | `vendorPayment.service.ts:242-315` | R | S1 SoD | parameter enum |
| DEF-083 | Receive-and-invoice not atomic: receipt commits, then an invoice failure leaves stock and voucher without an invoice | `purchase.routes.ts:669-698` | V | S1 | — |
| DEF-084 | Invoice qty > matched receipt qty: the excess lands in PRICE_VARIANCE (only zero-match lines count as unaccrued); a later receipt accrual is never cleared | `vendorInvoice.service.ts:764,834-849` | P (static; depends on matching policy) | S1 | — |
| DEF-085 | USD PO can be created and confirmed but never received, invoiced or paid | `purchase.routes.ts:339` | V | S2 | — |
| DEF-086 | Cancelled vendor invoice still blocks its number; comparison is case-sensitive | `vendorInvoice.service.ts:124-134` | R | S2 | — |
| DEF-087 | Supplier credit after full payment refused after stock and inventory were already reduced at return ship | `purchaseReturn.service.ts:~655-672` | R | S1 | — |
| DEF-088 | Receipt location not validated against the PO warehouse or tenant; UI lists every location | `productReceipt.service.ts:174,275,301` | R | S1 tenancy | — |
| DEF-089 | PO `warehouse_id` optional in schema but NOT NULL in DB (500); `PUT lines:[]` gives a zero-line confirmable PO | `schemas/index.ts:236`; `purchase.routes.ts:264,404-411` | R | S2 | — |
| DEF-090 | Requisition header never reaches CLOSED with a REJECTED line; bid accepted on an unsent or declined RFQ; shipped supplier return does not reduce PO received/invoiced qty | `documentChain.ts:201-205`; `rfq.service.ts:303-308`; `purchaseReturn.service.ts:228-420` | R | S2 | — |
| DEF-091 | `require_requisition_for_po`, `vat_input_recognition`, `receipt_invoice_flow` stored but unread | `schema.prisma` PurchaseParameters | R | S2 | — |
| DEF-092 | No NIT/authorization/control-code validation before IVA credit; legacy mode credits IVA at receipt without a factura | `vendorInvoice.service.ts:201-219`; `productReceipt.service.ts:627-717` | R | S1 [VAL] | — |

### 1.6 Security, identity, master data, platform

| ID | Defect | Evidence | St | Sev | Schema |
|---|---|---|---|---|---|
| DEF-100 | Logout is client-only; refresh token never rotated or revoked; stored hash never checked; refresh does not re-check tenant active or user↔tenant | `auth.routes.ts:145-164`; `schema.prisma:66-76` | V | S1 | `RefreshToken` columns |
| DEF-101 | Malformed or expired refresh token gives 500 (`jwt.verify` throws outside AppError) | `auth.routes.ts:151` | V | S2 | — |
| DEF-102 | Prisma P2002 (and P2003/P2025) not mapped → 500 | `errorHandler.ts:10-30` | V | S2 | — |
| DEF-103 | `PUT /hr/employees/:id` spreads the body (`tenant_id`, `user_id`, `employee_code` writable = cross-tenant move); `POST /employees` spreads unknown keys, is not transactional, no schema | `hr.routes.ts:53-95` | V | S1 | — |
| DEF-104 | Role change allows `customer`; no last-admin or self-demotion guard; deactivate/role change revoke no session; store manager can create users with finance roles | `hr.routes.ts:25-36,53-61` | V | S1 | — |
| DEF-105 | Login without tenant takes `findFirst` by email (ambiguous across tenants); rate-limit key falls back to a shared `'local'` bucket | `auth.routes.ts:38-41`; `app.ts:106,123` | V / R | S2 | — |
| DEF-106 | FK tenant checks missing on warehouse, zone, location and operating-unit create | `warehouse.routes.ts:173-248`; `setup.routes.ts:108` | R | S1 tenancy | — |
| DEF-107 | Product create/update and supplier create: no schema; variant upsert by `sku_variant` re-parents a variant; barcodes not unique; UoM routes unguarded | `product.routes.ts:110-140,209-270,549-583`; `purchase.routes.ts:92-111`; `uom.routes.ts` | R | S2 | — |
| DEF-108 | Warehouse quick-setup not idempotent or transactional; wizard partial apply; business name/country never saved | `warehouse.routes.ts:437-488`; `setup/wizard/page.tsx` | R | S2 | — |
| DEF-109 | Data import is a stub marked COMPLETED | `import.service.ts:20-199` | R | S1 (false success) | — |
| DEF-110 | ERP shell renders for `customer`; sidebar unfiltered by permission; write buttons shown to read-only roles; register page writes the token to localStorage | `(erp)/layout.tsx`; `Sidebar.tsx`; `store/register/page.tsx:39` | R | S2 / S1 (token) | — |
| DEF-111 | Error envelope read from the wrong path (`data.message`) on ~12 screens; detail-page order mutations have no `onError` | 01 D-3; 02 #26, #27; 04 D17 | R | S3 | — |
| DEF-112 | `GET /customers/:id` returns 200 null; `updateMany` returns 200 on no-op (customers, product, variant) | `customer.routes.ts:80-94` | R | S3 | — |
| DEF-113 | Tenant timezone not IANA-validated; language any BCP-47 tag | `schemas/index.ts:318-321` | R | S2 | — |
| DEF-114 | Payroll page hard-codes "Dr 5201 / Cr 2201"; negative gross accepted; duplicate-month check matches on description text | `hr/payroll/page.tsx:78`; `hr.routes.ts:145-160` | R | S2 | — |
| DEF-115 | Configuration models with no write API at all (see §3.3) | coordinator (B) | V (spot-checked) | S1 (parametric product) | — |

---

## 2. Target behaviour for the non-obvious cases

### 2.1 FIFO consumption and COGS (DEF-003…009, 019)

**Decisions:**
1. **Perpetual FIFO on the Business Central item-application model** (decided 2026-09-11). **[OFF]** <https://learn.microsoft.com/dynamics365/business-central/design-details-costing-methods>
2. **Consumption scope is the issuing warehouse and the exact variant**, where null matches only null. **[REC]** Business Central applies inbound to outbound entries for the same item, variant and location. Consuming another store's layers is what produces the divergence seen on TEST.
   - The pending `cost_level` enum is kept as a hook for moving average (`LEGAL_ENTITY | SITE | WAREHOUSE`).
   - FIFO consumption always stays at warehouse level.
   - For the anchor tenant one store = one site = one warehouse, so the Finance co-founder's "cost level" question does not block this work.
3. **One shared primitive**, `issueFromLayers(tx, {tenant, warehouse, product, variant, qty, source})`:
   - locks the candidate layers `FOR UPDATE`, ordered by `received_at, id`;
   - consumes them and writes one `InventoryCostSettlement` row per layer consumed;
   - writes the OUTBOUND transaction with `cost_layer_id` (single layer) or `cost_amount` (sum), and **never the sales price**;
   - returns `cost_amount`.
   - Callers: ERP ship, storefront ship, POS sale, negative adjustment and count, transfer-out, supplier return.
4. **COGS = Σ `cost_amount` per item group**, posted **in the same transaction** as consumption, shipment and status change. `Product.cost_price` is never read on a posting path again. It stays as a display and default price only.
5. **Uncovered quantity** (stock without layers, the legacy TEST state): new `InventoryParameters.uncosted_issue_policy` enum `REFUSE | ITEM_COST_PRICE_FLAGGED`.
   - The default is `REFUSE`, returning 409 `COST_LAYER_INSUFFICIENT` before any write.
   - `ITEM_COST_PRICE_FLAGGED` creates a settlement with `cost_source = 'ESTIMATED'`, so the gap is visible and reportable.
   - TEST is reconciled once by an opening-layer journal (§2.2, type `OPENING`). The GL effect of that journal is a Finance decision (Q2).
6. **Reversals:**
   - A **POS void or cancel of a shipped-but-unreturned issue** puts the quantity back on the **same layers** it came from, using the settlement rows.
   - A **customer return** creates a **new layer** at the original issued unit cost (exact cost reversing), with `source_type = SALES_RETURN`, `received_at` = return date and `origin_settlement_id` linked. **[OFF]** <https://learn.microsoft.com/dynamics365/business-central/sales-how-process-sales-returns-cancellations#inventory-costing>; D365 *Return cost price* = cost of the invoiced item: <https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/sales-returns#post-to-the-ledger>
   - A return of a pre-WORK-044 order that has no settlements uses the policy in point 5.
7. **Transfer** keeps moving layers (already correct) inside the transaction, with the availability check moved inside and from ≠ to enforced.
8. **Fail closed:** `costing_method` other than `FIFO` is refused on item model group create/update (422 `COSTING_METHOD_NOT_IMPLEMENTED`). Existing rows with other values are reported by a read-only Step 0 and not modified.

### 2.2 Adjustment and counting (DEF-010, 011)

**[OFF]** An inventory adjustment journal posts receipts or issues, changes values and creates ledger transactions via the item group posting profile: <https://learn.microsoft.com/dynamics365/supply-chain/inventory/inventory-journals>. Posting a counting journal changes level and value and generates ledger transactions: <https://learn.microsoft.com/dynamics365/supply-chain/inventory/tasks/count-inventory-warehouse#post-the-inventory-counting-journal>. Business Central: keep the originally calculated lines and do not recalculate, because expected inventory may change: <https://learn.microsoft.com/dynamics365/business-central/inventory-how-count-adjust-reclassify#to-count-physical-inventory>.

1. One document, `InventoryJournal` (type `ADJUSTMENT | COUNT | OPENING`), with lines, DRAFT → POSTED, numbered from `INVENTORY_ADJUSTMENT` / `INVENTORY_COUNT` (new reference), reason code on each line.
2. **Posting is one transaction:**
   - positive delta → new layer at the line unit cost (default: that warehouse's newest open layer cost, else `cost_price`, editable with `inventory.journal.cost_override`), Dr `INVENTORY` / Cr `INVENTORY_ADJUSTMENT_GAIN`;
   - negative delta → `issueFromLayers`, Dr `INVENTORY_ADJUSTMENT_LOSS` / Cr `INVENTORY`;
   - `OPENING` credits `INVENTORY_OPENING_BALANCE`.
3. **Count delta = counted − snapshot.** New `InventoryParameters.count_snapshot_policy` enum `REFUSE_IF_CHANGED | APPLY_DELTA`, default `REFUSE_IF_CHANGED`. Finalize refuses with 409 `COUNT_STOCK_CHANGED` and lists the lines when on-hand moved after the snapshot. **Never overwrite.**
4. Negative on-hand is refused in code and by a database CHECK. Location is validated against the tenant and the warehouse.
5. Tax effect: none by default. The structured shrinkage-tax setting is already decided as jurisdiction data; its Bolivian value stays a validation item.
6. Legacy `/inventory/adjust` becomes a thin wrapper that creates and posts a one-line ADJUSTMENT journal, so existing clients keep working.

### 2.3 POS tender, clearing accounts, shift declaration (DEF-030…032)

**[OFF]** The statement calculates per payment method; counted amounts come from tender declarations; difference postings are checked against store maximums: <https://learn.microsoft.com/dynamics365/commerce/retail-statements#creating-and-posting-statements>. A shift compares expected against counted and declared amounts, and the Z report shows overage or shortage: <https://learn.microsoft.com/dynamics365/commerce/shift-drawer-management>. Recommended statement and closing method is Shift: <https://learn.microsoft.com/dynamics365/commerce/shift-drawer-management#shift-and-drawer-permissions>.

1. **`SalesPaymentMethod` master** (owner: Sales → POS/Payments Setup):
   - fields: `code`, `name`, `tender_type` enum `CASH | CARD | TRANSFER | QR | CUSTOMER_ACCOUNT | VOUCHER`, `account_id` (clearing or cash account), nullable `warehouse_id` for per-store override, `declaration_policy` enum `NONE | COUNT`, `allow_change` (CASH only), `max_difference_amount`, `is_active`;
   - mirrors `purchase_payment_methods` including `legal_entity_id NULLS NOT DISTINCT`.
2. **The sale carries 1..n `PosTender` lines** (method, amount, tendered, change).
   - Refused when Σ amount ≠ total, or when a non-`allow_change` method has tendered > amount.
   - Posting: Dr each tender's account / Cr REVENUE, VAT_OUTPUT; Dr/Cr IT as today.
   - **AR only for `CUSTOMER_ACCOUNT`, which is refused (422 `TENDER_NOT_IMPLEMENTED`) until WORK-034 builds AR open transactions.** Behaviour cut; the enum value is the hook.
   - `QR` is a first-class tender type because Bolivian retail uses QR payments. **[VAL]** mapping to bank.
3. **Card and QR clearing accounts** are emptied by a manual bank journal today; automatic bank-statement matching is deferred (WORK-039 hook: `PosTender.settled_journal_entry_id` nullable).
4. **Session close requires one `RegisterSessionDeclaration` per method with `declaration_policy = COUNT`:**
   - `expected` = opening float (CASH) + Σ tenders − change − voided tenders of **this** session;
   - difference posts Dr/Cr `CASH_DIFFERENCE` / tender account, one voucher per session, number from the journal sequence;
   - a difference above `max_difference_amount` needs `pos.session.close_with_difference`.
   - The Z report is rendered from the declarations and is immutable after close.
5. **The historical TEST AR overstatement** (9,107 vs 130) is corrected by a separate, Finance-approved journal. It is never run automatically (Q3).

### 2.4 POS void of a factura (DEF-033…035)

Commerce has no neutral "void of an issued fiscal document" pattern. It defers to local fiscal integration: <https://learn.microsoft.com/dynamics365/commerce/localizations/dev-itpro/fiscal-integration-for-retail-channel>. **[REC]** decision, parametric:

- `SalesParameters.pos_void_mode` enum `ANNUL_IN_SESSION | CREDIT_NOTE_ONLY | DISABLED`. **Default `ANNUL_IN_SESSION`.**
- A void is allowed only while the **originating** session (`SalesOrder.register_session_id`) is OPEN. This replaces the server-local "same day" check. After close → return with credit note (§2.6).
- **Effect in one transaction, status-guarded** (`updateMany … status='COMPLETED'`, count must be 1):
  1. factura → `CANCELLED` with `cancelled_at`, `cancelled_by`, `cancellation_reason` (required), `reversal_journal_entry_id`;
  2. `reverseJournal` of the original POS_SALE voucher (all five lines incl. IT) and of the COGS voucher, using the **stored** amounts, never recomputed;
  3. layers and stock restored from settlements;
  4. tenders reversed into the same session (declaration expected amount decreases);
  5. session totals decremented on the linked session.
- Any journal error aborts the whole void.
- **FACTURA continuity is preserved:** the number is never deleted or reused. The annulled factura stays in the register and is excluded from IVA/IT totals but listed with status. **[VAL V-2]:** whether SIN requires annulled facturas to be reported in the Libro de Ventas with status "A", and the annulment window. The enum lets Kubi switch to `CREDIT_NOTE_ONLY` without code.

### 2.5 Manual factura and factura cancel (DEF-046, 047)

- **Manual factura becomes a free-text sales invoice [REC]:**
  - it must post Dr AR (or a selected `SalesPaymentMethod` for cash) / Cr REVENUE (selected main account or item group), VAT_OUTPUT, IT;
  - `source_type` is forced to `MANUAL`;
  - `invoice_date` = today unless `SalesParameters.manual_factura_date_policy` enum `TODAY_ONLY | OPEN_PERIOD_NOT_BEFORE_LAST_ISSUED` (default `TODAY_ONLY`). A backdated factura is refused if it predates the highest issued FACTURA date, which protects number↔date sequentiality.
  - No ledger → refused before a number is drawn. The D365 free text invoice posts to AR; I did not fetch that Learn page this session, so label it **[REC]**.
- **Factura cancel = annulment with ledger effect:**
  - allowed for `SALE` and `MANUAL` when not paid or settled (today: `paid_at` null), within `SalesParameters.factura_annul_window` enum `SAME_DAY | OPEN_PERIOD | NONE` (default `OPEN_PERIOD`) — **[VAL V-2]**;
  - reason required;
  - reverse the posting voucher, revert `FacturaLine` invoiced quantities, clear `SalesOrder.invoice_id` so the order can be invoiced again **with a new number**;
  - `POS_SALE` → refused with a pointer to POS void; `RETURN` credit notes → refused (correct with a new invoice, [REC]);
  - 404/409 on no-op.

### 2.6 Sales lifecycle (DEF-042…045, 050, 020)

- **Cancel an invoiced order:** 409 `ORDER_INVOICED` ("annul the factura or return"). **[OFF]** Only Created orders can be cancelled: <https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/sales-orders-faq>. PACKED cancel releases the order's reservations. SHIPPED cannot be cancelled.
- **Return on an uninvoiced order** = shipment reversal only: stock and layers restored at the issued cost, COGS reversed, **no FACTURA number, no credit note**, status `RETURNED`. Return on an invoiced order = credit note as today (FACTURA series pending D-9) with the stored invoice amounts.
- **Pay:**
  - allowed only when invoiced, status ∉ {CANCELLED, RETURNED, VOIDED} and factura not CANCELLED;
  - debit account from a `SalesPaymentMethod` id (the `account_code` free text and the `'1102'` default are removed);
  - guarded `updateMany where paid_at IS NULL` inside the transaction.
- **Invoice:** inside the transaction, **before** `nextFacturaNumber`: `updateMany where id, invoice_id IS NULL, status NOT IN (...)` with a placeholder lock, or `SELECT … FOR UPDATE` on the order. Count 0 → 409. This is the only safe place: continuous allocation rolls back with it.
- **Order edit:** strict schema; discount honoured (`total = subtotal − discount`, tax on the discounted total with party); CONFIRMED edit releases the order's own reservations and re-reserves in one transaction, refusing if unavailable.

### 2.7 Storefront order (DEF-001, 048) — D-15

**[OFF]** One order-fulfillment engine for e-commerce and store orders: <https://learn.microsoft.com/dynamics365/commerce/order-fulfillment-overview>.

1. Strict body: `lines[{product_id, variant_id?, quantity}]`, optional `shipping_address`, `notes`. Price, discount, warehouse and currency are rejected (`.strict()` → 400).
2. Price resolved server-side by the same resolver as the ERP order (selling price + variant `additional_cost`; SALES trade agreement where one applies). Product must be `is_active` and published, and variant active. Otherwise 422 `PRODUCT_NOT_SELLABLE`.
3. Warehouse = `SalesParameters.storefront_warehouse_id` (new, owner Sales → Channels). Null → 422 (never client-chosen).
4. **Create + reserve in one transaction** through `createOrder` + `reserveForOrder` (writes `InventoryReservation`), status CONFIRMED. **No deduction at order time.** Ship consumes the order's reservations via `issueFromLayers`. Cancel releases exactly those reservations.
5. Hook only: `InventoryReservation.expires_at` nullable (unpaid-cart expiry is a behaviour cut).
6. Allow-list projection for shoppers (id, sku, name, description, images, category name, price, variant options, `in_stock` boolean for the storefront warehouse). No internal ids, `reorder_point` or exact quantities.

### 2.8 Journal post period re-check and finance controls (DEF-060, 062, 063)

- `POST /journal-entries/:id/post`, in one transaction:
  1. load the draft (tenant-scoped, `FOR UPDATE`);
  2. re-run the exported closed-period check (`allow_posting_to_closed_period` honoured and logged);
  3. re-assert balance and that every account is active and in the tenant;
  4. check `FinanceParameters.journal_self_post_policy` (see §2.9);
  5. guarded update with `posted_by`, `posted_at`.
- **[OFF]** Closed periods need a new date: <https://learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/cant-reverse-transactions>
- **Manual reversal route:** `POST /journal-entries/:id/reverse {date, reason}` → `reverseJournal`. Refused for non-MANUAL sources ("reverse the source document").
- **Account:**
  - deactivate refused while the balance ≠ 0 or the account is referenced by a posting profile or payment method (409);
  - code, type and normal balance immutable once any line exists (name editable);
  - **every report stops filtering `is_active`** (balances of inactive accounts always show).

### 2.9 Segregation of duties (DEF-080, 082, 060)

**[OFF]** *Disallow approval by submitter* — default No in D365, configurable: <https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/organization-administration/configure-approval-process-workflow#prevent-the-submitter-from-approving-steps-in-the-workflow>

- One enum shape, `ALLOW_SUBMITTER | DISALLOW_SUBMITTER`, stored in the **owning** module's parameters:
  - `PurchaseParameters.requisition_self_approval`;
  - `PurchaseParameters.invoice_discrepancy_self_approval`;
  - `PurchaseParameters.vendor_payment_self_approval` (Cash and bank if that owner exists; Purchase otherwise, as a stated fallback);
  - `FinanceParameters.journal_self_post_policy`.
- **Default `DISALLOW_SUBMITTER` for all four** (Kubi's SoD instruction). A single-person shop switches to ALLOW in Setup.
- An enum rather than a boolean, so a later `REQUIRE_FINAL_APPROVER` value attaches without migration.
- Each refusal is 403 `SOD_SELF_APPROVAL`, audited.
- RFQ creation requires an APPROVED requisition when `requisition_approval_required`. Award locks the requisition lines (`FOR UPDATE`) and refuses when the case is already AWARDED.

### 2.10 Receive-and-invoice; invoice qty vs received; USD PO (DEF-083…085)

- **Atomicity:**
  - `createAndPostReceipt`, `createInvoice` and `postInvoice` accept a `tx` client; the route runs all three in one `db.$transaction`;
  - invoice validation (duplicate number, matching policy, currency) runs **before** the receipt write;
  - no FACTURA involvement, and internal PR/VI numbers may gap (non-continuous by design — this closes the "uncertain rollback" item as intended behaviour).
- **Invoice quantity:**
  - **[OFF]** Three-way matching compares invoice quantity to matched product-receipt quantity; a difference is a quantity matching error: <https://learn.microsoft.com/dynamics365/finance/accounts-payable/accounts-payable-invoice-matching#three-way-matching>
  - **[REC] SME decision:** for stocked lines under the split receipt/invoice flow, an invoice line quantity above its matched received quantity is **refused at posting** (422 `INVOICE_QTY_EXCEEDS_RECEIVED`), whatever the discrepancy policy ("receive first, or reduce the quantity").
  - PRICE_VARIANCE carries only price differences on matched quantity. The orphan accrual on a later receipt cannot occur.
  - Non-stocked and service lines keep today's expense path.
- **USD PO:** `assertDocumentCurrencySupported(..., 'PURCHASE_FX_NOT_IMPLEMENTED')` on create and update, before `allocateNumber`, mirroring `sales.service.ts:82-86`. WORK-026 opens it by deleting the guard.

### 2.11 Refresh-token revocation (DEF-100, 101, 104)

- Migration: `refresh_tokens` gains `jti uuid UNIQUE`, `family_id uuid`, `revoked_at timestamptz NULL`, `replaced_by_id uuid NULL`, `revoked_reason text NULL`, index `(user_id, revoked_at)`.
- **Refresh:**
  1. verify the JWT in try/catch → 401;
  2. look up the row by `jti`, check its bcrypt hash;
  3. if `revoked_at` is set → **revoke the whole family** (reuse detection), 401;
  4. check the user is active **and** the tenant is active **and** `user.tenant_id = payload.tenantId`;
  5. rotate: new row, same family; old row `replaced_by_id`, `revoked_at`.
- `POST /auth/logout` revokes the family and clears the cookie.
- Deactivate, role change and password change revoke all of the user's families.
- Accepted residual (recorded): an access token stays valid up to `JWT_EXPIRES_IN` = 15m after revocation. Checking it on every request is not worth a per-request database read at SME volume.

### 2.12 P2002 → 409 (DEF-102)

`errorHandler` maps Prisma known errors:

| Prisma code | HTTP | Error code |
|---|---|---|
| `P2002` | 409 | `DUPLICATE` (message names `meta.target` fields, no values) |
| `P2003` | 422 | `INVALID_REFERENCE` |
| `P2025` | 404 | `NOT_FOUND` |

Everything else stays 500 and is logged. `PrismaClientValidationError` stays 500 on purpose: it is a coding bug and must not look like user error.

### 2.13 FACTURA numbering safety (DEF-040, 041)

- `provisionConfiguration.ts` provisions FACTURA `continuous: true`. The stale NOTE at `:503` is removed.
- `PUT /setup/number-sequences/:id` refuses, for legal references (`FACTURA`, and `CREDIT_NOTE` once used):
  - `continuous:false`;
  - a forward `next_number` jump beyond highest issued + 1, unless `acknowledge_gap_reason` (min 15 chars) is supplied and audited. This is a legitimate case: pre-printed stock lost.
- The set of legal references is a constant in the numbering service (infrastructure, not tenant configuration — exempt from §4.1 with this reason recorded). The jurisdiction-level legal flag is a later hook: a `NumberSequence.legal_series` enum `NONE | GAPLESS`, added in this migration defaulting to `NONE`, with `GAPLESS` for FACTURA rows.

---

## 3. Frontend and configuration directive

### 3.1 The rule (acceptance criterion from WORK-042 on, extends worklog §4.1 rule 5)

> **Every backend-managed structure that an authorized end user operates or configures has a UI to create, view, change and (de)activate it, with server-side validation and permission enforcement, reachable from its owning module.** A work item that adds or changes such a structure is not accepted without that UI. An exemption is allowed only when the item is classified and the classification is recorded in the endpoint→UI coverage matrix:
>
> - `INTERNAL`: called only by other services, scripts or harnesses;
> - `HOOK_ONLY`: schema reserved and no code reads it — read-only view or none, open gap recorded;
> - `DEPRECATED`: to be removed.

**Accompanying rules:**
1. **No write without a UI, no UI without a guard.** The frontend hides or disables actions the caller lacks permission for (a `usePermission` reading the exported manifests). A 403 is never the discovery mechanism.
2. **Errors are shown, never swallowed.** A single `apiError(e)` helper reads `error.message` and `error.code`. Every mutation has `onError`. A lint or grep check in CI: no `response.data.message` and no mutation without `onError`.
3. **Configuration UIs live in the owning module's Setup area** (no global settings page). A value read by two modules is edited only by its owner; the reader shows it read-only with a link.
4. **The coverage matrix is a CI artifact:** the main session's script output is pinned as a test. A new route without a caller and without a classification fails CI.

### 3.2 Classification of the coordinator's 44 uncalled endpoints

| Class | Endpoints | Delivered in |
|---|---|---|
| UI_REQUIRED P1 | `PUT customers/:id` (+ create form); `PUT hr/users/:id/role`; `PUT hr/users/:id/deactivate`; `GET hr/users`; `PUT hr/employees/:id`; `POST hr/employees/:id/pos-pin`; `DELETE …/pos-credentials`; `GET+PUT tenant/config`; `POST purchase/orders/:id/cancel`; `GET purchase/orders/:id/receipts`; `POST warehouse/arrival-journals/:id/post` (only after DEF-021 is fixed); `POST warehouse/work/:id/lines/:lineId/complete` (replaces the bogus `/complete`); `GET finance/facturas/:id`; `GET pos/sessions` (auditor/manager Z-report history) | 054, 047, 052 |
| UI_REQUIRED P2 | `POST crm/leads/:id/convert-to-customer`; `PUT sales/quotations/:id/lines`; `PUT crm/stages/:id`; `GET customers/:id/orders`, `customers/segments`; `POST procurement/requisitions/:id/cancel`; `POST procurement/rfq/bids/:id/decline`, `/reject`; `GET+POST purchase/setup/trade-agreements`, `…/:id/close`; `PUT products/setup/item-groups/:id`; `PUT setup/operating-units/:id`, `GET setup/operating-units/types`; `GET products/:id/stock`; `GET reports/inventory/valuation`, `/turnover`, `purchases/monthly`; `DELETE warehouse/location-directives/:id` | 054 |
| INTERNAL | `GET finance/exchange-rates/resolve`; `GET finance/periods/:y/:m/status`; `GET import/jobs/:id` (import disabled, DEF-109) | — |
| DEPRECATED / feature-flagged off | `POST products/:id/generate-video`, `DELETE products/:id/video` (paid video jobs are not SME-core; keep behind an admin-only flag, no new UI); `GET reports/sales/by-city` (replace with store/dimension P&L in WORK-039) | 052 (guard) |
| Remove | `POST /warehouse/work/:id/complete` (DEF-014) | 043 |

### 3.3 Configuration models without a write API (coordinator's list B)

| Model | Decision | Owner Setup area | Item |
|---|---|---|---|
| `PostingProfile` | **Needed now** — API + UI (matrix by posting type × scope; date-effective; refuse overlaps; show resolution preview) | Finance → Posting | 053 |
| `TaxCode`, `TaxGroup`, `TaxGroupCode`, `ItemTaxGroup`, `ItemTaxGroupCode` | **Needed now** — the Ley 1733 transition is a new dated `TaxCode` row; edits to a code with posted use are refused, a new version is created instead | Finance → Tax | 053 |
| `SalesParameters` | **Needed now** (+ the new fields in §2) | Sales → Parameters | 053 (fields added by their own items) |
| `PurchaseParameters` | **Needed now** (SoD enums, flow, matching) | Purchase → Parameters | 053 |
| `InventoryParameters` | **Needed now** (uncosted policy, count policy) | Inventory → Parameters | 053 |
| `MatchingPolicy`, `PriceTolerance` | **Needed now** (TEST runs three-way at 2%) | Purchase → Invoice matching | 053 |
| `DefaultDimensionAssignment` | **Needed now** — read by `dimension.service.ts:281`; STORE is required on revenue and COGS | Finance → Dimensions | 053 |
| `SalesPaymentMethod` (new) | Needed now | Sales → Payment methods | 047 (UI in-item) |
| `WorkTemplate`/`WorkTemplateLine`, `WaveTemplate` | **HOOK_ONLY** for editing. No reader found for `workTemplate` (grep); wave template is seeded. Read-only list; editing is an open recorded gap | Warehouse → Setup | 053 (read-only) |
| `ProductParameters`, `ProductDimension*` (6), `ProductVariantValue` | **HOOK_ONLY.** No reader found (grep); variants are managed through the existing variant-type UI. Read-only or none, open gap recorded | Product → Setup | — |

---

## 4. Work items and order

**Numbering:**
- WORK-042 onward supersedes queue items WORK-031 (→044), WORK-032 (→045) and WORK-033 (→047, except the customer-account tender).
- WORK-030b and WORK-030c keep their approved designs.
- WORK-026, 027 and 034–041 stay in the matrix queue after this remediation.

**Every item carries:**
- worklog §4.1 (rules 1–5 plus §3.1 above);
- catalog IDs (Level 2 verified; L3 `UNVERIFIED-*` placeholders until the workbook arrives);
- `tenant_id` in every new uniqueness constraint; guard first on every route (030 manifests);
- the Bolivia regression set:
  - continuous FACTURA with no gap or duplicate under injected failure;
  - Bs 1 299,00 → IVA 168,87 / IT 38,97 on invoice, POS and negated credit note;
  - IT sales-only;
- when a migration exists: isolated rebuild, empty Prisma drift, repeat no-op, TEST applied with `MIGRATION_APPLIED_BY=claude-work-NNN`;
- a read-only Step 0 on TEST before any destructive-looking constraint.

**Order** (data corruption and legal first; no-schema designed security items early to avoid touching the same routes twice):

**042 → 030b → 043 → 044 → 045 → 047 → 048 → 049 → 046 → 051 → 030c → 050 → 052 → 053 → 054**

---

### WORK-042 — Legal numbering safety and fail-closed baseline (S)

- **Catalog:** 99.20.040.000, 65.30 (FACTURA), 99.25.
- **Defects:** DEF-040, 041, 101, 102, 109; DEF-019 (costing-method refusal only).
- **Schema — migration `036_number_sequence_legal_series.sql`:**
  - `number_sequences.legal_series text NOT NULL DEFAULT 'NONE'` + CHECK in (`NONE`, `GAPLESS`);
  - `UPDATE … SET legal_series='GAPLESS', continuous=true WHERE reference='FACTURA'`.
  - Step 0 counts FACTURA rows with `continuous=false`; TEST is expected to have 0.
- **Backend:**
  - provisioning sets continuous true;
  - the sequence PUT refuses `continuous:false` on GAPLESS and a forward jump without `acknowledge_gap_reason` (audited);
  - error handler maps P2002/P2003/P2025;
  - refresh route try/catch → 401;
  - item model group refuses non-FIFO costing;
  - import `execute`/`validate` return 501 `IMPORT_NOT_IMPLEMENTED` and never mark COMPLETED.
- **Frontend:** number sequence screen shows "legal gapless series" and a gap-reason dialog; import page shows "not available".
- **Tests:**
  - Jest: sequence PUT refusals;
  - error mapping (3 codes);
  - refresh 401 on garbage;
  - provisioning snapshot has FACTURA continuous;
  - import 501.
- **TEST:** migration applied; `verify:tenant-numbering`; FACTURA `next_number` unchanged.
- **Bolivia risk:** none (makes the TEST state the default).
- **Depends on:** none.

### WORK-030b — as designed (M, no schema)

- Adds DEF-015 (guards) and DEF-018 foreign locations, per design §16.1.
- DEF-014 route removal happens in 043 so 030b stays pure permissions. 030b may map `/complete` to `warehouse.work.complete` temporarily.

### WORK-043 — Stock and reservation integrity (L)

- **Catalog:** UNVERIFIED-60.40-A/B, 60.20-C, 65.20-A.
- **Defects:** DEF-001 (stock half), 002, 003, 004, 005 (quantity part), 008 (reservation part), 012, 013, 014, 016, 017, 018, 020.
- **Schema — migration `037_inventory_reservations_and_stock_constraints.sql`:**
  - **New table `inventory_reservations`:**
    - `id`, `tenant_id`, `source_type text` CHECK (`SALES_ORDER`, `STOREFRONT_ORDER`, `TRANSFER`, `WORK`), `source_id uuid`, `source_line_id uuid NULL`, `stock_id uuid` FK → `inventory_stock`, `product_id`, `variant_id NULL`, `location_id`, `quantity int CHECK (quantity > 0)`, `status text` CHECK (`ACTIVE`, `CONSUMED`, `RELEASED`), `expires_at timestamptz NULL` (hook), `created_at`, `released_at NULL`;
    - index `(tenant_id, source_type, source_id, status)`.
  - `inventory_stock.reserved_qty` stays as the cached sum; CHECK `reserved_qty >= 0 AND reserved_qty <= quantity AND quantity >= 0`, added `NOT VALID`, then `VALIDATE` only if Step 0 finds 0 violations (otherwise stop and report).
  - Replace the unique index with `(tenant_id, product_id, variant_id, location_id) NULLS NOT DISTINCT`, only if Step 0 finds no duplicate groups (otherwise stop and report).
  - Backfill: for CONFIRMED/PACKED orders with `reserved_qty` > 0, write ACTIVE reservation rows **only where attribution is unambiguous**; Step 0 reports the rest, which are left for a manual release script.
  - No `ALTER` on the frozen migrations.
- **Backend:**
  - `reservation.service.ts` (`reserveForSource`, `releaseForSource`, `consumeForSource`), all `tx`-bound with `FOR UPDATE` on stock rows;
  - `fulfillOrder` rewritten: consume the order's reservations in its warehouse, exact variant match, shortfall → throw 409 `STOCK_INSUFFICIENT`;
  - ship wrapped in one transaction (costing arrives in 044; here quantities and statuses only, COGS unchanged);
  - storefront route stops deducting and reserves via the service;
  - POS deduction honours `reserved_qty` and the availability filter;
  - PACKED cancel releases; `/work/:id/complete` removed;
  - SHORT re-complete accumulates; pick excludes other orders' reservations only;
  - transfer check inside the transaction, from ≠ to;
  - null-variant upserts replaced with `findFirst`/`create` under the new unique index.
- **Frontend:** work page uses line completion; remove the "Complete" button.
- **Tests:**
  - Jest: storefront create → no stock movement; ship twice → second 409;
  - cancel releases only own reservations (two orders, two warehouses);
  - null-variant line never touches variant rows;
  - shortfall refusal; PACKED cancel;
  - `/complete` 404; POS cannot sell reserved stock.
- **TEST harness `verify:stock-reservations`** (self-cleaning): two warehouses; storefront order → ship → on-hand −1 once; cancel isolation; constraint rejects a negative update.
- **Bolivia risk:** POS sale path is touched. Run the POS Bolivia anchor in Jest (engine only; no live POS sale on TEST per the 2026-09-11 decision).
- **Depends on:** 042, 030b.

### WORK-044 — FIFO issue costing and COGS from layers (L) — supersedes WORK-031

- **Catalog:** UNVERIFIED-60.xx-COST, 60.40-D, 65.20-B, 65.20.400.000.
- **Defects:** DEF-005 (value), 006, 007, 008 (cost), 009, 019 (policy part).
- **Schema — migration `038_inventory_cost_settlement.sql`:**
  - **New table `inventory_cost_settlements`:** `id`, `tenant_id`, `inventory_transaction_id` FK, `cost_layer_id` FK, `quantity int > 0`, `unit_cost numeric(14,4)`, `cost_amount numeric(14,2)`, `cost_currency_code`, `cost_source text` CHECK (`LAYER`, `ESTIMATED`), `reversed_by_id uuid NULL UNIQUE`, `created_at`; indexes on transaction and layer.
  - `inventory_transactions`: `cost_layer_id uuid NULL`, `cost_amount numeric(14,2) NULL`.
  - `inventory_cost_layers`:
    - `original_quantity int NULL` (backfill = current quantity, recorded as approximate for history);
    - `source_type text NOT NULL DEFAULT 'PURCHASE_RECEIPT'` CHECK (`PURCHASE_RECEIPT`, `TRANSFER`, `SALES_RETURN`, `ADJUSTMENT`, `COUNT`, `OPENING`);
    - `origin_settlement_id uuid NULL`;
    - CHECK `quantity >= 0`.
  - `inventory_parameters`: `uncosted_issue_policy text NOT NULL DEFAULT 'REFUSE'` CHECK; `cost_level text NOT NULL DEFAULT 'WAREHOUSE'` CHECK (`LEGAL_ENTITY`, `SITE`, `WAREHOUSE`) as a hook, FIFO ignores it.
  - `sales_orders.register_session_id uuid NULL` — added here because void needs it; used in 047.
- **Backend:**
  - `costLayer.service.ts` `issueFromLayers` / `restoreSettlements` / `receiveLayer`;
  - ERP ship posts COGS from settlements inside the ship transaction;
  - POS sale consumes layers and COGS = settlements (voucher unchanged in shape);
  - POS void restores settlements; the existing void voucher becomes a reversal of stored vouchers (full void semantics completed in 047);
  - customer return: new layer at the issued cost from the original settlements;
  - `unit_cost` on OUTBOUND = weighted settlement cost;
  - `cost_price` removed from every posting path (grep acceptance: no `cost_price` in `sales.service.ts`, `sales.routes.ts`, `pos.routes.ts` posting code).
- **Tests:**
  - two layers at 100 and 120 in WH-A and one at 90 in WH-B; ship 3 from WH-A → COGS 100+100+120 (for layer quantities 2/1), WH-B untouched;
  - return re-layers at the issued cost;
  - void restores the same layers;
  - REFUSE policy blocks before any write (FACTURA unchanged).
- **TEST harness `verify:cogs-layers`** (self-cleaning, no live POS sale): receipt → ship → GL COGS = Σ settlements; inventory GL change = layer value change; return round-trip nets to 0.
- **Bolivia risk:** POS and return vouchers change their COGS amount only; the revenue, IVA and IT lines are asserted byte-identical in Jest.
- **Depends on:** 043.

### WORK-045 — Inventory adjustment and counting journals (M) — supersedes WORK-032

- **Catalog:** UNVERIFIED-60.20-A/B, 99.20.040.000.
- **Defects:** DEF-010, 011, 052 (count number).
- **Schema — migration `039_inventory_journals.sql`:**
  - `inventory_journals`: `id`, `tenant_id`, `journal_number`, `journal_type` CHECK (`ADJUSTMENT`, `COUNT`, `OPENING`), `warehouse_id`, `status` CHECK (`DRAFT`, `POSTED`, `CANCELLED`), `posted_at`, `posted_by`, `journal_entry_id NULL`, `reason_code_id NULL`, `source_count_id NULL`; `UNIQUE (tenant_id, journal_number)`.
  - `inventory_journal_lines`: `journal_id`, `product_id`, `variant_id NULL`, `location_id`, `snapshot_qty int NULL`, `counted_qty int NULL`, `delta_qty int`, `unit_cost numeric(14,4) NULL`, `reason_code_id NULL`.
  - `inventory_reason_codes`: `tenant_id`, `code`, `name`, `direction` CHECK (`INCREASE`, `DECREASE`, `BOTH`), `is_active`; `UNIQUE (tenant_id, code)`.
  - `inventory_parameters.count_snapshot_policy` DEFAULT `REFUSE_IF_CHANGED`.
  - Posting types `INVENTORY_ADJUSTMENT_GAIN`, `INVENTORY_ADJUSTMENT_LOSS`, `INVENTORY_OPENING_BALANCE` (string values, additive).
  - Sequence references `INVENTORY_ADJUSTMENT` (exists) and `INVENTORY_COUNT` (new), provisioned non-continuous.
- **Backend:**
  - journal service with post-in-one-transaction per §2.2;
  - count finalize creates and posts a COUNT journal;
  - `/inventory/adjust` wrapper;
  - OPENING type available only with `inventory.journal.opening` (admin) for the TEST reconciliation (Q2).
- **Frontend:** Inventory → Journals (list, create, lines, post), reason codes Setup, count page scoped by warehouse or location, error display.
- **Tests:**
  - +5 → layer and Dr Inventory;
  - −3 → FIFO consumption and Dr Loss;
  - count with a movement after snapshot → 409;
  - negative on-hand refused;
  - null variant works;
  - no FACTURA change.
- **TEST harness `verify:inventory-journals`**.
- **Bolivia risk:** none (no IVA/IT effect by default).
- **Depends on:** 044.

### WORK-047 — POS tender, session declaration, void as annulment (L) — supersedes WORK-033 except the customer-account tender

- **Catalog:** UNVERIFIED-65.20-B, 65.30-C (cash part).
- **Defects:** DEF-030…036.
- **Schema — migration `040_pos_tenders_and_declarations.sql`:**
  - `sales_payment_methods`: `tenant_id`, `legal_entity_id NULL`, `warehouse_id NULL`, `code`, `name`, `tender_type` CHECK, `account_id` FK, `declaration_policy` CHECK (`NONE`, `COUNT`), `allow_change bool`, `max_difference_amount numeric NULL`, `is_active`; `UNIQUE (tenant_id, legal_entity_id, warehouse_id, code) NULLS NOT DISTINCT`.
  - `pos_tenders`: `tenant_id`, `sales_order_id`, `register_session_id`, `payment_method_id`, `amount`, `tendered NULL`, `change NULL`, `reversed_by_id NULL`, `settled_journal_entry_id NULL` (hook).
  - `register_session_declarations`: `tenant_id`, `register_session_id`, `payment_method_id`, `expected`, `counted`, `difference`, `journal_entry_id NULL`; `UNIQUE (register_session_id, payment_method_id)`.
  - `facturas`: `cancelled_at NULL`, `cancelled_by NULL`, `cancellation_reason NULL`, `reversal_journal_entry_id NULL`.
  - `sales_parameters.pos_void_mode` DEFAULT `ANNUL_IN_SESSION`.
  - Posting type `CASH_DIFFERENCE`.
  - Seed (script, dry-run default): CASH / CARD / QR methods mapped to the tenant's CASH/BANK-category accounts, refusing on ambiguity like provisioning does.
- **Backend:**
  - `PosSaleSchema` gains `tenders[]` (legacy `payment_method` + `cash_tendered` accepted and mapped for one release, recorded);
  - sale posting per §2.3; `CUSTOMER_ACCOUNT` refused; `register_session_id` stamped; `customer_id` stored when chosen;
  - close requires declarations and posts the difference;
  - void per §2.4 (guarded, originating session, full reversal incl. IT, no swallowed errors).
- **Frontend:** POS payment modal with split tender and change; close-shift declaration screen per method; Z report from declarations; payment method Setup form (Sales); session history list for manager and auditor (`GET pos/sessions`).
- **Tests:**
  - cash+QR split posts two debits, no AR;
  - Z-report expected excludes card;
  - over/short voucher;
  - void → factura CANCELLED, number retained, IT reversed, stock and layers restored, second void 409, void in another session refused;
  - injected journal failure rolls back the void.
- **TEST:** migration + seed dry-run output to Kubi; harness `verify:pos-ledger` **without committing a live sale** unless Kubi approves (it consumes FACTURA — Q4).
- **Bolivia risk:** HIGH — the POS voucher shape changes (AR → tender accounts). Jest asserts IVA 168,87 and IT 38,97 on Bs 1 299, and FACTURA continuity under an injected tender-validation failure (refused before allocation).
- **Depends on:** 044.

### WORK-048 — Sales order, return and payment lifecycle (M)

- **Catalog:** UNVERIFIED-65.20-A, 65.20.400.000, 65.30-A/C/E, 85 (quotation, CRM rows).
- **Defects:** DEF-042, 043, 044, 045, 049, 050, 051, 052 (shipment number), 053, 054.
- **Schema:** no new table. Sequence reference `SHIPMENT`, provisioned non-continuous.
- **Backend:**
  - cancel refusals;
  - uninvoiced return = shipment reversal without factura;
  - invoice and pay guarded inside the transaction before number allocation;
  - pay via `payment_method_id` (`SalesPaymentMethod`);
  - refund credits the method used at payment;
  - credit note uses the factura's stored amounts;
  - order create and edit schemas with discount and re-reservation;
  - quotation validity and terminal statuses;
  - explicit expiry job instead of write-on-read;
  - CRM PUT allow-lists.
- **Frontend:** order detail `onError`; pay dialog with method picker; return dialog explains credit-note-vs-reversal; discount field honoured.
- **Tests:**
  - concurrent invoice → one factura;
  - pay on RETURNED → 409;
  - uninvoiced return consumes no FACTURA number;
  - invoiced cancel 409;
  - discount totals;
  - quotation expired confirm 409.
- **TEST:** `verify:o2c-containment` regression + new `verify:sales-lifecycle` (no FACTURA-consuming step unless Q4 approves).
- **Bolivia risk:** credit note amounts now come from the stored factura; assert the negated anchor.
- **Depends on:** 044, 047 (payment method master).

### WORK-049 — Factura lifecycle: manual (free-text) invoice and annulment (M)

- **Catalog:** UNVERIFIED-65.30-A/B.
- **Defects:** DEF-046, 047.
- **Schema:** `sales_parameters.manual_factura_date_policy` DEFAULT `TODAY_ONLY`; `factura_annul_window` DEFAULT `OPEN_PERIOD`. The factura cancel columns come from 040.
- **Backend:**
  - manual factura posts per §2.5 (strict schema, `source_type` forced, date policy, revenue account or item group required);
  - cancel per §2.5 with reversal and order unlink;
  - IVA report lists CANCELLED as annulled and excludes them from totals.
- **Frontend:** manual factura form (customer, NIT, lines or amount, revenue account, payment method optional); cancel dialog with reason and consequences; factura detail page (`GET facturas/:id`); label fixes DEF-069 on factura, PDF and IVA pages.
- **Tests:**
  - manual factura voucher balances and IVA book = ledger;
  - backdated refused;
  - cancel reverses and re-invoice draws N+1;
  - POS_SALE cancel → 409 with pointer to void.
- **Bolivia risk:** legal. The annulment semantics are [VAL V-2]; the parameters make the fallback a Setup change.
- **Depends on:** 047.

### WORK-046 — Storefront integrity, D-15 (M)

- **Catalog:** 65.20 (e-commerce order), 99.25.
- **Defects:** DEF-001 (lifecycle), 048, 023 (shop tiles), DEF-110 (register token), DEF-069 (checkout `/1.13`).
- **Schema:** `sales_parameters.storefront_warehouse_id uuid NULL`.
- **Backend:** strict storefront schema; server price resolver shared with ERP; sellable-product check; allow-list projection; `GET /products/:id` active filter for shoppers.
- **Frontend:** checkout shows server totals from the tax preview; register page uses in-memory tokens; channel Setup field.
- **Tests:** price tampering ignored or 400; unpublished 422; projection keys pinned; storefront → ship → cancel reservation cycle.
- **TEST:** extend `verify:o2c-permissions`.
- **Depends on:** 043, 044.

### WORK-051 — Source to Pay controls (M)

- **Catalog:** 75.40.010/020/050.000, 75.50.020/090.000, 60.30.
- **Defects:** DEF-080…092, 021.
- **Schema:** `purchase_parameters.requisition_self_approval`, `invoice_discrepancy_self_approval`, `vendor_payment_self_approval` (DEFAULT `DISALLOW_SUBMITTER`).
- **Backend:**
  - SoD checks; RFQ approval requirement, line lock, single award;
  - receive-and-invoice transaction; invoice qty refusal;
  - USD PO fail-closed at create and update;
  - duplicate check excludes CANCELLED, case-insensitive;
  - credit after full payment → create a DEBIT open transaction as an unsettled supplier credit instead of refusing ([REC], mirrors the AP model);
  - receipt location validated against the PO warehouse and tenant;
  - PO schema `warehouse_id` required and lines min 1;
  - requisition CLOSED rule; bid only on SENT;
  - return reduces received and invoiced qty;
  - `require_requisition_for_po` enforced; `receipt_invoice_flow` read by the UI default;
  - `vat_input_recognition` marked HOOK_ONLY in Setup;
  - arrival journal: strict schema and number from a sequence, **or disabled with 501 until warehouse arrival is redesigned** — decision: disable (the SME path is receipt → putaway, which is TEST-verified).
  - NIT format validation stays soft (a warning) — [VAL].
- **Frontend:** PO cancel, currency display, partial receipt, invoice line edit, purchase parameters form (in 053, or here if 053 is not yet started).
- **Tests:** self-approval refusals per enum; receive-and-invoice with a duplicate invoice number leaves no receipt; qty over received 422; USD PO 409 before number.
- **TEST:** `verify:purchase-cycle` + `verify:supplier-return` regression.
- **Depends on:** 042.

### WORK-030c — as designed (M, no schema)

- Plus DEF-067; auditor read of audit (G-6).
- Journal-post period re-check D-14 **moves to WORK-050**, so it is not implemented twice. 030c keeps the permissions only.

### WORK-050 — Finance controls (M)

- **Catalog:** UNVERIFIED-90.60-A/B/D, 90.50.
- **Defects:** DEF-060…066, 068, 070, 071, 069 (finance labels and years).
- **Schema — migration `042_finance_controls.sql`** (renumbered 2026-09-18: `041_document_attachments.sql` took 041, and the chain must be gap-free — the next file takes the next free ordinal):
  - `journal_entries.posted_by uuid NULL` (if absent);
  - `finance_parameters.journal_self_post_policy` DEFAULT `DISALLOW_SUBMITTER`;
  - `accounting_period_events` (`tenant_id`, `period_id`, `action` CHECK (`CLOSE`, `REOPEN`, `ON_HOLD`), `actor`, `at`, `reason`).
- **Backend:**
  - post re-checks; reversal route; account guards;
  - reports include inactive accounts;
  - period validation 1–12 and history rows;
  - month derivation in `Tenant.timezone` (validated IANA, DEF-113);
  - bank rec resolves the account by `SalesPaymentMethod` or the CASH/BANK category picker, not `1101`;
  - journal line `dimensions` accepted;
  - imbalance → 400;
  - dashboard revenue from posted revenue lines.
- **Frontend:** journal form (null → omit, dimension picker, reverse action), account deactivate with reason, period reopen confirm with history, currency banner on finance screens (DEF-12 of 04).
- **Tests:** post into a closed period 409; self-post refusal; reversal nets 0; deactivate with balance 409; the TB balances after an attempted deactivate; the 1st-of-month boundary under `America/La_Paz`.
- **TEST:** `verify:currency-foundation` re-run.
- **Depends on:** 030c.

### WORK-052 — Identity, sessions, HR security (M)

- **Catalog:** 99.25.050/060/070/110.000.
- **Defects:** DEF-100, 103, 104, 105, 106, 107 (security parts), 110.
- **Schema — migration `043_refresh_token_rotation.sql`** (renumbered 2026-09-18, see WORK-050): per §2.11. Existing rows get `jti` NULL and are treated as revoked on the next refresh (forces re-login once; recorded).
- **Backend:**
  - rotation, reuse detection and logout;
  - revoke on deactivate and role change;
  - HR schemas with allow-list and transactions; employee code from a sequence;
  - role assignment: only roles ⊆ the assigner's grants (admin exempt); no `customer` via HR; last-admin and self-demotion guards;
  - login without tenant → 400 when the email exists in more than one tenant;
  - rate-limit key requires trusted proxy config;
  - FK tenant checks on warehouse, zone, location and operating unit;
  - video routes admin-flagged.
- **Frontend:** users page (list, role change, deactivate or reactivate); employee edit; POS PIN management; logout calls the API; ERP layout refuses non-workforce roles; sidebar filtered by permission.
- **Tests:** refresh reuse revokes the family; logout → refresh 401; deactivate → refresh 401; `PUT employees` with `tenant_id` ignored or 400; role escalation refused.
- **TEST:** `verify:identity-sessions`.
- **Depends on:** 030c.

### WORK-053 — Configuration maintenance API + UI (L; split 053a Finance: posting profiles, tax, dimension defaults; 053b module parameters, matching and tolerance, read-only warehouse templates)

- **Catalog:** 90.10, 99.20, 75.50.020, 65.30 setup.
- **Defects:** DEF-115, 091 (UI part).
- **Schema:** none expected (models exist). If an edit-history need appears, it goes to the audit log, not new tables.
- **Backend:**
  - CRUD with validation, per §3.3;
  - date-effective versioning for `PostingProfile` and `TaxCode`: refuse editing a row used by posted vouchers; create a successor with `valid_from`;
  - a resolution preview endpoint (given a posting type and context → account);
  - parameters as GET/PUT of the single row per legal-entity scope;
  - permissions `finance.setup.maintain`, `sales.setup.maintain`, `purchase.setup.maintain`, `inventory.setup.maintain`.
- **Frontend:** Setup pages under each module; readiness hub links.
- **Tests:**
  - editing a used TaxCode is refused and the successor row is used from `valid_from`;
  - **Bolivia anchor unchanged after a no-op save of IVA13/IT3**;
  - posting-profile overlap refused;
  - the provisioning script and the UI produce identical rows.
- **Depends on:** 047–051 (they add parameter fields; 053 builds the forms once). If 053 runs earlier, each item adds its own fields to the form.

### WORK-054 — Master data and operational UI gaps (M, frontend-heavy)

- **Defects:** DEF-111, 112, and the remaining UI_REQUIRED rows of §3.2.
- **P1 in this order:**
  1. customer create/edit/deactivate — **schema:** `customers.is_active boolean NOT NULL DEFAULT true`; search by code; code never reused, since `nextCustomerCode` stays MAX but deactivation replaces delete;
  2. tenant config (language, country, timezone) + wizard saves name and country;
  3. product-level barcode (tenant-scoped unique barcode on product and variant after a Step 0 duplicate check);
  4. PO cancel, partial receipt, invoice line edit, PO receipts list;
  5. quotation create and line edit, opportunity create, lead convert;
  6. trade agreements.
- **P2:** remaining §3.2 rows, customer segments and orders, inventory valuation report.
- **Also:** global `apiError` helper and a CI grep for the wrong envelope path; `onError` on every mutation; 404 on missing customer; `updateMany` no-op → 404.
- **Tests:** Playwright journeys (existing setup) — create customer → order → invoice; admin changes a role and the user sees the menu change; PO partial receive.
- **Depends on:** 052 (users), 053 (setup forms).

---

## 5. Questions that need Kubi

1. **Q1 — Single-person tenants and SoD.** I set every self-approval default to `DISALLOW_SUBMITTER`, per your instruction. A one-owner shop must switch it to ALLOW in Setup. Keep that default, or default to ALLOW and have the wizard ask?
2. **Q2 — TEST inventory reconciliation.** Stock × `cost_price` 234,650 against layers 40,277 against GL 5,397. With `uncosted_issue_policy = REFUSE`, TEST sales of stock without layers will be refused after WORK-044. Choose one:
   - (a) post OPENING journals at `cost_price` with a GL credit to an opening-balance account (Finance co-founder signs off the voucher);
   - (b) OPENING layers with no GL, keeping TEST's GL as is;
   - (c) wipe and re-seed TEST stock.
   My recommendation: (c) for TEST, and (a) as the product feature for real onboarding.
3. **Q3 — Historical POS AR (9,107 vs 130) on TEST.** Correct it with a Finance-approved journal after WORK-047, or leave TEST as is and only prove new behaviour? My recommendation: leave it, since TEST data is disposable.
4. **Q4 — Live FACTURA-consuming acceptance on TEST.** WORK-047, 048 and 049 cannot be fully proven without issuing and annulling at least one FACTURA on TEST. Approve a bounded number (for example, up to 3 numbers per item, recorded)?
5. **Validation items, not blocking, carried as parameters:**
   - V-2: SIN annulment of a voided POS factura and the annulment window;
   - V-3: credit-note series and CUF;
   - shrinkage IVA treatment;
   - NIT/authorization-code validation rules.

---

**Files to read first:**
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\inventory\inventory.service.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\sales\sales.service.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\sales\sales.routes.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\pos\pos.routes.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\pos\posStock.service.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\inventory\inventory.routes.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\inventory\inventory-count.routes.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\finance\finance.routes.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\auth\auth.routes.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\hr\hr.routes.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\setup\setup.routes.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\purchase\purchase.routes.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\purchase\vendorInvoice.service.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\modules\warehouse\warehouse.routes.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\infrastructure\database\provisionConfiguration.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\src\shared\middleware\errorHandler.ts`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\prisma\schema.prisma`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\backend\prisma\sql\000_baseline.sql`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\docs\process\CORE_ERP_COMPLETION_MATRIX.md`
- `C:\Users\Nieuw\Desktop\ClaUDE\wEBINAR\skarpine-rebuild\docs\process\WORK-030_O2C_PERMISSION_REGISTRY.md`
