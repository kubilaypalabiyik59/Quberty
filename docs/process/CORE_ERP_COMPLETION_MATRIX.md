# Core ERP completion matrix

**Catalog version:** JUL-2026
**Assessment date:** 2026-09-10 (purchasing, §1–§6); 2026-09-11 (O2C, inventory, R2R, §7–§12)
**Status:** Living implementation matrix; WORK-019 accepted locally and on Supabase TEST;
WORK-028 extension merged 2026-09-11 with WORK-029 and the 2026-09-11 decisions applied
**Scope:** `75.40 Procure goods and services` -> `60.30 Process inbound goods` ->
`75.50 Manage accounts payable`, with only directly relevant `90.50`, `99.20`, and `99.25`
processes (§1–§6); `65.20`, `65.30`, `65.50`, `60.20`, `60.40`, `90.60`, and `90.70` (§7–§12).

This is the first bounded slice of the completion matrix required by
[CORE_ERP_PROCESS_CATALOG.md](CORE_ERP_PROCESS_CATALOG.md). It evaluates Skarpine's approved SME
scenario, not the full Dynamics 365 feature surface. `VERIFIED` therefore means that the selected
scenario has execution evidence; it does not mean every Microsoft scenario under that process is
implemented.

## 1. Evidence boundaries

- **[OFFICIAL]** Microsoft Learn confirms the six catalog levels and their intended use:
  <https://learn.microsoft.com/dynamics365/guidance/business-processes/about-catalog-levels>.
- **[WORKBOOK-VERIFIED]** IDs, Microsoft IDs, titles, parentage, and product tags below come from
  the read-only `Business Process Catalog JUL 2026.xlsx` supplied for this workstream.
- **[OFFICIAL]** Source to pay excludes goods receipt; receipt belongs to Inventory to deliver:
  <https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-introduction>.
- **[OFFICIAL]** Product-receipt quantity is part of three-way invoice matching:
  <https://learn.microsoft.com/dynamics365/finance/accounts-payable/three-way-matching-policies>.
- **[REPO-VERIFIED]** Repository evidence was re-read at
  `d32af1d80169ce7c368aff9ee28e50e10cdc4ce8`. No test, build, database, or browser command was run
  for this analysis. Historical execution evidence is dated explicitly.
- **[ARCHITECTURAL RECOMMENDATION]** The operational purchasing dependency is
  `75.40 -> 60.30 -> 75.50`. The numeric catalog hierarchy groups capabilities; it is not a runtime
  sequence diagram.

The earlier narrative status is useful historical evidence but is stale in one material respect:
[S2P_O2C_STATUS.md:103](S2P_O2C_STATUS.md#L103) says IT is evaluated on purchases. Current code passes
`side = PURCHASE` into the tax resolver and filters `TaxCode.applies_to`, so that defect was closed
after the status document was written
([documentTax.service.ts:170](../../backend/src/shared/services/documentTax.service.ts#L170),
[schema.prisma:2546](../../backend/prisma/schema.prisma#L2546)). IT remains sales-only.

## 2. Source mapping

Product tags use `BC` = Business Central, `FS` = Field Service, `FIN` = Finance, and `SCM` = Supply
Chain Management. Every row is level 3 (`Process`); `parent_id` is its level-2 process area.

| catalog_id | microsoft_id | parent_id | title | product_tags |
|---|---|---|---|---|
| 75.40.010.000 | d6689987c6751v0 | 75.40 | Raise purchase requisitions | BC, FS, FIN, SCM |
| 75.40.030.000 | d6689987c6767v0 | 75.40 | Issue purchase orders | BC, FS, FIN, SCM |
| 75.40.050.000 | d6689987c6795v0 | 75.40 | Manage open purchases | BC, FS, FIN, SCM |
| 75.40.060.000 | d6689987c6826v0 | 75.40 | Issue blanket purchase orders | BC, SCM |
| 75.40.070.000 | d6689987c6839v0 | 75.40 | Return goods to suppliers | BC, FS, SCM |
| 75.40.080.000 | d6689987c6859v0 | 75.40 | Consolidate requisitions | SCM |
| 75.40.100.000 | d6689987c6872v0 | 75.40 | Analyze supply purchase plan | BC, SCM |
| 60.30.010.000 | d6689987c4384v0 | 60.30 | Receive goods | BC, FS, FIN, SCM |
| 60.30.020.000 | d6689987c4407v0 | 60.30 | Label received goods | BC, FS, FIN, SCM |
| 60.30.030.000 | d6689987c4425v0 | 60.30 | Put away received goods | BC, FS, FIN, SCM |
| 60.30.040.000 | d6689987c4442v0 | 60.30 | Cross dock received goods to outbound orders | BC, FS, FIN, SCM |
| 60.30.060.000 | d6689987c4460v0 | 60.30 | Quarantine received goods | SCM |
| 75.50.020.000 | d6689987c6890v0 | 75.50 | Process supplier invoices | BC, FIN |
| 75.50.070.000 | d6689987c6913v0 | 75.50 | Dispute invoices | SCM |
| 75.50.080.000 | d6689987c6927v0 | 75.50 | Receive supplier credits | BC, SCM |
| 75.50.090.000 | d6689987c6944v0 | 75.50 | Issue and settle supplier payments | BC, FS, FIN, SCM |
| 75.50.100.000 | d6689987c6974v0 | 75.50 | Manage promissory notes | BC, FIN |
| 75.50.110.000 | d6689987c6993v0 | 75.50 | Cancel supplier payments | BC, FIN |
| 75.50.120.000 | d6689987c7010v0 | 75.50 | Correct supplier payments | BC, FIN |
| 75.50.130.000 | d6689987c7023v0 | 75.50 | Process supplier rebates and incentives | BC, SCM |
| 90.50.040.000 | d6689987c8694v0 | 90.50 | Record ledger entries | BC, FS, FIN, SCM |
| 99.20.040.000 | d6689987c10760v0 | 99.20 | Configure and monitor system generated numbers | BC, FS, FIN, SCM |
| 99.25.050.000 | d6689987c11140v0 | 99.25 | Manage data security | BC, FS, FIN, SCM |
| 99.25.060.000 | d6689987c11161v0 | 99.25 | Configure segregation of duties | BC, FS, FIN, SCM |
| 99.25.070.000 | d6689987c11175v0 | 99.25 | Manage authentication | BC, FS, FIN, SCM |
| 99.25.100.000 | d6689987c11236v0 | 99.25 | Revoke users access to systems | BC, FS, FIN, SCM |
| 99.25.110.000 | d6689987c11254v0 | 99.25 | Update access to systems | BC, FS, FIN, SCM |

## 3. Product and implementation overlay

### 75.40 Procure goods and services

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| 75.40.010.000 | CORE_NOW | VERIFIED | Purchase | Approval is a threshold/boolean rather than a generic workflow engine; this is an accepted SME cut | Existing per-line `fulfilled_by_type/id`; no new hook | Purchase currency defaults must remain BOB; no IT or FACTURA effect | Requisition lifecycle and conversion exist ([procurement.routes.ts:50](../../backend/src/modules/purchase/procurement.routes.ts#L50), [requisition.service.ts:329](../../backend/src/modules/purchase/requisition.service.ts#L329)); historical end-to-end evidence: `verifyProcessChain.ts` and [status:37](S2P_O2C_STATUS.md#L37) | 2026-08-16 execution; 2026-09-08 code |
| 75.40.030.000 | CORE_NOW | VERIFIED | Purchase | None on the order header since WORK-024a: the `TRY` default and the `'BOB'` create literals are gone; the order takes the ledger's accounting currency and refuses a currency the tenant has not activated. `po_number` is tenant-scoped since WORK-023 | Existing `source_document_type/id`, `source_line_id`, and `agreement_line_id`; a future nullable `legal_entity_id` becomes an index swap | Currency must become parametric in WORK-024; numbering was repaired in WORK-023 | Manual, requisition, and RFQ origins exist ([purchase.routes.ts:246](../../backend/src/modules/purchase/purchase.routes.ts#L246), [schema.prisma:918](../../backend/prisma/schema.prisma#L918)); provenance is covered by [documentChain.test.ts:118](../../backend/src/__tests__/documentChain.test.ts#L118). WORK-023: all three origins allocate from the tenant `PURCHASE_ORDER` sequence (`purchaseOrderNumbering.test.ts`); `verify:tenant-numbering` passed 29/29 on TEST | 2026-09-11 code and TEST |
| 75.40.050.000 | CORE_NOW | PARTIAL | Purchase | Generic workflow/re-approval remains deferred; role strings remain fixed | `received_qty`, `invoiced_qty`, `cancelled_qty`, line delivery-date hooks, and immutable `PurchaseOrderChange` snapshots | No direct tax effect; cancellations preserve posted receipt/invoice history | WORK-021 makes confirmed orders non-destructively manageable: typed delivery updates, line remainder cancellation with row locking, open-quantity guards, and visible audit history ([purchaseOrderChange.service.ts](../../backend/src/modules/purchase/purchaseOrderChange.service.ts)); full D365 workflow and price/quantity change approval remain deferred | 2026-09-11 execution and code |
| 75.40.060.000 | CORE_LATER | ABSENT | Purchase | None in active behavior | Existing `source_document_type = PURCHASE_AGREEMENT` and `agreement_line_id`; commitment header/line behavior remains absent | No Bolivia-specific effect | The hook is explicit in [schema.prisma:918](../../backend/prisma/schema.prisma#L918) and [schema.prisma:977](../../backend/prisma/schema.prisma#L977); price trade agreements are not blanket-order commitments | 2026-09-08 code only |
| 75.40.070.000 | CORE_NOW | VERIFIED | Purchase + Inventory | Outbound warehouse work and disposition codes remain deferred | `PurchaseReturn`/lines preserve invoice, matched receipt, product, cost, warehouse, and location provenance; reversal FK is reserved | BOB-only; non-recoverable tax and combined receipt-ledger history fail closed | WORK-019 adds create/list/detail/ship forms and routes. Supabase TEST marker `WORK019-1789045833082` proved one-unit stock and exact PO cost-layer reduction plus a balanced shipment voucher | 2026-09-10 execution and code |
| 75.40.080.000 | CORE_LATER | ABSENT | Purchase | None | **MISSING:** many-to-many requisition-line to PO-line provenance join; a single `source_line_id` cannot prove consolidation | No direct localization effect | Requisition and PO lines exist, but no consolidation service/route or join table was found | 2026-09-08 code only |
| 75.40.100.000 | CORE_LATER | ABSENT | Purchase / Inventory | None | Existing `PurchaseRequisition.purpose = REPLENISHMENT` and `source_document_type = PLANNED_ORDER`; behavior intentionally rejects unsupported replenishment | No direct localization effect | Hook and behavior cut are documented in [schema.prisma:3234](../../backend/prisma/schema.prisma#L3234) and [PROCESS_CHAIN.md:121](PROCESS_CHAIN.md#L121) | 2026-09-08 code only |

### 60.30 Process inbound goods

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| 60.30.010.000 | CORE_NOW | VERIFIED | Purchase + Warehouse | None found in the selected receipt scenario | Existing `ProductReceipt`/lines, supplier packing slip, location, correction link | Input IVA timing remains parameter-owned; IT and FACTURA do not apply to receipt | Receipt route and document exist ([purchase.routes.ts:329](../../backend/src/modules/purchase/purchase.routes.ts#L329), [schema.prisma:1016](../../backend/prisma/schema.prisma#L1016)); historical 32-assertion purchase-cycle evidence is recorded at [status:55](S2P_O2C_STATUS.md#L55) | 2026-08-16 execution; 2026-09-08 code |
| 60.30.020.000 | CORE_LATER | ABSENT | Warehouse | None | **MISSING:** handling-unit/license-plate entity and nullable receipt-line FK; product/location labels alone do not preserve received-unit identity | No direct localization effect | No receipt-label or license-plate model/service was found | 2026-09-08 code only |
| 60.30.030.000 | CORE_NOW | VERIFIED | Warehouse | None on numbering: `WarehouseWork.work_id_code` is tenant-scoped since WORK-023 | Existing `WarehouseWork.reference_type/reference_id` and work lines | No direct localization effect | Parameter-driven putaway creates work from product receipt ([productReceipt.service.ts:342](../../backend/src/modules/purchase/productReceipt.service.ts#L342)). WORK-020 reran the permanent `verifyPutaway.ts` harness against Supabase TEST: 14/14 assertions proved pick-only availability, stock and FIFO-cost movement, the transfer subledger pair, duplicate-completion refusal, parameter restoration, and cleanup | 2026-09-11 execution and code |
| 60.30.040.000 | CORE_LATER | ABSENT | Warehouse | None | Existing generic warehouse-work reference plus PO provenance are attachment points; allocation to a specific outbound line still needs a join | No direct localization effect | No inbound cross-dock service or route was found | 2026-09-08 code only |
| 60.30.060.000 | CORE_LATER | ABSENT | Inventory quality | None | **MISSING:** inventory status/quality hold plus receipt-line disposition link | No direct localization effect | No quarantine or quality-order model/service was found | 2026-09-08 code only |

### 75.50 Manage accounts payable

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| 75.50.020.000 | CORE_NOW | VERIFIED | Purchase (AP parameters) | Tax is still calculated at document total; line tax columns are hooks | Existing PO/receipt/invoice line links and `VendorInvoiceMatch` | Input IVA is supported; IT is filtered from purchases; per-line tax and recognition timing remain open | Invoice, matching, discrepancy approval, and posting routes exist ([purchase.routes.ts:504](../../backend/src/modules/purchase/purchase.routes.ts#L504), [schema.prisma:1126](../../backend/prisma/schema.prisma#L1126)); historical purchase-cycle verification is recorded at [status:55](S2P_O2C_STATUS.md#L55) | 2026-08-16 execution; 2026-09-08 code |
| 75.50.070.000 | CORE_LATER | ABSENT | Purchase (AP) | None | Proposed nullable dispute case link on invoice or independent `VendorInvoiceDispute` keyed to invoice; not present | No direct localization effect | Matching discrepancy approval is not supplier dispute management; no dispute model/route was found | 2026-09-08 code only |
| 75.50.080.000 | CORE_NOW | VERIFIED | Purchase (AP) | Formal Bolivian tax-book export and credit reversal UI remain deferred | `SupplierCredit`/lines link the supplier reference to the original invoice and shipped return; AP source type and reversal FK are present | Supplier reference is mandatory; BOB/BOB and recoverable IVA only; fiscal filing readiness is not claimed | WORK-019 posts `Dr AP / Cr purchase accrual / Cr VAT input`, reverses price variance when needed, creates a DEBIT AP transaction, and settles the exact source invoice. Supabase TEST marker `WORK019-1789045833082` closed a 100 BOB invoice with balanced vouchers | 2026-09-10 execution and code |
| 75.50.090.000 | CORE_NOW | VERIFIED | Purchase (AP) + Cash and bank | None in the accepted BOB/BOB path; cross-currency, discounts, write-offs, withholding, bank files, and live approval remain deferred | `VendorPayment`, `VendorOpenTransaction`, immutable settlement rows, currency snapshots, and reversal links are present | Accepted runtime is BOB/BOB; no IT or FACTURA effect | WORK-018 replaced the PO-paid shortcut with invoice-based payment and partial/many-to-many settlement. Live Supabase TEST acceptance posted and fully reversed `WORK018-1789028564347` and `WORK018-1789028756197`; the latter verified a balanced voucher, closure, `paid_at`, reversal, and restored invoice balance | 2026-09-10 execution and code |
| 75.50.100.000 | OUT_OF_SCOPE | ABSENT | Cash and bank | None | `NONE_REQUIRED`: if later justified, a payment-instrument model can attach to `VendorPayment`; it must not distort today's invoice schema | Validate only if Bolivian business practice requires it | No promissory-note behavior exists; excluded for the anchor retailer | 2026-09-08 code only |
| 75.50.110.000 | CORE_NOW | VERIFIED | Cash and bank | Bank-specific cancellation rules remain deferred | Payment and settlement reversals are immutable and linked to the original records | Accepted runtime is the internal BOB payment journal; external bank cancellation is not claimed | WORK-018 live acceptance proved a linked correcting journal, closed original payment, closed reversal transaction, and restored invoice balance | 2026-09-10 execution and code |
| 75.50.120.000 | CORE_NOW | PARTIAL | Cash and bank | A corrected replacement payment is entered separately after reversing the error | Forward reversal links prevent double reversal; the replacement uses the ordinary payment model | Closed-period and bank-specific correction rules need local validation | WORK-018 supports audited reversal and re-entry, but it does not provide a one-step correction wizard | 2026-09-10 execution and code |
| 75.50.130.000 | ADD_ON | ABSENT | Purchase | None | Proposed agreement discriminator and accrual/claim records; ordinary price `TradeAgreement` rows are insufficient | No direct localization effect | Purchase trade pricing exists, but supplier rebate accrual/claim behavior does not | 2026-09-08 code only |

### Cross-cutting processes used by this slice

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| 90.50.040.000 | CORE_NOW | VERIFIED | Finance | None on numbering: `journal_entries.entry_number` is tenant-scoped since WORK-023. Since WORK-024b every line carries its transaction, accounting and reporting amounts with the rate used for each, and the voucher names the ledger currencies and rate date | Existing journal source/document references and correction link; a nullable `legal_entity_id` plus an index swap when multi-entity tenants arrive | Receipt/invoice postings must preserve recoverable IVA and exclude IT | Physical and financial postings plus accrual reversal are described and historically verified in [VENDOR_INVOICE.md:370](VENDOR_INVOICE.md#L370) | 2026-08-16 execution; 2026-09-08 code |
| 99.20.040.000 | CORE_NOW | VERIFIED | Owning module parameters; shared allocator | Document-type ownership is centralized. WORK-023 (migration 031) replaced the seven legacy global uniques with `(tenant_id, number)`; SO, shipment, count, and arrival-journal generators still bypass the allocator | Existing `NumberSequence.legal_entity_id`; fiscal-year history remains a named future design | Supplier invoice internal number and receipt number are internal; supplier fiscal number remains external | Setup GET/PUT and allocator integration exist ([setup.routes.ts:411](../../backend/src/modules/setup/setup.routes.ts#L411), [schema.prisma:2182](../../backend/prisma/schema.prisma#L2182)); number-sequence tests are in the green baseline. WORK-023 moved PO numbering onto the `PURCHASE_ORDER` sequence, seeded above the highest issued number, and proved tenant-scoped uniqueness on TEST (`verify:tenant-numbering`, 29/29) | 2026-09-11 code and TEST |
| 99.25.050.000 | CORE_NOW | PARTIAL | Security | Data access still relies on per-query tenant filters and organization scope is not configurable | Future organization-scoped assignment tables from the approved security design | Financial and tax data must never cross tenants | WORK-016 moved all 45 purchasing routes to stable business permissions and tests denial before database handlers; row-level tenant isolation remains the current data boundary. WORK-022 removed the public tenant router: tenant administration is now `/tenant` inside tenant+auth middleware with no tenant id in the path, and a tenant-A token with a tenant-B header is refused (`tenantRoutePermissions.test.ts`). WORK-029 closed the O2C cross-tenant writes (`/sales/orders/:id/complete`, the customer body spread, and foreign customer/product/variant ids on orders via `assertTenantReferences`), guarded the POS and customer routes, and scoped POS and storefront stock to the register's or order's warehouse (`o2cContainment.test.ts`; `verify:o2c-containment` 12/12 on TEST). WORK-030a put sales orders, quotations, CRM, customers and POS on exported permission manifests and confined `customer` and unknown roles to a five-route storefront surface through the workforce gate (`o2cRoutePermissions.test.ts`, `storefrontContainment.test.ts`; `verify:o2c-permissions` 32/32 on TEST) | 2026-09-13 code, tests, TEST smoke |
| 99.25.060.000 | CORE_NOW | PARTIAL | Security | Assignable purchasing roles separate operational duties, but the full configurable Role -> Duty -> Privilege catalog is deferred | Approved assignment/scope/history tables remain future hooks | No Bolivia-specific rule; financial control risk is universal | WORK-016 introduced purchasing requester, approver, buyer, receiver, invoice, and payment permission boundaries; live assignment governance remains incomplete. WORK-022 separates accounting setup (`finance.setup.maintain`, admin only: currency, tax basis, chart-of-accounts seeding) from organisation setup (`setup.tenant.maintain`, admin and store manager), and refuses a non-admin creating an admin user | 2026-09-11 code and tests |
| 99.25.070.000 | CORE_NOW | PARTIAL | Security | Authentication exists, but it is not the configurable authorization model | Session/revocation hooks belong to the approved security foundation | Tenant identity must remain server-derived | JWT authentication middleware exists at [authMiddleware.ts:10](../../backend/src/shared/middleware/authMiddleware.ts#L10). WORK-022 closed the unauthenticated tenant routes (create, read and change any tenant); tenants are now created only by the operator CLI `backend/scripts/createTenant.ts`. **WORK-030a:** `/auth/register` requires an explicit tenant, always creates a `customer`, and `/auth/make-admin` is removed (`storefrontContainment.test.ts`; `verify:o2c-permissions` on TEST); refresh-token revocation remains in the P0-Security sweep | 2026-09-13 code, tests, TEST smoke |
| 99.25.100.000 | CORE_NOW | PARTIAL | Security | User deactivation does not prove active-session revocation | Session/revocation records from the approved security design | No direct localization effect | User deactivation exists, but revocation remains an approved security gap | 2026-09-08 code only |
| 99.25.110.000 | CORE_NOW | PARTIAL | Security | Role updates use one role string, not governed assignments | Role assignment validity/scope/history from the approved security design | No direct localization effect | Role update exists, but configurable duties/privileges and assignment audit do not. WORK-022 blocks the store-manager-to-admin escalation through `POST /hr/employees` | 2026-09-11 code and tests |

## 4. Selected SME scenarios

The first implementation queue must descend only into these JUL-2026 scenarios. Product-specific
variants for intercompany, projects, Field Service, punch-out, OCR, post-dated checks, and supplier
rebates remain outside this slice.

| scenario_id | title | decision |
|---|---|---|
| 75.40.010.100 | Manage purchase requisition in Dynamics 365 Supply Chain Management | Current supported scenario |
| 75.40.010.200 | Add an item to purchase requisition in Dynamics 365 Supply Chain Management | Current supported scenario |
| 75.40.030.600 | Create purchase orders in Dynamics 365 Supply Chain Management | Current supported scenario |
| 75.40.030.800 | Create purchase order from requisition in Dynamics 365 Supply Chain Management | Current supported scenario |
| 75.40.030.850 | Create purchase order from request for quotations in Dynamics 365 Supply Chain Management | Current supported scenario |
| 75.40.030.900 | Create purchase order manually in Dynamics 365 Supply Chain Management | Current supported scenario |
| 75.40.050.100 | Manage open purchase orders in Dynamics 365 Supply Chain Management | Partial; generic approval workflow remains deferred |
| 75.40.050.200 | Cancel the remaining quantity on a purchase order in Dynamics 365 Supply Chain Management | Current typed line-remainder cancellation scenario |
| 75.40.050.300 | Update delivery information on purchase orders in Dynamics 365 Supply Chain Management | Current requested/confirmed-date update scenario |
| 75.40.050.500 | Update quantity or pricing information on purchases in Dynamics 365 Supply Chain Management | Partial; approval history is missing |
| 75.40.050.700 | Cancel a confirmed purchase order in Dynamics 365 Supply Chain Management | Current supported scenario before downstream posting |
| 75.40.070.100 | Manage purchase order returns in Dynamics 365 Supply Chain Management | Current receipt- and invoice-linked physical supplier-return scenario |
| 60.30.010.100 | Receive a purchase order in a warehouse in Dynamics 365 Supply Chain Management | Current supported scenario |
| 60.30.030.100 | Receive stocked products in Dynamics 365 Supply Chain Management | Current parameter-driven putaway scenario; WORK-020 refreshed its standing execution proof |
| 75.50.020.100 | Record supplier invoices in Dynamics 365 Finance | Current supported PO-invoice scenario |
| 75.50.020.300 | Perform invoice matching in Dynamics 365 Finance | Current supported three-way scenario |
| 75.50.080.100 | Manage supplier credits in Dynamics 365 Supply Chain Management | Current BOB receipt-linked supplier-credit scenario |
| 75.50.090.200 | Manage supplier payments in Dynamics 365 Finance | Current supported BOB/BOB scenario; cross-currency and bank files are deferred |
| 75.50.090.600 | Manage supplier settlements in Dynamics 365 Finance | Current partial and many-to-many invoice settlement scenario |
| 75.50.110.200 | Reverse a payment using a payment journal with Dynamics 365 Finance | Current immutable payment-journal reversal scenario |
| 75.50.120.100 | Correct a payment in Dynamics 365 Finance | Partial; reverse and re-enter is supported, but no one-step correction wizard exists |

## 5. Prioritized findings

1. **[REPO-VERIFIED] WORK-019 closed the selected supplier-return and supplier-credit gap.** The
   accepted BOB path preserves original receipt/invoice provenance and an immutable physical and
   financial audit trail; its explicit unsupported boundaries remain recorded in the matrix.
2. **[REPO-VERIFIED] WORK-018 closes the bounded BOB vendor-payment outcome.** Invoice-based payment,
   partial and many-to-many settlement, cancellation by reversal, and reverse-and-re-enter correction
   are implemented and live-tested. Cross-currency and bank integration remain explicitly deferred.
3. **[REPO-VERIFIED] Purchase orders still carry global `po_number` uniqueness and a `TRY` default.**
   These contradict row-level tenancy and Bolivia's default. Remediate them when the PO path is next
   changed; do not start a sweeping unrelated schema refactor. *Update 2026-09-11:* `po_number` is
   tenant-scoped since WORK-023; the currency default becomes parametric in WORK-024.
4. **[REPO-VERIFIED] The IT-on-purchases warning in the older status document is superseded.** The
   side filter exists. Per-line tax remains a real gap because the invoice service calculates from
   the document gross while line tax columns are only hooks.
5. **[ARCHITECTURAL RECOMMENDATION] Security remains a parallel prerequisite for external users, not
   a blocker for this analysis.** The separate 99.25 route/permission audit should follow this matrix
   and precede implementation of financial mutation routes.
6. **[ASSUMPTION NEEDING VALIDATION]** Input IVA recognition timing, supplier credit-note fiscal
   treatment, and payment/bank reversal rules require Bolivia-specific authority. Microsoft Learn
   cannot decide them.

## 6. Next bounded work item

WORK-021 closes the bounded SME behavior for `75.40.050.000 Manage open purchases` while the catalog
row remains PARTIAL because generic approval/re-approval workflow and price/quantity change control
are intentionally deferred. Microsoft Learn requires cancellation to respect the received/invoiced
remainder and to preserve confirmation history; the repository now does so with typed quantities,
row-locked transactions, immutable snapshots, and an end-user Manage form. WORK-020 closed the
standing-verification gap for `60.30.030.000 Put away received goods`.
[Microsoft Learn](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/warehouse-location-status#set-up-warehouse-location-status)
confirms that purchase receiving can create separate put-away work and that completing the work
moves the goods to the directed location. The next step is a fresh catalog-aligned review after the
manual Claude handoff; do not expand this bounded work into a generic D365 workflow engine without a
new design decision.

## 7. Extension — Order to Cash, Inventory, Record to Report (WORK-028)

**Assessment date:** 2026-09-11 · **Assessor:** Claude solution-architect agent (interim Codex role)
**Repository state:** `codex/rebuild-2026-09-07` at `8d0df3b`. Code was read; **no test, build,
database, or browser command was run for this extension.** Historical execution evidence is dated.
**Merged 2026-09-11 at `9284ef3`.** WORK-029 (`e4e642e`) has since closed the `/complete` tenant
defect, POS stock scoping, and the count-line guard; those cells are annotated *Closed by WORK-029*.
The decisions in §12 were taken on 2026-09-11 and are applied to §8, §10, and §11.

### 7.1 Evidence boundaries

- **[OFFICIAL]** Order to cash excludes fulfilment; fulfilment is Inventory to deliver:
  <https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-introduction>.
- **[OFFICIAL]** The Manage accounts receivable area comprises Issue sales invoices, Issue customer
  credits, Bill subscriptions, Recognize revenue, Process customer payments, Process customer
  prepayments, Process customer refunds, Settle customer transactions, Write off bad debt, Manage
  trade allowances, Calculate sales commissions, Manage bills of exchange:
  <https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-invoice-sales-orders-overview>.
- **[OFFICIAL]** Process outbound goods comprises Allocate goods, Release goods for picking, Pick
  goods, Pack goods, Load goods for shipping, Cross dock produced goods, Return goods to vendor:
  <https://learn.microsoft.com/dynamics365/guidance/business-processes/inventory-to-deliver-process-outbound-goods-overview>.
- **[OFFICIAL]** Maintain inventory levels comprises Track supplier-/customer-managed and consigned
  inventory, Process inventory movements, Stage inventory, Count inventory, Analyze inventory
  levels, Adjust inventory levels:
  <https://learn.microsoft.com/dynamics365/guidance/business-processes/inventory-to-deliver-maintain-inventory-levels-overview>.
- **[OFFICIAL]** Close financial periods comprises Finalize and post transactions, Reconcile ledger
  and subledger, Revalue currency, Perform ledger settlements, Consolidate and eliminate
  financials, Prepare financial statements, Close periods:
  <https://learn.microsoft.com/dynamics365/guidance/business-processes/record-to-report-close-financial-periods>.
- **[WORKBOOK — NOT AVAILABLE]** The JUL-2026 workbook is not in the repository. Level-3 IDs,
  Microsoft IDs, and product tags for the rows below could not be verified. The only repo-recorded
  O2C level-3 ID is `65.20.400.000 Process customer returns and exchanges`
  ([CODEX_CLAUDE_WORKLOG.md:1327](../collaboration/CODEX_CLAUDE_WORKLOG.md#L1327)). Every other new
  row uses an `UNVERIFIED-<area>-<n>` placeholder that **must be replaced from the workbook before
  this section is treated as governed**. Titles are Learn-verified; IDs are not.
- **[CONTRADICTION — catalog framework]** Learn lists *Manage inventory costs* as an Inventory to
  deliver area
  (<https://learn.microsoft.com/dynamics365/guidance/business-processes/inventory-to-deliver-overview>),
  but [CORE_ERP_PROCESS_CATALOG.md §4](CORE_ERP_PROCESS_CATALOG.md) lists no cost area under 60.
  Its ID is unverified; resolve from the workbook.

### 7.2 Stale statements superseded by this extension

| Statement | Source | Repo-verified fact |
|---|---|---|
| Customer invoice is a header-only `Factura` with no lines | [HANDOVER.md:2002](../../HANDOVER.md#L2002), [S2P_O2C_STATUS.md:27](S2P_O2C_STATUS.md#L27), [:73](S2P_O2C_STATUS.md#L73) | **Refuted.** `FacturaLine` exists ([schema.prisma:3967](../../backend/prisma/schema.prisma#L3967)); both ERP ([sales.routes.ts:254](../../backend/src/modules/sales/sales.routes.ts#L254)) and POS ([pos.routes.ts:310](../../backend/src/modules/pos/pos.routes.ts#L310)) write lines and advance `invoiced_qty` ([facturaLine.service.ts:248](../../backend/src/shared/services/facturaLine.service.ts#L248)). HANDOVER §4h.7 ([HANDOVER.md:1751](../../HANDOVER.md#L1751)) already said so. **But** partial invoicing is still impossible: the route refuses a second invoice per order ([sales.routes.ts:162](../../backend/src/modules/sales/sales.routes.ts#L162)); credit notes still have no lines ([sales.routes.ts:637](../../backend/src/modules/sales/sales.routes.ts#L637)); the printed factura renders from the header ([HANDOVER.md:1775](../../HANDOVER.md#L1775)) |
| No line-level `delivered_qty` / `invoiced_qty` | [S2P_O2C_STATUS.md:68](S2P_O2C_STATUS.md#L68) | Columns exist ([schema.prisma:1829](../../backend/prisma/schema.prisma#L1829)); `invoiced_qty` is written; **`delivered_qty` is written by no code path** (repository-wide search of `backend/src`) |
| Global `@unique` on `order_number` / `shipment_number` | [S2P_O2C_STATUS.md:98](S2P_O2C_STATUS.md#L98), [HANDOVER.md:1987](../../HANDOVER.md#L1987) | Tenant-scoped since WORK-023 ([schema.prisma:1794](../../backend/prisma/schema.prisma#L1794), [:1857](../../backend/prisma/schema.prisma#L1857)) |
| Financial dimensions (Store) ❌ | [S2P_O2C_STATUS.md:93](S2P_O2C_STATUS.md#L93) | Implemented (migration 018); STORE required on revenue/COGS since 2026-08-18 ([HANDOVER.md:1779](../../HANDOVER.md#L1779)) |
| O2C financial posting ✅ | [S2P_O2C_STATUS.md:74](S2P_O2C_STATUS.md#L74) | Balanced, but COGS is valued at `Product.cost_price` while the FIFO subledger is consumed at layer cost — see §8.2. Not reconcilable |
| 75.50.090.000 VERIFIED (matrix §3) | this file | The payment runtime is verified, but **AP aging still reads `PurchaseOrder.paid_at`** ([finance.routes.ts:595](../../backend/src/modules/finance/finance.routes.ts#L595)), which WORK-018 made obsolete. The report is wrong for every tenant using vendor payments |

## 8. Product and implementation overlay — new rows

Column format is identical to §3. `last_verified_at` "2026-09-11 code" means read at `8d0df3b`,
not executed.

### 8.0 Source mapping (IDs pending the workbook)

| catalog_id | microsoft_id | parent_id | title (Learn-verified) | product_tags |
|---|---|---|---|---|
| 65.20.400.000 | UNVERIFIED | 65.20 | Process customer returns and exchanges | UNVERIFIED |
| UNVERIFIED-65.20-A | UNVERIFIED | 65.20 | Enter and confirm sales orders (title unverified) | UNVERIFIED |
| UNVERIFIED-65.20-B | UNVERIFIED | 65.20 | Point-of-sale sale (Commerce channel; title and area unverified) | UNVERIFIED |
| UNVERIFIED-60.40-A | UNVERIFIED | 60.40 | Allocate goods | UNVERIFIED |
| UNVERIFIED-60.40-B | UNVERIFIED | 60.40 | Release goods for picking / Pick goods | UNVERIFIED |
| UNVERIFIED-60.40-C | UNVERIFIED | 60.40 | Pack goods | UNVERIFIED |
| UNVERIFIED-60.40-D | UNVERIFIED | 60.40 | Load goods for shipping | UNVERIFIED |
| UNVERIFIED-60.40-E | UNVERIFIED | 60.40 | Cross dock produced goods | UNVERIFIED |
| UNVERIFIED-65.30-A | UNVERIFIED | 65.30 | Issue sales invoices | UNVERIFIED |
| UNVERIFIED-65.30-B | UNVERIFIED | 65.30 | Issue customer credits | UNVERIFIED |
| UNVERIFIED-65.30-C | UNVERIFIED | 65.30 | Process customer payments | UNVERIFIED |
| UNVERIFIED-65.30-D | UNVERIFIED | 65.30 | Settle customer transactions | UNVERIFIED |
| UNVERIFIED-65.30-E | UNVERIFIED | 65.30 | Process customer refunds | UNVERIFIED |
| UNVERIFIED-65.30-F | UNVERIFIED | 65.30 | Process customer prepayments | UNVERIFIED |
| UNVERIFIED-65.30-G | UNVERIFIED | 65.30 | Write off bad debt | UNVERIFIED |
| UNVERIFIED-65.30-H | UNVERIFIED | 65.30 | Bill subscriptions; Recognize revenue; Manage trade allowances; Calculate sales commissions; Manage bills of exchange | UNVERIFIED |
| UNVERIFIED-65.50-A | UNVERIFIED | 65.50 | Customer credit limit check (basic pattern) | UNVERIFIED |
| UNVERIFIED-65.50-B | UNVERIFIED | 65.50 | Credit management holds, groups, risk, collections | UNVERIFIED |
| UNVERIFIED-60.20-A | UNVERIFIED | 60.20 | Count inventory | UNVERIFIED |
| UNVERIFIED-60.20-B | UNVERIFIED | 60.20 | Adjust inventory levels | UNVERIFIED |
| UNVERIFIED-60.20-C | UNVERIFIED | 60.20 | Process inventory movements | UNVERIFIED |
| UNVERIFIED-60.20-D | UNVERIFIED | 60.20 | Stage inventory; Track consigned inventory | UNVERIFIED |
| UNVERIFIED-60.xx-COST | UNVERIFIED | UNVERIFIED | Manage inventory costs (area) | UNVERIFIED |
| UNVERIFIED-90.xx-DIM | UNVERIFIED | 90.10 or 90.50 | Financial dimension coding | UNVERIFIED |
| UNVERIFIED-90.60-A | UNVERIFIED | 90.60 | Finalize and post transactions / Reconcile ledger and subledger | UNVERIFIED |
| UNVERIFIED-90.60-B | UNVERIFIED | 90.60 | Close periods | UNVERIFIED |
| UNVERIFIED-90.60-C | UNVERIFIED | 90.60 | Year-end close (placement unverified) | UNVERIFIED |
| UNVERIFIED-90.60-D | UNVERIFIED | 90.60 | Prepare financial statements | UNVERIFIED |
| UNVERIFIED-90.60-E | UNVERIFIED | 90.60 | Revalue currency | UNVERIFIED |
| UNVERIFIED-90.60-F | UNVERIFIED | 90.60 | Perform ledger settlements; Consolidate and eliminate financials | UNVERIFIED |
| UNVERIFIED-90.70-A | UNVERIFIED | 90.70 | Analyze financial performance (store P&L) | UNVERIFIED |

### 8.1 65.20 Manage sales orders

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| UNVERIFIED-65.20-A | CORE_NOW | PARTIAL | Sales (SalesParameters) | `status` is a free string; order numbers bypass the existing `SALES_ORDER` sequence ([numberSequence.service.ts:63](../../backend/src/shared/services/numberSequence.service.ts#L63), WORK-023 deferral); `currency` defaults to `BOB` ([schema.prisma:1739](../../backend/prisma/schema.prisma#L1739)); the edit path computes tax without the customer's tax group ([sales.routes.ts:456](../../backend/src/modules/sales/sales.routes.ts#L456)) | Existing `source_document_type/id`, `source_line_id`, line tax hooks ([schema.prisma:1779](../../backend/prisma/schema.prisma#L1779), [:1815](../../backend/prisma/schema.prisma#L1815)). Change management needs no hook (§10 D-5) | Tax on order is preview only; the posting value is recomputed at invoice | Create/confirm with reservation and wave release ([sales.service.ts:112](../../backend/src/modules/sales/sales.service.ts#L112)). ~~**DEFECT (tenant isolation):** `POST /:id/complete` updates by `id` only~~ — *Closed by WORK-029:* tenant-scoped load, SHIPPED-only, status-guarded `updateMany`; foreign customer/product/variant ids refused by `assertTenantReferences` (`o2cContainment.test.ts`). **99.25 gap:** all sales routes use `requireRole`, no business permissions. No O2C execution harness exists | 2026-09-11 code |
| UNVERIFIED-65.20-B | ADD_ON (POS package); its ledger effects are CORE_NOW | PARTIAL | Sales + Cash and bank (payment methods) | Payment method in the request drives nothing in the ledger; `Product.cost_price` drives COGS ([pos.routes.ts:186](../../backend/src/modules/pos/pos.routes.ts#L186)) | Needs a sales-side payment-method → offset-account mapping (see WORK-033) | Atomic, continuous FACTURA allocation inside the transaction ([pos.routes.ts:166](../../backend/src/modules/pos/pos.routes.ts#L166)); IT expense/payable posted ([pos.routes.ts:355](../../backend/src/modules/pos/pos.routes.ts#L355)) — **must not regress** | **DEFECT (ledger):** the sale debits AR ([pos.routes.ts:348](../../backend/src/modules/pos/pos.routes.ts#L348)) and sets `paid_at` ([:271](../../backend/src/modules/pos/pos.routes.ts#L271)), but no voucher clears AR or debits cash in the sale path ([:336-379](../../backend/src/modules/pos/pos.routes.ts#L336)) or on session close ([:79-115](../../backend/src/modules/pos/pos.routes.ts#L79)). ~~**DEFECT (inventory):** stock is deducted from any warehouse of the tenant~~ — *Closed by WORK-029:* the register session resolves its warehouse and `posStock.service.ts` deducts and restores only there; routes guarded by `pos:*`. Still open: no cost layer is consumed (WORK-031). **Confirmed on TEST 2026-09-11 (read-only):** AR GL 1103 = 9,107 against 130 in open documents (POS_SALE +3,000, CORRECTION +7,127); fix in WORK-033 | 2026-09-11 code |
| 65.20.400.000 | CORE_NOW | PARTIAL | Sales (returns) + Inventory | Whole-order return only; refund account resolved as `BANK` without a user decision ([sales.routes.ts:716](../../backend/src/modules/sales/sales.routes.ts#L716)) | **MISSING (add in WORK-037):** return document + line link to `FacturaLine`; `disposition` enum; nullable `return_reason_code`, `replacement_order_id` (§10 D-8). Existing `CREDIT_NOTE` sequence reference ([numberSequence.service.ts:61](../../backend/src/shared/services/numberSequence.service.ts#L61)) | Credit note reverses IVA and IT together ([sales.routes.ts:670](../../backend/src/modules/sales/sales.routes.ts#L670)); draws from the continuous FACTURA series pending the legal answer ([sales.routes.ts:592](../../backend/src/modules/sales/sales.routes.ts#L592)) | Returns restore stock with a `RETURN` transaction valued at the **sales price** ([sales.routes.ts:629](../../backend/src/modules/sales/sales.routes.ts#L629)); no cost layer is recreated; COGS is reversed at **today's** `cost_price`, not the cost originally issued ([:681](../../backend/src/modules/sales/sales.routes.ts#L681)); the negative-total credit-note factura has no lines ([:637](../../backend/src/modules/sales/sales.routes.ts#L637)). **[OFFICIAL]** returns use a return order with disposition codes; *Credit* restores inventory value at the cost of the returned item: <https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/sales-returns> | 2026-09-11 code |

### 8.2 60.40 Process outbound goods

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| UNVERIFIED-60.40-A | CORE_NOW | IMPLEMENTED_UNVERIFIED | Sales (reservation default) → Inventory | None found | None required | None | Availability check and reservation in the order's warehouse ([sales.service.ts:120](../../backend/src/modules/sales/sales.service.ts#L120)); release on cancel ([:324](../../backend/src/modules/sales/sales.service.ts#L324)). No harness | 2026-09-11 code |
| UNVERIFIED-60.40-B | CORE_NOW | IMPLEMENTED_UNVERIFIED | Warehouse (WarehouseParameters, work templates) | None found | Existing `WarehouseWork.reference_type/id` | None | Wave assignment on confirm ([sales.service.ts:148](../../backend/src/modules/sales/sales.service.ts#L148)); picking gate by item model group ([:166](../../backend/src/modules/sales/sales.service.ts#L166)); wave/work routes ([warehouse.routes.ts](../../backend/src/modules/warehouse/warehouse.routes.ts)). The putaway harness covers inbound only; **no outbound pick harness** | 2026-09-11 code |
| UNVERIFIED-60.40-C | CORE_LATER | ABSENT | Warehouse | None | `NONE_REQUIRED` — a packing/container entity attaches to the future shipment line | None | No pack step exists | 2026-09-11 code |
| UNVERIFIED-60.40-D | CORE_NOW | PARTIAL | Warehouse + Sales | Shipment number `SHP-${Date.now()}` bypasses the allocator ([sales.service.ts:283](../../backend/src/modules/sales/sales.service.ts#L283)) | **MISSING (add in WORK-036):** `ShipmentLine` (shipment_id, sales_order_line_id, quantity, location, cost) — `Shipment` has no lines ([schema.prisma:1842](../../backend/prisma/schema.prisma#L1842)); `SHIPMENT` sequence reference | Packing slip carries no fiscal effect; IT/IVA only at invoice | Ship is whole-order only; `delivered_qty` is never written. **DEFECT (atomicity):** stock/cost-layer consumption ([inventory.service.ts:174](../../backend/src/modules/inventory/inventory.service.ts#L174)), the COGS voucher ([sales.service.ts:260](../../backend/src/modules/sales/sales.service.ts#L260)) and shipment creation ([:284](../../backend/src/modules/sales/sales.service.ts#L284)) run in separate transactions. **DEFECT (costing):** COGS = `quantity × Product.cost_price` ([sales.service.ts:223](../../backend/src/modules/sales/sales.service.ts#L223)) while FIFO layers are consumed at layer cost; the OUTBOUND transaction records the **sales price** as `unit_cost` ([inventory.service.ts:228](../../backend/src/modules/inventory/inventory.service.ts#L228), [:268](../../backend/src/modules/inventory/inventory.service.ts#L268)) | 2026-09-11 code |
| UNVERIFIED-60.40-E | OUT_OF_SCOPE | ABSENT | — | None | `NONE_REQUIRED` (production is out of scope) | None | Plan to produce excluded by CLAUDE.md §4 | 2026-09-11 |
| (see 75.40.070.000) | — | — | — | — | — | — | *Return goods to vendor* is catalogued under 60.40 but is already evidenced in §3 by 75.40.070.000 (WORK-019) | — |

### 8.3 65.30 Manage accounts receivable

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| UNVERIFIED-65.30-A | CORE_NOW | PARTIAL | Sales (AR section of SalesParameters) | Tax computed on the order header total, then apportioned to lines ([sales.routes.ts:205](../../backend/src/modules/sales/sales.routes.ts#L205)); invoice date is always `now` ([:241](../../backend/src/modules/sales/sales.routes.ts#L241)) | Existing `FacturaLine` with `sales_order_line_id`, per-line tax columns and IVA/IT split ([schema.prisma:3967](../../backend/prisma/schema.prisma#L3967)). `SalesOrder.invoice_id` is a single soft reference ([:1757](../../backend/prisma/schema.prisma#L1757)); partial invoicing must link through `FacturaLine`, not this column | **Continuous FACTURA allocated inside the posting transaction** ([sales.routes.ts:229](../../backend/src/modules/sales/sales.routes.ts#L229)); IVA inclusive and IT sales-only from the tax engine. Whether line detail is legally required is open ([HANDOVER.md:2002](../../HANDOVER.md#L2002)) | Invoice + balanced voucher with revenue by item group and STORE dimension ([sales.routes.ts:333](../../backend/src/modules/sales/sales.routes.ts#L333)). Historical `verifyFacturaLines.ts` 14/14 (2026-08-17, [HANDOVER.md:1775](../../HANDOVER.md#L1775)). A second invoice per order is refused ([:162](../../backend/src/modules/sales/sales.routes.ts#L162)); no AR open transaction is created | 2026-08-17 execution; 2026-09-11 code |
| UNVERIFIED-65.30-B | CORE_NOW | PARTIAL | Sales (AR) | As 65.20.400.000 | **MISSING (WORK-037):** nullable `FacturaLine.credits_factura_line_id` on credit-note lines | Credit-note series legality open; must reverse IVA and IT exactly | Credit note exists only as a side effect of whole-order return ([sales.routes.ts:637](../../backend/src/modules/sales/sales.routes.ts#L637)); no stand-alone credit note (price correction without goods) | 2026-09-11 code |
| UNVERIFIED-65.30-C | CORE_NOW | GAP | Sales (AR) + Cash and bank | Default bank account code literal `'1102'` ([sales.routes.ts:371](../../backend/src/modules/sales/sales.routes.ts#L371)) | **MISSING (WORK-034):** `CustomerPayment`, `CustomerOpenTransaction`, `CustomerSettlement` mirroring the accepted AP models ([schema.prisma:1383-1481](../../backend/prisma/schema.prisma#L1383)), including reversal links from day one | Local currency only at stores (Kubi, 2026-09-11) | Payment is `SalesOrder.paid_at`, full amount only ([sales.routes.ts:362](../../backend/src/modules/sales/sales.routes.ts#L362)); no partial, no one-payment-many-invoices. **[OFFICIAL]** settlement against open transactions, partial and over/under-payment: <https://learn.microsoft.com/dynamics365/finance/cash-bank-management/settlement-overview> | 2026-09-11 code |
| UNVERIFIED-65.30-D | CORE_NOW | ABSENT | Sales (AR) | None | As 65.30-C | None | No customer settlement exists; AR aging reads `paid_at` and ages from order creation date ([finance.routes.ts:619](../../backend/src/modules/finance/finance.routes.ts#L619)) | 2026-09-11 code |
| UNVERIFIED-65.30-E | CORE_NOW | PARTIAL | Sales (AR) + Cash and bank | Refund credits the `BANK` posting type automatically on return ([sales.routes.ts:707](../../backend/src/modules/sales/sales.routes.ts#L707)) | Refund = outgoing `CustomerPayment` direction in the WORK-034 model | None | Refund exists only inside the return path; no refund document, method, or approval | 2026-09-11 code |
| UNVERIFIED-65.30-F | CORE_LATER | ABSENT | Sales (AR) | None | **Add in WORK-034 at zero cost:** nullable `CustomerPayment.sales_order_id` (prepayment reserved against an order, per settlement overview above) | None | No prepayment behavior | 2026-09-11 code |
| UNVERIFIED-65.30-G | CORE_LATER | ABSENT | Sales (AR) | None | **Add in WORK-034 as unexposed hooks:** AR mirrors of `overpayment_policy`, tolerances, `writeoff_posting_type` ([schema.prisma:2708](../../backend/prisma/schema.prisma#L2708)) | Bad-debt tax treatment needs Bolivian validation | No write-off behavior | 2026-09-11 code |
| UNVERIFIED-65.30-H | OUT_OF_SCOPE | ABSENT | — | None | `NONE_REQUIRED` | — | Subscriptions, revenue recognition schedules, trade allowances, commissions, bills of exchange: not used by the anchor retailer | 2026-09-11 |

### 8.4 65.50 Manage credit and collections

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| UNVERIFIED-65.50-A | CORE_NOW (Kubi, 2026-09-11: simple limit + payment terms only) | ABSENT | Sales (AR section) for the check; Finance (Cash and bank) for the `PaymentTerms` master — [REC] | `Supplier.payment_terms Int` in days ([schema.prisma:868](../../backend/prisma/schema.prisma#L868)) must become a terms FK when touched (rule 4) | **MISSING — see §10 D-3** (credit limit + mode enum, `credit_limit_type` enum, message enum, checkpoints, `payment_terms_id`, `due_date` on open transactions) | Credit limit in the legal entity's accounting currency | `Customer` has no credit or terms fields ([schema.prisma:1691](../../backend/prisma/schema.prisma#L1691)); `Factura` has no due date ([:2312](../../backend/prisma/schema.prisma#L2312)). **[OFFICIAL]** basic pattern: credit limit type None/Balance/Balance+packing slip/Balance+All, Warning/Error, checkpoints at order/packing slip/invoice: <https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/credit-limits-customers>, <https://learn.microsoft.com/dynamics365/guidance/business-processes/pattern-manually-set-check-customer-credit-limits> | 2026-09-11 code |
| UNVERIFIED-65.50-B | CORE_LATER (deliberate behavior cut, Kubi 2026-09-11) | ABSENT | Sales (Credit and collections Setup) | None | See §10 D-3 | None | **[OFFICIAL]** credit management blocking rules, hold list, release reasons, groups, risk: <https://learn.microsoft.com/dynamics365/finance/accounts-receivable/cm-sales-order-credit-holds>, <https://learn.microsoft.com/dynamics365/finance/accounts-receivable/cm-credit-and-collections-overview> | 2026-09-11 |

### 8.5 60.20 Maintain inventory levels and Manage inventory costs

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| UNVERIFIED-60.20-A | CORE_NOW | PARTIAL | Inventory (InventoryParameters; posting profiles for gain/loss) | Reference `CNT-yyyy-count()+1` ([inventory-count.routes.ts:44](../../backend/src/modules/inventory/inventory-count.routes.ts#L44)) — race, bypasses `INVENTORY_ADJUSTMENT` sequence | Needs cost-layer link for negative differences (§10 D-4) | Inventory gain/loss has no IVA/IT effect — [ASSUMPTION] validate shrinkage tax treatment | Finalize overwrites stock with `counted_qty` in a non-transactional loop ([inventory-count.routes.ts:95](../../backend/src/modules/inventory/inventory-count.routes.ts#L95)), **posts no voucher and touches no cost layer**. ~~Line update has no role guard and no status check~~ — *Closed by WORK-029:* `inventory:count`, integer ≥ 0, tenant- and count-scoped, refused once FINALIZED. **[OFFICIAL]** posting a counting journal changes inventory level and value and generates ledger transactions: <https://learn.microsoft.com/dynamics365/supply-chain/inventory/tasks/count-inventory-warehouse> | 2026-09-11 code |
| UNVERIFIED-60.20-B | CORE_NOW | PARTIAL | Inventory | No reason code; a negative adjustment on a new stock row is clamped to 0 while the transaction records the full quantity ([inventory.routes.ts:108](../../backend/src/modules/inventory/inventory.routes.ts#L108)) | As 60.20-A | As 60.20-A | Manual adjust posts no GL and no cost layer ([inventory.routes.ts:83-133](../../backend/src/modules/inventory/inventory.routes.ts#L83)). **[OFFICIAL]** an inventory adjustment journal posts ledger transactions via the item group posting profile: <https://learn.microsoft.com/dynamics365/supply-chain/inventory/inventory-journals> | 2026-09-11 code |
| UNVERIFIED-60.20-C | CORE_NOW (transfer journal); CORE_LATER (transfer order with in-transit) | IMPLEMENTED_UNVERIFIED | Inventory | `TRANSFER` sequence unused; availability read outside the transaction ([inventory.service.ts:345](../../backend/src/modules/inventory/inventory.service.ts#L345)) | `NONE_REQUIRED` now (§10 D-10) | None | Atomic move of stock and FIFO layers ([inventory.service.ts:358](../../backend/src/modules/inventory/inventory.service.ts#L358)). **[OFFICIAL]** transfer journals move without cost effect and without in-transit: <https://learn.microsoft.com/dynamics365/supply-chain/inventory/inventory-journals>. No harness for `/inventory/transfers` | 2026-09-11 code |
| UNVERIFIED-60.20-D | OUT_OF_SCOPE | ABSENT | — | None | `NONE_REQUIRED` | — | Consignment and staging are not anchor-customer practices | 2026-09-11 |
| UNVERIFIED-60.xx-COST | CORE_NOW (perpetual FIFO integrity, Business Central model); CORE_NEXT (moving average); CORE_LATER (standard cost); OUT_OF_SCOPE (periodic weighted average, LIFO, D365 periodic inventory close) — decided 2026-09-11 | GAP (TEST: open layers 40,277 vs GL inventory 5,397 vs stock × `cost_price` 234,650) | Inventory (InventoryParameters, ItemModelGroup) | `costing_method` accepts `WEIGHTED_AVG`/`STANDARD` ([schema.prisma:2819](../../backend/prisma/schema.prisma#L2819)) but no COGS path reads it; COGS uses `Product.cost_price` in ERP ship, POS and returns | **MISSING (WORK-031):** nullable `InventoryTransaction.cost_layer_id` ([schema.prisma:578](../../backend/prisma/schema.prisma#L578) has none) — §10 D-4 | None | FIFO layers exist and are consumed ([inventory.service.ts:174](../../backend/src/modules/inventory/inventory.service.ts#L174)); the GL does not use their cost. **[OFFICIAL]** inventory close settles issues to receipts per the valuation method and locks earlier periods: <https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-close> | 2026-09-11 code |

### 8.6 Record to report

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| UNVERIFIED-90.xx-DIM | CORE_NOW | VERIFIED (posting); reporting is 90.70-A | Finance | Manual journals have no dimension picker ([finance.routes.ts:228](../../backend/src/modules/finance/finance.routes.ts#L228)) | Existing four slots, rules and defaults ([schema.prisma:2153](../../backend/prisma/schema.prisma#L2153), [:2253](../../backend/prisma/schema.prisma#L2253), [:2295](../../backend/prisma/schema.prisma#L2295)) | None | Resolved centrally in `postJournal`; sales/POS pass the order context ([sales.routes.ts:339](../../backend/src/modules/sales/sales.routes.ts#L339), [pos.routes.ts:346](../../backend/src/modules/pos/pos.routes.ts#L346)); STORE required on revenue/COGS. Historical `verifyFinancialDimensions` 25/25, `verifySalesDimensionsLive` 9/9 ([HANDOVER.md:1627](../../HANDOVER.md#L1627), [:1006](../../HANDOVER.md#L1006)) | 2026-08-17/18 execution; 2026-09-11 code |
| UNVERIFIED-90.60-A | CORE_NOW | GAP | Finance | None | Needs D-4 hook to reconcile inventory | None | No subledger-to-GL reconciliation exists; by construction the inventory GL cannot reconcile (§8.5), AR GL is overstated by POS (§8.1), AP aging reads the wrong source ([finance.routes.ts:595](../../backend/src/modules/finance/finance.routes.ts#L595)) | 2026-09-11 code |
| UNVERIFIED-90.60-B | CORE_NOW | PARTIAL | Finance (FinanceParameters) | Period derived with server-local `getFullYear/getMonth` ([journal.service.ts:178](../../backend/src/shared/services/journal.service.ts#L178)) | `status` is a string ([schema.prisma:2396](../../backend/prisma/schema.prisma#L2396)); `ON_HOLD` / `PERMANENTLY_CLOSED` are additive values — `NONE_REQUIRED` | Bolivian closing rules need validation | Close/reopen per calendar month, admin only ([finance.routes.ts:765](../../backend/src/modules/finance/finance.routes.ts#L765)); every `postJournal` writer is gated with `allow_posting_to_closed_period` ([journal.service.ts:171](../../backend/src/shared/services/journal.service.ts#L171)). Reopen erases `closed_by/closed_at` ([finance.routes.ts:788](../../backend/src/modules/finance/finance.routes.ts#L788)) — history lost. **[OFFICIAL]** prefer *On hold*; permanently closed cannot reopen: <https://learn.microsoft.com/dynamics365/finance/general-ledger/close-general-ledger-at-period-end> | 2026-09-11 code |
| UNVERIFIED-90.60-C | CORE_NOW (before the first fiscal year-end after go-live) | ABSENT | Finance | Balance sheet shows all-time P&L as "Current Year Earnings" ([finance.routes.ts:727](../../backend/src/modules/finance/finance.routes.ts#L727)) | `NONE_REQUIRED` now — §10 D-11 | Fiscal year-end date by legal form — [ASSUMPTION] validate | No fiscal-year model or closing voucher. **[OFFICIAL]** year-end close transfers P&L to retained earnings and opens balances: <https://learn.microsoft.com/dynamics365/finance/general-ledger/year-end-close> | 2026-09-11 code |
| UNVERIFIED-90.60-D | CORE_NOW | PARTIAL | Finance | Statements classify by `Account.type`, not `category`; bank reconciliation looks up code literal `'1101'` ([finance.routes.ts:809](../../backend/src/modules/finance/finance.routes.ts#L809)) | None | IVA net report resolves by category ([finance.routes.ts:522](../../backend/src/modules/finance/finance.routes.ts#L522)) — keep | Trial balance has no date/period filter and loads every line into memory ([finance.routes.ts:480](../../backend/src/modules/finance/finance.routes.ts#L480)); P&L/BS exist ([:642](../../backend/src/modules/finance/finance.routes.ts#L642), [:687](../../backend/src/modules/finance/finance.routes.ts#L687)) | 2026-09-11 code |
| UNVERIFIED-90.60-E | CORE_NOW | ABSENT | Finance | — | Covered by WORK-024/027 | BCB rate type (Kubi, 2026-09-11) | Planned as WORK-027 | 2026-09-11 |
| UNVERIFIED-90.60-F | OUT_OF_SCOPE (ledger settlement); CORE_LATER (consolidation, multi-entity) | ABSENT | Finance | — | Existing nullable `legal_entity_id` on parameters/sequences; `journal_entries` has none (WORK-023 deferral) | — | Not needed for a single legal entity | 2026-09-11 |
| UNVERIFIED-90.70-A | CORE_NOW | GAP | Finance | None | Existing dimension slots make this a query | None | No report filters or groups by dimension — the STORE axis Kubi required on 2026-08-18 is posted but not reportable | 2026-09-11 code |

### 8.7 Cross-cutting rows extended by this slice

| catalog_id | scope_status | implementation_status | parameter_owner | hard_coding_debt | schema_hook | localization_effect | repo and acceptance evidence | last_verified_at |
|---|---|---|---|---|---|---|---|---|
| 99.20.040.000 (O2C/inventory part) | CORE_NOW | PARTIAL | Owning module; shared allocator | SO, shipment (`Date.now`), count (`count()+1`) generators bypass the allocator; `CREDIT_NOTE`, `INVENTORY_ADJUSTMENT`, `TRANSFER` references exist but are unused | Existing `SequenceReference` values ([numberSequence.service.ts:59](../../backend/src/shared/services/numberSequence.service.ts#L59)); add `SHIPMENT`, `CUSTOMER_PAYMENT`, `SALES_RETURN` when those documents are built | FACTURA stays continuous and allocated inside the posting transaction | Allocator integration and PO numbering evidenced in §3; the O2C and inventory generators are folded into WORK-031, WORK-032, and WORK-036 | 2026-09-11 code |
| 99.25.050.000 (O2C/inventory/finance part) | CORE_NOW | PARTIAL | Security | **WORK-030a:** sales orders, quotations, CRM, customers and POS on an exported permission manifest with the guard first (51 routes), the three storefront-shared product reads on `anyOf`, and a permanent workforce gate that confines `customer` and unknown roles to a five-route storefront surface ([workforceGate.ts](../../backend/src/shared/middleware/workforceGate.ts)). Still open: inventory, warehouse, product writes, uom and import (030b); finance, reports, setup, HR and audit (030c) — contained for customers by the gate, still `requireRole` or unguarded for workforce roles. Store managers create DRAFT journals only; posting is admin (premise corrected in the WORK-030 design) | Design `docs/process/WORK-030_O2C_PERMISSION_REGISTRY.md`; no schema hook needed | Financial data must not cross tenants — the `/sales/:id/complete` defect is closed by WORK-029 | `o2cContainment.test.ts`; `o2cRoutePermissions.test.ts`; `storefrontContainment.test.ts`; `verify:o2c-containment` 12/12 and `verify:o2c-permissions` 32/32 on TEST | 2026-09-13 code, tests, TEST smoke |

## 9. Prioritized findings (O2C, Inventory, R2R)

1. **[REPO-VERIFIED] Tenant-isolation defect:** `POST /sales/:id/complete` wrote any tenant's order
   by id. *Closed by WORK-029 (2026-09-11).*
2. **[REPO-VERIFIED] POS sales leave AR open and cash unposted**
   ([pos.routes.ts:348](../../backend/src/modules/pos/pos.routes.ts#L348)); the AR control balance is
   overstated by POS revenue. Confirmed on TEST read-only: AR GL 9,107 against 130 open. Open;
   WORK-033.
3. **[REPO-VERIFIED] POS deducted stock from any warehouse:** three-store on-hand was wrong wherever
   stores sold the same variant. *Closed by WORK-029 (2026-09-11).*
4. **[REPO-VERIFIED] Inventory GL and subledger diverge by design:** COGS at `cost_price` (ERP ship,
   POS, return), no GL on count/adjust, sales price stored as issue `unit_cost`.
5. **[REPO-VERIFIED] AR is a timestamp:** no open transactions, partial payment, settlement, due
   date, or aging by due date; AP aging still reads the retired PO-payment field.
6. **[REPO-VERIFIED] Shipment is whole-order, non-atomic, line-less; invoicing is one-per-order**
   even though `FacturaLine` supports partial invoicing.
7. **[REPO-VERIFIED] No year-end close;** the balance sheet treats all history as current-year earnings.
8. **[ASSUMPTION NEEDING VALIDATION]** Bolivian credit-note series and reference rules, line-detail
   requirement on facturas, inventory shrinkage tax treatment, and the fiscal year-end date for the
   tenant's legal form. Learn cannot decide them.

## 10. Deferred capabilities — schema hooks

Hook decisions follow CLAUDE.md §3. "Additive" means: a nullable column, a column with a constant
default (metadata-only in PostgreSQL 11+), a new enum value in a string column, or a new table —
none requires backfilling historical rows with derived data.

### D-1 — Full purchase-order workflow / approval engine (75.40.050.000 stays PARTIAL)

- **D365 anatomy [OFFICIAL]:** with change management, approval status runs Draft → In review →
  Rejected/Approved → Confirmed → Finalized; approved orders need *Request change*; re-approval
  rules decide which changes need workflow; each confirmation creates a journal that preserves the
  confirmed version:
  <https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-order-approval-confirmation>.
- **Exists today [REPO-VERIFIED]:** `PurchaseOrder.status` string and `confirmed_at`
  ([schema.prisma:900](../../backend/prisma/schema.prisma#L900), [:909](../../backend/prisma/schema.prisma#L909));
  immutable `PurchaseOrderChange` snapshots ([:1032](../../backend/prisma/schema.prisma#L1032)),
  written today only for cancellation and delivery updates
  ([purchaseOrderChange.service.ts:173](../../backend/src/modules/purchase/purchaseOrderChange.service.ts#L173),
  [:252](../../backend/src/modules/purchase/purchaseOrderChange.service.ts#L252)); the separate
  approval-axis precedent `VendorPayment.approval_status`
  ([:1399](../../backend/prisma/schema.prisma#L1399)); requisition approval parameters
  ([:2793](../../backend/prisma/schema.prisma#L2793)).
- **Hook: `NONE_REQUIRED`.** A later `approval_status` column defaults to `NOT_REQUIRED`, which is
  true for every existing row; workflow instances, reapproval rules, and versions are new tables;
  existing orders are version 1.
- **Two binding rules instead [REC]:** (1) approval states must never be added to
  `PurchaseOrder.status` — receipt, invoice, and cancellation guards key on it; (2) confirmation
  should write a `PurchaseOrderChange` row (`action = CONFIRMED`, full snapshot). This is behavior,
  not schema, but it is the one piece of history that cannot be recreated later. Fold it into the
  next item that touches PO confirmation (WORK-026).

### D-2 — One-step supplier payment correction (75.50.120.000 stays PARTIAL)

- **D365 anatomy [OFFICIAL]:** payments are reversed with a date and reason, optionally through a
  reviewed reversal journal; settled payments must be unsettled first; closed periods require a
  new date:
  <https://learn.microsoft.com/dynamics365/finance/accounts-payable/reverse-vendor-payment>,
  <https://learn.microsoft.com/troubleshoot/dynamics-365/finance/general-ledger/cant-reverse-transactions>.
- **Exists today [REPO-VERIFIED]:** unique reversal links on payment, open transaction, and
  settlement ([schema.prisma:1400](../../backend/prisma/schema.prisma#L1400),
  [:1427](../../backend/prisma/schema.prisma#L1427), [:1467](../../backend/prisma/schema.prisma#L1467));
  `reversal_approval_policy NONE | REQUIRED` ([:2712](../../backend/prisma/schema.prisma#L2712)) and
  `approval_status` ([:1399](../../backend/prisma/schema.prisma#L1399)) already express the review
  step.
- **Hook: `NONE_REQUIRED`.** The wizard is a transaction composing existing reversal and payment
  creation. A nullable `VendorPayment.replaces_payment_id` can be added with the wizard; corrections
  made before then stay unlinked but fully traceable through the reversal reason and chain.
- **Carry-forward obligation:** the AR payment model (WORK-034) must include the same three reversal
  links from its first migration. That is a design requirement of a new model, not a retrofit.

### D-3 — Full credit and collections (only simple limit + terms in scope)

- **D365 anatomy [OFFICIAL]:** basic pattern — per-customer credit limit, credit limit type
  (None / Balance / Balance + packing slip / Balance + All), mandatory flag, Warning/Error, checks
  at order, packing slip, invoice
  (<https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/credit-limits-customers>).
  Full credit management adds blocking/exclusion rules, a hold list with reasons and release
  reasons, forced holds, credit groups, risk scores, temporary limits, and workflow
  (<https://learn.microsoft.com/dynamics365/finance/accounts-receivable/cm-sales-order-credit-holds>).
  A 0.00 limit means *no credit* under credit management but *unlimited* without it
  (<https://learn.microsoft.com/dynamics365/finance/accounts-receivable/credit-hold-faq>).
- **Exists today [REPO-VERIFIED]:** nothing on `Customer`
  ([schema.prisma:1691](../../backend/prisma/schema.prisma#L1691)); `Supplier.payment_terms Int`
  ([:868](../../backend/prisma/schema.prisma#L868)); `VendorInvoice.due_date`
  ([:1193](../../backend/prisma/schema.prisma#L1193)) but no `due_date` on `VendorOpenTransaction`
  ([:1420](../../backend/prisma/schema.prisma#L1420)); no due date on `Factura`
  ([:2312](../../backend/prisma/schema.prisma#L2312)).
- **Hooks — MISSING, required:**
  1. `due_date` snapshot on `CustomerOpenTransaction` (WORK-034) and on `VendorOpenTransaction`
     (WORK-034 or WORK-026). Days-overdue rules, aging, and collections all derive from it; it
     cannot be recomputed once terms change.
  2. `PaymentTerms` master with a due-date method enum, `payment_terms_id` on `Customer` and
     `Supplier`, and a snapshot on the order/invoice header (WORK-035). D365's "payment terms
     increased" rule needs terms on the order. Remediates `Supplier.payment_terms Int` (rule 4).
  3. `Customer.credit_limit` (accounting currency) plus `credit_limit_mode` enum
     `NONE | LIMITED | UNLIMITED` — never 0-means-unlimited (WORK-035).
  4. Sales/AR parameters: `credit_limit_type` enum `NONE | BALANCE | BALANCE_PLUS_DELIVERED |
     BALANCE_PLUS_ALL`; `credit_limit_message` enum `WARNING | ERROR`; checkpoint enum set
     `ORDER_CONFIRM | SHIPMENT | INVOICE` (WORK-035).
- **Hooks — `NONE_REQUIRED`:** hold list (future `sales_order_credit_holds` table), credit groups,
  risk scores, temporary/expiring limits, and collection activities and letters are all additive.
  **Binding rule [REC]:** the simple check runs through one checkpoint function so blocking rules
  replace it later; do not add an `on_credit_hold` boolean to `SalesOrder`.

### D-4 — Periodic inventory close / recalculation (new; OUT_OF_SCOPE recommendation)

- **D365 anatomy [OFFICIAL]:** inventory close settles issues against receipts per valuation method
  and locks earlier periods; recalculation adjusts without closing:
  <https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-close>,
  <https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq>.
- **Decision (2026-09-11):** keep perpetual FIFO over `InventoryCostLayer` on the Business Central
  item-application model
  (<https://learn.microsoft.com/dynamics365/business-central/design-details-costing-methods>); do not
  build a D365-style close. Moving average (no close needed) is CORE_NEXT; standard cost is
  CORE_LATER.
- **Further WORK-031 hooks (decided 2026-09-11):** an `InventoryCostSettlement` consumption record,
  `InventoryTransaction.cost_amount`, layer `original_quantity` and cost-object scope, a `cost_level`
  enum (SITE recommended; Finance co-founder to confirm), an append-only `ItemCostPrice`, an
  `InventoryCostBalance`, and variance/adjustment posting types. WORK-024 adds the
  accounting-currency basis to cost fields.
- **Hook — MISSING, add in WORK-031:** nullable `InventoryTransaction.cost_layer_id`. `fulfillOrder`
  already writes one transaction per consumed layer
  ([inventory.service.ts:186](../../backend/src/modules/inventory/inventory.service.ts#L186)).
  Without the link, issue-to-receipt settlement, COGS audit per layer, and any later move to
  weighted average or a periodic close cannot be reconstructed for history.
- **Fail-closed rule:** refuse `costing_method` other than `FIFO` until implemented
  ([schema.prisma:2819](../../backend/prisma/schema.prisma#L2819)).

### D-5 — Sales order change management / approval

`NONE_REQUIRED`, same reasoning as D-1. Apply the same rule: never encode approval in
`SalesOrder.status`.

### D-6 — Customer prepayments

Add nullable `CustomerPayment.sales_order_id` in WORK-034 (costs nothing now; D365 reserves a
prepayment against the order —
<https://learn.microsoft.com/dynamics365/finance/cash-bank-management/settlement-overview>).

### D-7 — Write-off, cash discounts, over/underpayment

Add unexposed AR parameter mirrors of the AP fields
([schema.prisma:2708](../../backend/prisma/schema.prisma#L2708)) and a settlement-kind discriminator
on `CustomerSettlement` in WORK-034.

### D-8 — RMA with disposition codes and replacement orders

In WORK-037:
- a `disposition` enum `CREDIT | CREDIT_ONLY | SCRAP | REPLACE_AND_CREDIT | REPLACE_AND_SCRAP |
  RETURN_TO_CUSTOMER` (only `CREDIT` and `CREDIT_ONLY` get behavior at first);
- nullable `return_reason_code` and `replacement_order_id`.

Source: <https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/sales-returns>.

### D-9 — Separate credit-note legal series

Hook exists: the `CREDIT_NOTE` sequence reference
([numberSequence.service.ts:61](../../backend/src/shared/services/numberSequence.service.ts#L61)).
The switch is a one-word change plus a sequence row once Bolivian law is confirmed.

### D-10 — Transfer orders with in-transit between stores

`NONE_REQUIRED` now. The `TRANSFER` sequence reference and `reference_type = 'transfer'` exist; the
header/lines and an in-transit warehouse are additive.

### D-11 — Year-end close and closing period

`NONE_REQUIRED` now:
- a `RETAINED_EARNINGS` category exists ([accountCategory.ts:57](../../backend/src/shared/services/accountCategory.ts#L57));
- a closing voucher can be marked through `source_module`;
- a later `JournalEntry.period_kind` (`OPERATING | OPENING | CLOSING`) defaults to `OPERATING` for
  all history;
- a fiscal-calendar table can map calendar months additively.

### D-12 — Period statuses On hold / Permanently closed and reopen history

The string status takes new values additively. A reopen-history table is additive, **but the reopen
route erases evidence today** ([finance.routes.ts:788](../../backend/src/modules/finance/finance.routes.ts#L788)).
That is a behavior fix for WORK-038, not a hook.

### D-13 — Unit-of-measure conversions (buy boxes, sell pairs)

Sales, stock, transaction, cost-layer, and count quantities are `Int`
([schema.prisma:1803](../../backend/prisma/schema.prisma#L1803), [:589](../../backend/prisma/schema.prisma#L589),
[:654](../../backend/prisma/schema.prisma#L654)), while PO lines are `Decimal`
([:959](../../backend/prisma/schema.prisma#L959)). Widening `Int` to `Decimal` later is lossless, so
`NONE_REQUIRED`. Record the inconsistency; do not widen speculatively.

## 11. Implementation queue (WORK-029 to WORK-041)

WORK-029 ran before WORK-024. **WORK-024 is complete and accepted on TEST, 2026-09-12: 024a (currency
master, ledger currencies, parametric P2P guards, migration 032) and 024b (voucher
transaction/accounting/reporting amounts, migration 033, ledger ordinal 33).** The remaining order is
WORK-025b (the frontend half of the literal sweep; **025a is done and accepted on TEST, 2026-09-12:
sales, POS, CRM and quotation currency resolution, the sales-side posting guard, the supplier
mass-assignment fix, the tenant currency mirror dropped and the chart of accounts selected by country,
migration 034**) → 026 → 027 → 030 → 031 → 032 → 034 → 033 → 035 → 036
→ 037 → 038 → 039 → 040 → 041, respecting the dependencies below.

Every item carries worklog §4.1, its catalog IDs, the Bolivia regression set (continuous FACTURA
with no gap under injected failure; Bs 1 299,00 → IVA 168,87 and IT 38,97 on invoice, POS, and a
negated credit note — [HANDOVER.md:1702](../../HANDOVER.md#L1702); IT sales-only), `tenant_id` in
every new uniqueness constraint, and — when a migration exists — isolated rebuild, empty Prisma
drift, and a repeat no-op.

| # | Title | Catalog IDs | Size | Depends on |
|---|---|---|---|---|
| WORK-029 | **DONE (`e4e642e`, accepted locally and on TEST 2026-09-11).** O2C containment: tenant filter on `/complete`; POS stock deducted only from the session warehouse; count-line role guard and FINALIZED lock; POS and customer route guards; foreign-reference validation | UNVERIFIED-65.20-A/B, UNVERIFIED-60.20-A, 99.25.050.000 | S | none |
| WORK-030 | O2C, inventory, and finance permission registry and route conversion (mirror WORK-016), including customer master | 99.25.050.000, 99.25.060.000, 65.20, 65.30, 60.20, 90.50 | M | WORK-029 |
| WORK-031 | Cost integrity: COGS from consumed layers (ERP ship + POS); `InventoryTransaction.cost_layer_id`; issue `unit_cost` = cost; atomic shipment; FIFO-only fail-closed; the D-4 hooks; POS deduction/restore concurrency guards; live TEST harness `verify:cogs-layers` | UNVERIFIED-60.xx-COST, UNVERIFIED-60.40-D, UNVERIFIED-65.20-B, 90.50.040.000 | L | WORK-029 |
| WORK-032 | Count and adjustment posting: transactional, GL via posting profiles, cost-layer effect, `INVENTORY_ADJUSTMENT` numbering, reason codes; harness | UNVERIFIED-60.20-A/B, 99.20.040.000 | M | WORK-031 |
| WORK-033 | POS settlement (hybrid, D365 Commerce statement pattern): payment method → offset account per store/legal entity; cash/card debited directly, customer-account tender to AR; counted-cash declaration posts over/short to `CASH_DIFFERENCE`; correction for historical POS AR as a separate Finance-approved journal | UNVERIFIED-65.20-B, UNVERIFIED-65.30-C | M | WORK-024, WORK-034 |
| WORK-034 | AR foundation: customer payment methods, `CustomerOpenTransaction` / `CustomerPayment` / `CustomerSettlement` with reversal links, `due_date`, prepayment/write-off hooks; AR and AP aging from open transactions (AP aging fix); invoice creates the open transaction; harness `verify:customer-payment` | UNVERIFIED-65.30-C/D/E/F/G, 75.50.090.000 (aging) | L | WORK-024, WORK-030 |
| WORK-035 | Shared payment terms master owned by Finance (method `NET`, `CURRENT_MONTH`, or `COD` plus days; cash-discount, `base_date_source`, and payment-schedule hooks; document snapshot) and simple credit limit check (enums per D-3); `Supplier.payment_terms` remediation | UNVERIFIED-65.50-A, 75.50.020.000 | M | WORK-034 |
| WORK-036 | Shipment lines / packing slip, partial delivery, `delivered_qty`, `SHIPMENT` sequence, partial invoicing from delivered lines (remove the one-invoice-per-order guard) | UNVERIFIED-60.40-D, UNVERIFIED-65.30-A, 99.20.040.000 | L | WORK-031, WORK-034 |
| WORK-037 | Customer returns and line-based credit notes: return document, disposition enum, `credits_factura_line_id`, cost-layer restore at original issued cost, refund as outgoing customer payment; credit-note series, original-invoice reference, and maximum age as jurisdiction parameters (D-9) | 65.20.400.000, UNVERIFIED-65.30-B/E | L | WORK-034, WORK-036 |
| WORK-038 | Period close hardening and year-end close: ON_HOLD, reopen history, UTC/tenant-timezone period derivation, closing voucher to RETAINED_EARNINGS, balance-sheet earnings split | UNVERIFIED-90.60-B/C | M | WORK-024 |
| WORK-039 | Financial statements and reconciliation: TB/P&L/BS by period and category, store P&L by dimension, subledger-to-GL reconciliation (inventory, AR, AP) | UNVERIFIED-90.60-A/D, UNVERIFIED-90.70-A | M | WORK-031, WORK-034, WORK-038 |
| WORK-040 | Inventory transfer document with numbering and optional in-transit (only if Kubi confirms inter-store transfers need tracking) | UNVERIFIED-60.20-C | M | WORK-031 |
| WORK-041 | Per-line tax engine (Turkey/EU readiness; outside Bolivia go-live) | 65.30, 75.50.020.000 | L | WORK-034, WORK-036 |

The PO confirmation snapshot (D-1) is folded into WORK-026; SO and count number sequences are
folded into WORK-031, WORK-032, and WORK-036.

## 12. Decisions — resolved 2026-09-11

Full reasoning and sources: worklog entry "Decisions — O2C posting, costing, localization, payment
terms, partial invoicing — 2026-09-11".

1. **WORK-029 ahead of WORK-024:** yes; done.
2. **POS payment posting:** hybrid on the D365 Commerce statement pattern. Cash and card tenders
   debit the payment-method account; only a customer-account tender debits AR
   (<https://learn.microsoft.com/dynamics365/commerce/retail-statements>).
3. **Costing:** perpetual FIFO (Business Central model) now, moving average next, standard cost
   later; no periodic inventory close.
4. **Localization is jurisdiction data:** credit-note series, original-invoice reference, maximum
   age, line-detail flag (default on), structured shrinkage tax treatment, and a per-legal-entity
   fiscal calendar. Bolivian retail year-end is 31 December (DS 24051 Art. 39).
5. **Payment terms:** one shared master owned by Finance (Cash and bank); customers and vendors hold
   defaults, documents keep a snapshot.
6. **Partial delivery and partial invoicing:** go-live scope for all channels (WORK-036); POS keeps
   its one-step fast path.
7. **AP aging fix:** WORK-034.

**Still open (external validation):**

- Finance co-founder: FIFO invoice price-difference treatment; cost level.
- Bolivian accountant: credit-note series and CUF reference; shrinkage input-VAT reversal; FIFO and
  average-cost acceptance. Turkish accountant: iade faturası model and costing acceptance.
- Catalog IDs: replace every `UNVERIFIED-*` placeholder from the JUL-2026 workbook before this
  extension is treated as governed.
