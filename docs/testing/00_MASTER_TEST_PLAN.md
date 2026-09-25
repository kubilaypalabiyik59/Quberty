# Quberty ERP — Master Manual Test Plan

- **Basis:** branch `codex/rebuild-2026-09-07`, HEAD `905aeda` (2026-09-13). Written from code reading; nothing here has been executed yet.
- **Authors:** solution-architect agent (strategy, E2E, cross-cutting) + four area agents (detailed cases).
- **Detailed test lists:**
  - [01_SETUP_MASTER_DATA.md](01_SETUP_MASTER_DATA.md) — MD-xxx
  - [02_ORDER_TO_CASH.md](02_ORDER_TO_CASH.md) — O2C-xxx (CRM, quotations, sales orders, FACTURA, storefront, POS)
  - [03_SOURCE_TO_PAY_INVENTORY.md](03_SOURCE_TO_PAY_INVENTORY.md) — P2P-xxx / INV-xxx
  - [04_FINANCE_REPORTING.md](04_FINANCE_REPORTING.md) — FIN-xxx
- **Result log:** record Pass / Fail / Blocked per case ID, with date, tester, and for failures the amounts and screenshots.

**Size:** 9 end-to-end scenarios (§B) + 7 cross-cutting lists (§C) + 217 detailed cases (MD 46 · O2C 53 · P2P/INV 63 · FIN 55). Run order in §E-1.

**Area lists note:** the four detailed lists were written against the code, so many steps show both **Expected** and **Actual per code**. A case passes only when the business expectation is met; an "actual per code" that differs is a logged defect. Each list ends with its own "Suspected defects / gaps" and "Uncertain — needs confirmation" section — settle the uncertain items (tax regime, FACTURA `continuous` flag, server time zone, purchase parameters row) before execution.

**How to read "expected":** every expected result is what the process *should* do. Where the code today does something else, the case says **Suspected defect** with `file:line` — log it as a failure; never rewrite the expectation to match the bug. File references are relative to `backend/src/`.

---

## 0. Two premise corrections — read before testing tax or FX

### 0.1 Bolivian IVA is 13% of the invoiced amount (GROSS base), not 1,000 + 130

IVA13 is configured inclusive with `base_kind = GROSS` (`shared/services/tax.service.ts:199-202, 257`; Ley 843 art. 5/7/74 decision in `docs/process/BOLIVIA_TAX_BASIS.md` §4). IT 3% is also on the invoiced amount (`:266-268`).

| Factura total | IVA débito (13%) | Net revenue | IT (3%) |
|---:|---:|---:|---:|
| **1,130.00** | **146.90** | **983.10** | **33.90** |
| **1,299.00** (regression anchor, matrix §11) | **168.87** | **1,130.13** | **38.97** |
| 790.00 | 102.70 | 687.30 | 23.70 |

"Net 1,000 + IVA 130 = 1,130" is the Ley 1733 *IVA por fuera* model, not configured (validation item V-1). A tester who expects 1,000 + 130 will fail a correct system.

### 0.2 A USD supplier cannot run end to end today

A USD purchase order can be **created** (`modules/purchase/purchase.routes.ts:339`), but receipt, arrival journal, vendor invoice and vendor payment all refuse with 409 `*_FX_NOT_IMPLEMENTED` (foreign currency arrives with WORK-026). The USD scenario is a **fail-closed** test. Suspected defect: purchasing accepts a document that can never be received (sales refuses at creation, `sales.service.ts:83`).

---

## A. Test areas (test leads)

Roles: A admin · SM store_manager · CA cashier · EM employee · WW warehouse_worker · CU customer · PR purchasing_requester · BU buyer · RC receiver · AP ap_clerk · FA finance_approver · AU auditor. Catalog IDs `UNV-` are unverified placeholders (`CORE_ERP_COMPLETION_MATRIX.md` §8.0).

| ID | Area | Catalog IDs | Screens / routes | Risk — why | Roles | Detailed list |
|---|---|---|---|---|---|---|
| TA-01 | Auth & tenant | 99.25.070, 99.25.100 | `/login`, `/store/login`, `/store/register`, `/pos/login` | **High** — registration needs an explicit tenant; no self-promotion; refresh-token revocation still open | all | 01 |
| TA-02 | Setup wizard, organisation, numbering | 99.20.040 | `/setup/*`, `/setup/numbering` | **High** — FACTURA legally sequential; forward jump not visibly guarded | A, SM | 01 |
| TA-03 | Currency & exchange rates | UNV-90.60-E, 90.50.040 | `/setup/finance/currencies`, `/finance/exchange-rates` | **High** — refusal must precede any number/stock/voucher | A, SM, FA, BU, AP | 01, 04 |
| TA-04 | Tax (IVA 13% GROSS, IT 3%) | 75.50.020, UNV-65.30-A | `/setup/finance`, `/finance/iva-report` | **High** — legal; IT never on purchases | A, SM | 02, 04 |
| TA-05 | Product, UoM, variants, item groups | 40.x (UNV) | `/products/*` | **Medium** — variant is the stocking unit; UoM routes unguarded | A, SM | 01 |
| TA-06 | Customers | UNV-65.20-A | `/sales/customers` | **Medium** — NIT reaches factura; code race → 500 | A, SM, CA, EM | 01 |
| TA-07 | Suppliers | 75.30 (UNV) | `/purchase/suppliers` | **Medium** — currency/tax group drive purchases | A, SM, BU | 01 |
| TA-08 | HR, users, roles | 99.25.110 | `/hr`, `/hr/payroll` | **High** — SM must not create an admin | A, SM | 01 |
| TA-09 | CRM | 85 (UNV) | `/crm/*` | **Low** | A, SM, EM | 02 |
| TA-10 | Quotations | 85 (UNV) | `/sales/quotations` | **Medium** — confirm creates customer + SO; list writes | A, SM, EM, AU | 02 |
| TA-11 | Sales orders | UNV-65.20-A, UNV-60.40 | `/sales/orders` | **High** — FIFO consumption not warehouse-scoped; ship non-atomic | A, SM, CA, EM | 02 |
| TA-12 | FACTURA | UNV-65.30-A | `/finance/facturas` | **High** — manual factura posts no journal; cancel reverses nothing | A, SM | 02, 04 |
| TA-13 | Customer payments & returns | UNV-65.30-C/E | order detail | **High** — full payment only; free-text bank account | A, SM | 02 |
| TA-14 | Storefront | UNV-65.20 | `/shop`, `/cart`, `/checkout`, `/account` | **High** — D-15 client prices; possible double deduction | CU | 02 |
| TA-15 | Web POS | UNV-65.20-B | `/pos/*` | **High** — FACTURA per sale; AR not cash; Z report counts card as cash | CA, SM | 02 |
| TA-16 | Requisitions & RFQ | 75.40.010, 75.40.030 | `/procurement/*` | **Medium** | PR, BU, SM | 03 |
| TA-17 | Purchase orders | 75.40.030, 75.40.050 | `/purchase/orders` | **Medium** | BU, SM | 03 |
| TA-18 | Receipts & arrival | 60.30.010 | `/purchase/receipts`, `/warehouse/arrival` | **High** — stock, cost layer, accrual | RC, WW, SM | 03 |
| TA-19 | Warehouse waves, work, locations | 60.30.030, UNV-60.40-B | `/warehouse/*` | **Medium** — work complete unguarded | WW, SM, CA | 03 |
| TA-20 | Vendor invoices & matching | 75.50.020 | `/purchase/invoices` | **High** — tolerance, discrepancy approval | AP, FA, SM | 03 |
| TA-21 | Vendor payments, returns, credits | 75.50.090/110, 75.40.070, 75.50.080 | `/purchase/payments`, `/returns`, `/credits` | **High** — settlement, reversal | AP, FA, RC, BU | 03 |
| TA-22 | Inventory stock, transfers, counting, costing | UNV-60.20 | `/inventory/*` | **High** — count/adjust post no journal; FIFO vs GL vs cost_price diverge | SM, A | 03 |
| TA-23 | GL journals, periods, COA | 90.50.040, UNV-90.60-B | `/finance/journal`, `/periods`, `/accounts` | **High** — draft post skips closed-period check | A, SM | 04 |
| TA-24 | Bank reconciliation | UNV-90.60-A | `/finance/bank-reconciliation` | **Medium** — fixed to 1101 Caja; receipts go to 1102 | A, SM | 04 |
| TA-25 | Aging AR/AP | UNV-65.30-D | `/finance/aging` | **Medium** — AP reads PO `paid_at` | A, SM, AU | 04 |
| TA-26 | IVA report | UNV-65.30-A | `/finance/iva-report` | **High** — factura report vs GL diverge (§C-4) | A, SM | 04 |
| TA-27 | P&L, balance sheet, trial balance | UNV-90.60-D | `/finance/p-and-l`, `/balance-sheet` | **Medium** — all-time earnings; no TB date filter | A, SM, AU | 04 |
| TA-28 | Dashboards & reports | 65.60/90.70 (UNV) | `/dashboard`, `/reports/*` | **Low/Med** — inherit POS AR and COGS defects | A, SM, CA | 04 |
| TA-29 | Import | 99.55 (UNV) | `/import` | **Medium** — bulk writes; execute admin-only | A, SM | 01 |
| TA-30 | Audit log | 99.25.050 | `/audit` | **Medium** — auditor cannot read it | A, AU | 01 |
| TA-31 | Security & SoD | 99.25.050/060 | all | **High** — finance/inventory/warehouse/setup still unguarded (030b/c) | all 12 | §C-1 |
| TA-32 | Multi-tenancy | 99.25.050 | all | **High** — one tenant on TEST; adjust/transfer skip location tenant check | A of X and Y | §C-2 |
| TA-33 | Parametric currency | UNV-90.60-E | all money renders | **Medium** — browser pass and TRY render not done | A, CA of TRY tenant | §C-5 |

---

## B. End-to-end business scenarios

Anchor business "Calzados Illimani": stores La Paz (WH-LPZ), El Alto (WH-EAL), Cochabamba (WH-CBB). Boot `BOTA-CUERO` sizes 38–44, price Bs 565, `cost_price` Bs 300. Sneaker `ZAP-URB` Bs 790. Accounts named by posting type (codes come from posting profiles).

**After every scenario:** every voucher balances; FACTURA `next_number` = before + facturas issued; no journal line of another tenant.

### B-1 Order to cash: lead → opportunity → quotation → order → ship → invoice → payment

| # | Role | Screen | Action | Expected |
|---|---|---|---|---|
| 1 | SM | `/crm/leads` | Create lead "Colegio San Andrés — 2 pairs of boots" | LD-… number; no journal, no factura |
| 2 | SM | lead detail | Qualify → opportunity | OPP-…; lead link kept |
| 3 | SM | `/sales/quotations` | 2 × BOTA-CUERO size 40 @ 565 = 1,130 | IVA **146.90**, net **983.10**, total 1,130 |
| 4 | SM | quotation | Send → Confirm | SO-… DRAFT; chain Lead → OPP → QT → SO; customer created if the lead had none |
| 5 | EM | `/sales/orders/[id]` | Confirm | **403** |
| 6 | SM | order | Confirm (WH-LPZ) | CONFIRMED; 2 reserved in WH-LPZ only; order on a wave |
| 7 | WW | `/warehouse/work` | Complete pick work | COMPLETED. Also: cashier calling `POST /warehouse/work/:id/complete` succeeds today → **suspected defect** (030b) |
| 8 | SM | order | Ship | SHIPPED; `SHP-<epoch>`; COGS voucher |
| 9 | SM | order | Invoice (customer NIT) | FACTURA N consumed; `invoiced_qty` = 2 |
| 10 | SM | order | Invoice again | **409**; FACTURA unchanged |
| 11 | SM | order | Pay (account 1102) | `paid_at` set; receipt voucher |
| 12 | CA | order | Pay | **403** |

**Ledger** (`sales.service.ts:276-289`, `sales.routes.ts:387-405, 457-469`):

| Voucher | Dr | Cr |
|---|---|---|
| SALES_COGS | COGS 600.00 | INVENTORY 600.00 |
| SALES_INVOICE | AR 1,130.00; TAX_TURNOVER_EXPENSE 33.90 | REVENUE 983.10; VAT_OUTPUT 146.90; TAX_TURNOVER_PAYABLE 33.90 |
| SALES_PAYMENT | Bank 1102 1,130.00 | AR 1,130.00 |

Stock: WH-LPZ −2, reserved −2. **Suspected defects:** (1) COGS at `cost_price`, not FIFO layer (`sales.service.ts:243,258`, WORK-031); (2) **FIFO consumption ignores the order's warehouse** (`inventory.service.ts:175-183`) — give EAL the oldest layer, ship from LPZ, check which store lost stock; (3) OUTBOUND records sales price as `unit_cost` (`inventory.service.ts:229`); (4) ship/COGS/shipment non-atomic; (5) payment accepts a revenue account code (`sales.routes.ts:432-444`).

**Storefront sub-case:** storefront order deducts stock immediately, CONFIRMED, no reservation (`sales.routes.ts:123-175`); shipping it may deduct again → **suspected double deduction**; tampered `unit_price: 1` accepted (D-15).

### B-2 Source to pay: requisition → RFQ → PO → receipt → invoice → payment

| # | Role | Screen | Action | Expected |
|---|---|---|---|---|
| 1 | PR | `/procurement/requisitions` | New: WH-CBB, 10 × ZAP-URB 41 → submit | PR-… submitted |
| 2 | PR | requisition | Approve | **403** |
| 3 | BU | requisition | Approve → RFQ to S1, S2 | RFQ-… sent |
| 4 | BU | `/procurement/rfq/[id]` | Bids S1 339, S2 350; award S1 | PO-… from RFQ; S2 rejected |
| 5 | BU | `/purchase/orders` | Confirm | CONFIRMED; direct line edit refused |
| 6 | AP | PO | Post receipt | **403** |
| 7 | RC | `/purchase/receipts` | Receive 10 | receipt number; putaway work created |
| 8 | WW | `/warehouse/work` | Complete putaway | stock at directed location |
| 9 | AP | `/purchase/invoices` | Invoice 10 @ **345** with supplier factura no./date; match | +1.77% ≤ 2% → matched |
| 10 | AP | invoice | Post | posted |
| 11 | AP | `/purchase/payments` | Create 3,450 → post | created; post **403** |
| 12 | FA | payment | Post & settle | invoice closed |
| 13 | FA | payment | Reverse; reverse again | mirror voucher; balance restored; 2nd refused |

Receipt money: gross 3,390 → IVA crédito 440.70 → net 2,949.30 → layer 10 @ 294.93 (`productReceipt.service.ts:333,348`).

| Voucher | Dr | Cr |
|---|---|---|
| PRODUCT_RECEIPT | INVENTORY 2,949.30 | PURCHASE_ACCRUAL 2,949.30 |
| VENDOR_INVOICE @345 | PURCHASE_ACCRUAL 2,949.30; VAT_INPUT 448.50; PRICE_VARIANCE 52.20 | AP 3,450.00 |
| VENDOR_PAYMENT | AP 3,450.00 | payment-method offset 3,450.00 |

Accrual nets to 0, AP to 0; **no IT anywhere**. Variants: invoice @346 (+2.06%) → discrepancy, AP post refused until FA approves; partial payments 1,450 + 2,000 → closes on the second. V-4: gross vs net unit cost entry.

### B-3 POS store day ⚠️ consumes FACTURA numbers — Kubi approval required

| # | Role | Screen | Action | Expected |
|---|---|---|---|---|
| 1 | CA | `/pos/open-register` | Open LPZ-1, WH-LPZ, float 500 | session OPEN with warehouse |
| 2 | CA | same | Open LPZ-1 again | **409** |
| 3 | CA | `/pos/main` | 2 × BOTA = 1,130, CASH, tendered 1,200 | FACTURA N; change 70; IVA 146.90 / IT 33.90 |
| 4 | CA | `/pos/main` | 1 × ZAP-URB 790, CARD | FACTURA N+1; IVA 102.70; net 687.30; IT 23.70 |
| 5 | CA | `/pos/main` | Variant with 0 stock in LPZ (stock in EAL) | 422 insufficient in register's warehouse; FACTURA unchanged |
| 6 | CA | receipt | Void sale 3 | **403** |
| 7 | SM | `/pos/main` | Void sale 3 same day | VOIDED; stock restored |
| 8 | CA | `/pos/z-report` | Close, counted cash 500 | see below |

Per-sale vouchers (`pos.routes.ts:353-395`): Dr AR 1,130 / TAX_TURNOVER_EXPENSE 33.90; Cr REVENUE 983.10 / VAT_OUTPUT 146.90 / TAX_TURNOVER_PAYABLE 33.90; COGS 600/INVENTORY 600; void mirrors revenue, VAT and COGS.

| Check | Code today | Correct | Status |
|---|---|---|---|
| Sale debit | AR (`:364`) | Cash / card clearing | Suspected defect (WORK-033) — AR keeps 790 with no document |
| IT on void | not reversed (`:496-515`) | reversed | Suspected defect |
| FACTURA on void | stays ISSUED | annulled per SIN (V-2) | Suspected defect — IVA report keeps 146.90 |
| Session totals on void | latest OPEN session of tenant (`:538-541`) | the sale's session | Suspected defect |
| Void journal failure | swallowed (`:533-535`) | fail closed | Suspected defect |
| Z report expected cash | float + all tenders (`:120-121`) → 1,290; over/short −790 | cash only → 500; 0 ([D365 shift & drawer](https://learn.microsoft.com/dynamics365/commerce/shift-drawer-management)) | Suspected defect |
| Void cut-off | server local date | tenant time zone | test near midnight Bolivia |

### B-4 Customer return & credit note ⚠️ consumes a FACTURA number

1. SM → paid order from B-1 → Return "wrong size" → RETURNED; credit note in FACTURA series −983.10 / −146.90 / −33.90 / −1,130.
2. Ledger (`sales.routes.ts:745-802`): reverse invoice (Dr REVENUE 983.10, VAT_OUTPUT 146.90, TAX_TURNOVER_PAYABLE 33.90 / Cr AR 1,130, TAX_TURNOVER_EXPENSE 33.90); reverse COGS at today's `cost_price`; refund Dr AR 1,130 / Cr BANK 1,130.
3. Return again → 409. EM → 403.

Suspected defects: stock back to first location row by id; RETURN `unit_cost` = sales price (`:712`); no cost layer recreated; COGS at today's cost (`:769-771`); **SHIPPED-not-invoiced order returned still gets a negative credit-note FACTURA** (`:684, :720, :744`) — test explicitly; refund always BANK; whole-order only. V-3: credit-note series & CUF.

### B-5 Supplier return & credit

| # | Role | Action | Expected |
|---|---|---|---|
| 1 | BU | `/purchase/returns` create from invoice + receipt, 1 × ZAP-URB | return number; picked from lists |
| 2 | RC | Ship return | stock −1; layer −1; Dr PURCHASE_ACCRUAL 294.93 / Cr INVENTORY 294.93 |
| 3 | AP | `/purchase/credits` create with supplier ref → post | created; post **403** |
| 4 | FA | Post credit | Dr AP 339 / Cr PURCHASE_ACCRUAL 294.93, VAT_INPUT 44.07; invoice balance 3,051 |

Negative: no supplier ref; return qty > received; USD invoice → 409 `RETURN_FX_NOT_IMPLEMENTED`.

### B-6 Store transfer & cycle count

1. SM `/inventory/transfers`: 5 × BOTA 42 LPZ → CBB → LPZ −5, CBB +5, layers move at original cost; TRANSFER_OUT/IN; **no journal, no number**.
2. Transfer more than available → refused. CA / WW → 403.
3. Cross-tenant `to_location_id` → **suspected accepted** (030b; two-tenant setup only).
4. `/inventory/counting` WH-CBB: count 4 vs system 5 → finalize → stock overwritten to 4; **no journal, no layer change** → suspected defect (WORK-032).
5. Edit line after FINALIZED → refused; EM edit → 403.
6. Record: Σ stock CBB vs Σ layers CBB (differs by 1), GL unchanged.

### B-7 Month-end close

| # | Role | Action | Expected |
|---|---|---|---|
| 1 | SM | Draft JE in month M (Dr expense / Cr 1101 Caja 100) | DRAFT |
| 2 | SM | Post | **403** |
| 3 | A | IVA report M vs IVA net (GL) M | Should tie; after B-3/B-4 it won't — record each difference by cause |
| 4 | A | Close M | CLOSED |
| 5 | SM | New draft dated in M | 400 `PERIOD_CLOSED` |
| 6 | A | Post the step-1 draft | Expected `PERIOD_CLOSED`; code posts it (`finance.routes.ts:249-256`) → **suspected defect D-14** |
| 7 | A | POS sale / invoice while current month closed | 400 `PERIOD_CLOSED`; FACTURA not consumed |
| 8 | A | Reopen M, close again | works; `closed_by/closed_at` erased (`:791`) → suspected D-12 |
| 9 | SM | Close M | 403 |
| 10 | A | P&L M; balance sheet end M | revenue = Σ REVENUE credits M; `is_balanced = true`; earnings all-time (known) |
| 11 | A | Bank reconciliation M | reads 1101 Caja; B-1 receipt on 1102 missing → suspected defect |
| 12 | A | Aging | AR: B-1 absent; AP: vendor-payment-paid invoices still open (known) |

Time-zone probe: post at 20:30 last day of month Bolivia time (UTC−4); if server runs UTC the voucher lands in M+1 (`journal.service.ts:247-248`). V-6.

### B-8 USD supplier PO (fail-closed)

| # | Role | Action | Expected |
|---|---|---|---|
| 1 | A | Activate USD | active |
| 2 | FA | BCB USD→BOB 6.96 today; edit existing rate | created; edit 403 |
| 3 | BU | Supplier "Importadora Lima" USD | saved |
| 4 | BU | PO 100 pairs @ USD 10 | created in USD; no rate stored; domestic IVA shown → V-5 |
| 5 | RC | Receive | 409 `RECEIPT_FX_NOT_IMPLEMENTED`; nothing written |
| 6 | SM | Arrival journal post | 409 same |
| 7 | AP | Vendor invoice post | 409 `VENDOR_INVOICE_FX_NOT_IMPLEMENTED` |
| 8 | AP | Payment USD | 409 `VENDOR_PAYMENT_FX_NOT_IMPLEMENTED` |
| 9 | BU | Cancel PO | cancelled |
| 10 | SM | Sales order in USD | 409 `SALES_FX_NOT_IMPLEMENTED` |

Integrity: JE count, receipt sequence, stock, layers unchanged across 5–8.

### B-9 Two-store contention day

1. LPZ-1 and EAL-1 open; same variant 1 unit in each; both sell simultaneously → both succeed.
2. Third attempt in LPZ → 422.
3. SM voids LPZ sale → check whether EAL-1 `total_sales` dropped (B-3 defect).
4. Ship ERP order from LPZ while EAL holds older layer (B-1 defect 2).

---

## C. Cross-cutting test lists

### C-1 Role / SoD matrix (`shared/middleware/permissions.ts:107-223`)

Every 403 row: confirm no FACTURA consumed and no row written.

| Role | Must work | Must be refused (403) | SoD note |
|---|---|---|---|
| admin | everything | — | only admin: journal post, period close/reopen, factura cancel, SO cancel, number sequences, finance setup, audit |
| store_manager | all sales incl. invoice/pay/return; quotations; CRM (no stage setup); POS incl. void; requisition create+approve; PO; receipt post; vendor invoice create/match/post; RFQ; suppliers; FX rate add; journal draft; manual factura; transfers/adjust/count; import | SO cancel, vendor payments, approve discrepancy, supplier credit post, journal post, period close, finance setup, HR role change, number sequences, audit | receives **and** posts vendor invoice; requests **and** approves requisitions; voids own sales — documented override ([SoD](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/sysadmin/set-up-segregation-duties)) |
| cashier | tenant currency; POS open/close/sale; customer read/create; product read | void, SO screens, quotations, CRM, invoice, pay, tenant config | unguarded finance GETs and `/warehouse/work/:id/complete`, UoM create return 200 today → residual 030b/c |
| employee | reads of SO, quotations, customers, leads, opps, products; requisition create/submit/cancel | any sales/CRM/customer write; POS; approve requisition | same unguarded GETs; quotation list writes |
| warehouse_worker | PO read, receipt read/post, product read | everything else incl. transfers, count lines | cannot count — confirm intent |
| customer | 5 storefront routes | everything else; unpublished products & `cost_price` hidden | D-15 price tampering accepted |
| purchasing_requester | requisition read/create/submit/cancel; product read | approve, RFQ, PO, O2C | — |
| buyer | suppliers, requisition approve, RFQ, PO incl. cancel, return create, purchase setup | receipt post, vendor invoice, payment, return ship, FX rate add | buyer maintains payment methods — confirm |
| receiver | PO read, receipt post, return ship | invoice, payment, PO create | clean |
| ap_clerk | vendor invoice create/match/post, payment create, credit create | payment post/settle/reverse, approve discrepancy, credit post, receipt | clean |
| finance_approver | approve discrepancy, invoice post/cancel, payment post/settle/reverse, credit post, FX rate add | payment create, invoice create, receipt, PO | clean |
| auditor | all purchasing & O2C reads, tenant & currency read | any write; POS | **cannot open `/audit`** → suspected gap |

Escalation: SM `POST /hr/employees` role admin → refused; SM `PUT /hr/users/:id/role` → 403; role `constructor`/`superuser` → refused; `/auth/make-admin` → 404; register without tenant → 400.

### C-2 Multi-tenancy (needs second tenant)

1. X token + Y tenant header → refused.
2. X `GET /sales/orders/:yId` → 404; `/complete`, `/invoice` → 404; Y FACTURA unchanged.
3. X order with Y customer/product/variant id → refused.
4. X POS session with Y warehouse → 422 `FOREIGN_REFERENCE`.
5. X `PUT /purchase/suppliers/:id` with body `tenant_id` Y → ignored.
6. X `POST /inventory/adjust` or `/transfers` with Y location → expected refused, **suspected accepted** (030b).
7. Both tenants issue SO/PO/JE/FACTURA; same numbers allowed, never collide.
8. X reports (TB, IVA, P&L, aging, dashboard) contain zero Y amounts.
9. Storefront register with Y slug → Y customer only.

### C-3 Number-sequence continuity (FACTURA)

1. Record `next_number` before/after every scenario; delta = facturas created (invoice, POS sale, credit note, manual factura).
2. No gap on failure: POS stock refusal, invoice in closed period, unresolved posting profile (with approval), USD order → unchanged.
3. No duplicate under concurrency: two tills submit together → consecutive; double-click Invoice → one 409.
4. Manual-mode series: no number → refused; switching to automatic behind highest → `NUMBER_SEQUENCE_BEHIND`.
5. **Forward jump:** admin sets `next_number` = highest + 10 → appears accepted (`setup.routes.ts:553-556`) → legal gap → suspected defect.
6. Void frees nothing; credit notes share the series (V-3).
7. Non-legal series: SO gaps allowed; `SHP-<epoch>`; `CNT-count()+1` race → record (fail only the count race).

### C-4 IVA report vs GL traps

| Action | Factura IVA report | GL VAT_OUTPUT | Code |
|---|---|---|---|
| Manual factura (any date, even closed month) | +IVA | no change | `finance.routes.ts:314-369` |
| Factura cancel | −IVA | no change, no reason | `:449-455` |
| POS void | unchanged | −IVA | `pos.routes.ts:451-535` |
| Return on uninvoiced order | negative IVA | no change | `sales.routes.ts:684,720,744` |

Expectation is "IVA report ties to GL"; each row is recorded as a failure with its amount.

### C-5 Parametric currency (TRY stand-in tenant)

1. Tenant `country=TR`, accounting currency TRY (operator CLI, approval).
2. Turkish COA template; KDV NET exclusive.
3. All ERP/POS/storefront money shows TRY; no `Bs.`, `es-BO`, `BOB`; POS cart total = server tax preview.
4. TRY invoice net 1,000 → total 1,200, no IT; GL AR 1,200 / revenue 1,000 / VAT 200.
5. TRY tenant using BOB → `CURRENCY_INACTIVE` or `*_FX_NOT_IMPLEMENTED`.
6. Bolivia still produces §0.1 figures on the same build.
7. Site without country → refused.
8. Bolivia renders `Bs. 1.299,50`; tenant with no currency shows the blocking banner, POS payment disabled.

### C-6 Negative & validation minimum set

- SO with no lines / qty 0 / negative price / discount > 100% → refused (last two unverified).
- Confirm with stock only in another warehouse → refused.
- Invoice DRAFT order → 400; invoice before ship with `deduction_requirements` → 409 `DEDUCTION_REQUIRED`; ship before pick with `picking_requirements` → 409 `PICKING_REQUIRED`.
- Pay uninvoiced → 400; pay twice → 409; unknown account → 400; **revenue account → accepted (suspected)**.
- POS: no session; closed session; session without warehouse → 422 `POS_SESSION_WAREHOUSE_REQUIRED`; void next day → 400; void non-POS order → 404.
- Item group change after transactions → 409, force → WARN log.
- Receipt qty > open; invoice qty > received; edit confirmed PO → refused.
- Unbalanced journal → refused; draft into closed period → `PERIOD_CLOSED`.
- Duplicate / negative exchange rate → refused (unverified).
- Storefront `unit_price` 0.01 and unpublished product → **accepted today (D-15)**; qty > stock → 400.
- Malformed import CSV → errors, no partial execute.

### C-7 Data-integrity checks after each scenario (read-only SQL by main session)

1. POSTED JE: Σ Dr = Σ Cr; line tenant = entry tenant.
2. Every factura has a voucher (except §C-4 traps) and a date in an open period at creation.
3. Stock per (warehouse, variant) = Σ transactions; stock ≥ reserved ≥ 0.
4. Σ layers × cost vs GL INVENTORY vs stock × `cost_price`, per store — report delta, don't fail (WORK-031/032).
5. AR GL vs Σ invoiced − Σ paid (POS inflates, WORK-033).
6. AP GL = Σ open vendor transactions; accrual GL = received-not-invoiced at net.
7. VAT_OUTPUT month vs factura IVA report; VAT_INPUT vs posted vendor invoice tax.
8. Session `total_sales` = Σ non-voided POS orders of that session.
9. FACTURA: no gaps, no duplicates; `next_number` = max + 1.
10. Audit log has every write, including refused ones.

---

## D. Test data prerequisites on TEST

Known state (2026-09-13): 1 tenant; users admin 1, store_manager 3, employee 3, customer 3; **no cashier, warehouse_worker, purchasing_requester, buyer, receiver, ap_clerk, finance_approver, auditor**. FACTURA `next_number` was 35 — re-read before starting.

| # | Prerequisite | Owner / note |
|---|---|---|
| D-1 | One user per missing role (8) via `/hr` by admin; passwords outside the repo | Kubi approval (DB write) |
| D-2 | Three BO store sites/warehouses LPZ, EAL, CBB with zones, locations, putaway directives | Setup; TEST has 2 BO + 2 TR sites |
| D-3 | BOTA-CUERO & ZAP-URB sizes 38–44; one service item; STOCKED-FIFO model group; FOOTWEAR item group; `cost_price`; known layer per store, **oldest layer in EAL** | Setup |
| D-4 | Customer with NIT (tax group DOM); "Cliente Mostrador" | Setup |
| D-5 | Suppliers S1, S2 (BOB, DOM); "Importadora Lima" (USD) | Setup |
| D-6 | USD active; BCB rate type; today's USD→BOB rate | A / FA |
| D-7 | Current month OPEN; a previous month closeable; `allow_posting_to_closed_period = false` | Admin; agree a window |
| D-8 | Posting profiles resolve; balanced posting on; split purchase flow; three-way match; 2% tolerance | verify only |
| D-9 | Vendor payment methods with offset accounts | Setup |
| D-10 | Close & reopen the existing register session against a warehouse | Kubi (else every sale 422) |
| D-11 | `NEXT_PUBLIC_STOREFRONT_TENANT_SLUG` set in frontend env | Kubi |
| D-12 | Second tenant (TRY stand-in, `country=TR`) via `backend/scripts/createTenant.ts` | Kubi approval; permanent |
| D-13 | IVA13 & IT3 rows confirmed `base_kind = GROSS` | Main session read |

**FACTURA rule:** every POS sale, ERP invoice, credit note or manual factura consumes a real, non-returnable number. Each run that issues facturas needs Kubi's explicit approval stating the expected count (B-1: 1; B-3: 2; B-4: 1–2; C-3 concurrency: 2). Record `next_number` before/after. Never delete a factura to "clean up". Look-only POS passes stop before Submit.

---

## E. Execution order, exit criteria, risks

### E-1 Order

1. **Smoke (automated):** backend `tsc` + Jest; frontend `tsc` + `next build`; TEST harnesses `verify:o2c-permissions`, `verify:o2c-containment`, `verify:tenant-numbering`, `verifyPutaway.ts` (`verifyProcessChain.ts` writes — approval only); log in as every role.
2. **Setup & master data:** 01 list, D-1…D-13.
3. **Security:** C-1 then C-2.
4. **Single processes:** 02, 03, 04 lists.
5. **End to end:** B-2 → B-1 → B-5 → B-6 → B-4 → B-3 → B-9 → B-8.
6. **Month end:** B-7, C-4, C-7.
7. **Parametric:** C-5, then Bolivia regression of §0.1.

### E-2 Exit criteria

- 100% of C-1 refusals → 403 with no side effect; no cross-tenant read/write except listed 030b/c residuals.
- Bolivia anchors exact on invoice, POS and credit note; no IT on purchases.
- FACTURA: zero gaps/duplicates including injected failures.
- Every voucher balances; B-2 accrual nets 0; B-1 AR nets 0.
- All fail-closed cases refuse before any number, stock or voucher.
- Every suspected defect reproduced (with amounts, file:line) or disproved — never relabelled "expected".
- A failure on a High area in steps 1–3 stops the run.

**Recommendation:** with the B-3 Z-report/void defects and C-4 IVA divergence, the build should **not** be declared ready for a real store day, whatever else passes.

### E-3 Known residual risks

D-15 storefront integrity · quotation list write-on-read · POS debits AR (WORK-033) · FIFO/GL/`cost_price` divergence, count/adjust post no journal (WORK-031/032) · journal post skips closed period (D-14), reopen erases history (D-12), no year-end close · AP aging reads PO `paid_at`, AR full-payment only (WORK-034) · whole-order ship/invoice/return; shipment & count numbering bypass allocator (WORK-036/037) · 030b/030c unguarded routes; adjust/transfer skip tenant location check · browser pass & TRY render pending · Expo POS out of scope · header-level tax only (WORK-041) · catalog IDs unverified.

### E-4 New suspected defects found while writing the plan

1. `inventory.service.ts:175-183` — FIFO consumption at ship ignores the order's warehouse.
2. `pos.routes.ts:120` — Z-report expected cash includes card/transfer.
3. `pos.routes.ts:538-541` — void decrements tenant's latest open session.
4. `pos.routes.ts:451-535` — void leaves factura ISSUED, keeps IT, swallows journal errors.
5. `sales.routes.ts:684,720` — return on uninvoiced order issues a credit-note FACTURA.
6. `finance.routes.ts:314-369, 449-455` — manual factura posts no journal, any date; cancel no reversal/reason.
7. `finance.routes.ts:812` — bank rec fixed to 1101; `sales.routes.ts:432` — free-text payment account default 1102.
8. `sales.routes.ts:123-175` — storefront deducts without transaction, possibly again at ship.
9. `purchase.routes.ts:339` — USD PO creatable but never receivable.
10. `setup.routes.ts:553` — FACTURA forward jump unguarded.
11. auditor cannot read audit log.

### E-5 Validation items (Kubi / Finance co-founder / Bolivian accountant)

- V-1 Ley 1733 decree status (GROSS vs NET IVA).
- V-2 annulment of a voided POS factura under SIN.
- V-3 credit-note series and CUF reference.
- V-4 purchase unit cost entered gross or net.
- V-5 IVA on foreign purchases (DUI vs supplier factura).
- V-6 server time zone vs Bolivia UTC−4 for period and void cut-offs.
