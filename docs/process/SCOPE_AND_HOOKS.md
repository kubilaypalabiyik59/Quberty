# Scope Decision — Now vs Later, with Mandatory Extension Hooks

**Phase 3 deliverable.** Depends on [GAP_ANALYSIS.md](GAP_ANALYSIS.md).

**Decision rule:** judged by SME reality, not D365 completeness. The test is
*"would a three-store shoe retailer in Bolivia actually use this?"* — never *"does D365 have it?"*

**Non-negotiable:** every deferral carries a documented schema hook, or an explicit statement that
none is needed.

---

## 1. NOW — implement in this phase

| # | Capability | Why it cannot wait |
|---|---|---|
| 1 | **Fix the live posting defects (D-1…D-6)** | Books are wrong today. Nothing else matters until POS sales post revenue. |
| 2 | **Product dimension framework** | The variant is the stocking unit for shoes. **[OFFICIAL]** a product cannot be converted between variant models after implementation. Every day of transactions deepens the migration. |
| 3 | **Variant FKs on all transaction lines** | Referential integrity is being violated now; orphans must be prevented before they accumulate. |
| 4 | **Financial dimensions (Store axis minimum)** | Three physical stores, no per-store P&L. Unbackfillable — the store attribution of a past transaction is unrecoverable. |
| 5 | **Posting profiles** | Precondition for fixing D-1/D-2 properly rather than patching literals. |
| 6 | **Tax codes + tax groups** | Precondition for correct IT handling on POS (D-3) and for line-level tax on the factura. |
| 7 | **Product receipt + vendor invoice as entities** | Receipts cannot be reconstructed retroactively; without them three-way matching is permanently unavailable. |
| 8 | **Payment / settlement entity (AR + AP)** | `paid_at` loses amount, date, method and bank reference. Those are not recoverable from a timestamp. |
| 9 | **Invoice lines (`FacturaLine`)** | Line-level tax, credit notes and partial invoicing all hang off it. Possibly a compliance requirement. |
| 10 | **Line-level quantity accumulators** (`delivered_qty`, `invoiced_qty`) | Partial delivery is a daily reality; header booleans cannot express it. |
| 11 | **Tenant-scope every unique constraint** | Trivial now, blocks the entire SaaS thesis later. |
| 12 | **Unified atomic document numbering** | Fixes D-5 and is the foundation the deferred documents plug into. |
| 13 | **Returns / credit note** | For shoe retail, size exchanges are a primary flow, not an exception. |

Items 2–6 are the four cross-cutting foundations plus product dimensions — designed in
[FOUNDATIONS.md](../architecture/FOUNDATIONS.md).

---

## 2. LATER — deferred, with required hooks

| Deferred capability | Why deferred | Schema hook required today | What breaks if we skip the hook |
|---|---|---|---|
| **Purchase requisition** | A 3-store retailer has no internal approval chain; the owner decides | `PurchaseOrder.source_document_type` (enum, default `DIRECT`) + `source_document_id` (nullable UUID) | Without it, retrofitting means every historical PO has an unknown origin and the PR→PO conversion audit trail cannot be reconstructed. Adding the column later is cheap; **the enum value is the hook** — a plain boolean `is_from_requisition` would have to be replaced. |
| **RFQ / bidding** | No competitive bidding at this scale | Same `source_document_type` enum — add value `RFQ` when built | Nothing extra. The hook above covers it. |
| **Purchase agreement / blanket order** | No volume commitments | Same enum + `PurchaseOrderLine.agreement_line_id` (nullable UUID) | Without the line-level FK, consumption against a commitment cannot be traced and agreement fulfilment cannot be computed from history. |
| **Quotation → order conversion** | Retail sells across a counter; quotes are rare but will matter for the B2B/wholesale segment | `SalesOrder.source_document_type` + `source_document_id` (mirrors the PO hook) | Same reasoning: order provenance is unrecoverable later. |
| **Lead / opportunity (Prospect to Quote)** | Full CRM is a different product | **None needed.** Leads attach to `Customer`, which already exists, and to the quotation, which itself has a hook. | — |
| **Credit limit + collections / dunning** | The anchor customer sells for cash | `Customer.credit_limit` (nullable Decimal) + `payment_terms_days` (nullable Int) | Not strictly a hook — both are additive nullable columns with no historical dependency. Included because they cost nothing and unblock the AR aging report. |
| **Landed cost (freight, duty)** | Meaningful only once import volume justifies it — **but see the warning below** | `InventoryBatch.landed_cost_adjustment` (Decimal, default 0) **and** a `CostAdjustment` table keyed to the batch | **This is the highest-risk deferral in the list.** Inventory value and COGS are computed from `unit_cost`. If landed cost is added later without the adjustment column existing, historical inventory valuation is wrong and cannot be restated — you would be revaluing closed accounting periods. **[REC] Reconsider deferring this at all** if the business imports. |
| **Multi-currency + exchange rates** | Single-currency (BOB) today | `Currency` table + `ExchangeRate` table + `exchange_rate` and `amount_in_functional_currency` on every monetary document header | Without the functional-currency amount stored **at transaction time**, historical reporting cannot be restated when rates change. This is a classic unrecoverable-data deferral. |
| **Item model group (costing method choice)** | FIFO is correct for footwear and unlikely to change | `Product.item_model_group_id` (nullable UUID) + an `ItemModelGroup` table with a single seeded `FIFO` row | Without it, a customer needing weighted-average forces a per-product code branch. With it, the change is configuration. Cheap now. |
| **Warehouse advanced execution (loads, cross-docking, TMS)** | Wave/work already exceeds SME need | **None needed.** `WarehouseWork.reference_type`/`reference_id` [schema:438-439](../../backend/prisma/schema.prisma#L438-L439) is already a generic polymorphic anchor. | — |
| **Plan to Produce (70)** | **[OFFICIAL]** *"a retailer might mark the entire Plan to Produce process as 40-Not Applicable because they don't manufacture products"* | **None needed.** Production consumes the item master and inventory, both of which exist. BOM/route/production-order are pure additions with no back-reference into existing rows. | — |
| **Forecast to Plan (50)** | No planning need at 3 stores | **None needed** beyond what item 2 and item 4 already deliver. Forecasting consumes transaction history at variant + dimension granularity — which is exactly what the NOW list establishes. | — |
| **Acquire to Dispose (10) — fixed assets** | Marginal at this size | **None needed.** Depends on posting profiles + financial dimensions, both in the NOW list. Fixed-asset tables are additive. | — |
| **Vendor rebates, chargebacks, debit memos** | Not a retail-scale concern | **None needed.** All are documents that reference a vendor invoice — which the NOW list creates. | — |
| **Encumbrance / pre-encumbrance** | Public-sector pattern | **None needed.** `JournalEntry.source_module` [schema:825](../../backend/prisma/schema.prisma#L825) already accepts arbitrary source types. | — |
| **Withholding tax (LATAM)** | Not applicable to this taxpayer type yet | `TaxCode.tax_type` enum must include `WITHHOLDING` from the start; `TaxCode.is_recoverable` boolean | Without the enum value, withholding gets modelled as a discount or a manual journal, and the tax reports become unreconcilable. **[OFFICIAL]** the July 2026 catalog added LATAM withholding tax content to Record to Report — this will become relevant. |
| **Multi-company / legal entity** | One legal entity today | **[REC] None — and resist adding one.** `tenant_id` is the isolation boundary. A premature `legal_entity_id` on every table doubles the scoping burden for a capability that may never be needed. If a tenant ever needs two legal entities, provisioning a second tenant is an acceptable answer at this market segment. |

---

## 3. Deferrals that genuinely need no hook — stated explicitly

Per the brief, symmetry is not a reason to invent a hook. These need nothing:

- Lead / opportunity
- Loads, cross-docking, transportation management
- Plan to Produce
- Forecast to Plan
- Fixed assets
- Vendor rebates / chargebacks / debit memos
- Encumbrance
- Multi-company (deliberately declined)

The common property: each is a **purely additive** capability that reads existing master data and
writes new tables, with no back-reference that would need populating on historical rows.

---

## 4. Deferrals I recommend against — [REC]

Flagged because deferring these looks cheap and is not.

| Capability | Stated reason to defer | Why I disagree |
|---|---|---|
| **Landed cost** | "Low volume today" | Inventory valuation and COGS are computed from it. A later addition cannot restate closed periods. If the business imports shoes — and it does — freight and duty are a material share of unit cost, so today's margins are already misstated. |
| **Multi-currency** | "Everything is in BOB" | Suppliers are likely foreign. `Supplier.currency` already defaults to `BOB` while `PurchaseOrder.currency` defaults to **`TRY`** ([schema:545](../../backend/prisma/schema.prisma#L545)) — the schema is already inconsistent about this. The functional-currency amount must be stored at transaction time or history is unrecoverable. |
| **Line-level tax** | "One rate for everything" | Bolivia has exempt and zero-rated categories. The moment one product is exempt, header-level tax is wrong for the whole invoice, and past invoices cannot be recomputed because the rate applied per line was never recorded. |

---

## 5. Sequencing within NOW — [REC]

Ordered by dependency, not by value.

| Step | Work | Blocks |
|---|---|---|
| 0 | **Fix D-1…D-6.** Reconcile the two COAs, make posting failures fatal, propagate atomic numbering. | Everything — the books are wrong now |
| 1 | Tenant-scope unique constraints (item 11) | Independent; do it first, it is nearly free |
| 2 | Product dimension framework + variant FKs (2, 3) | Inventory, costing, all transaction lines |
| 3 | Financial dimensions (4) | All posting |
| 4 | Posting profiles (5) | Replacing the hardcoded literals |
| 5 | Tax codes + groups (6) | Factura lines, POS IT fix |
| 6 | Document numbering unification (12) | Product receipt, vendor invoice, credit note |
| 7 | Product receipt + vendor invoice (7) | Three-way match, AP aging |
| 8 | Payment / settlement (8) | AR/AP aging, partial payment |
| 9 | Invoice lines + line accumulators (9, 10) | Partial delivery/invoicing |
| 10 | Returns / credit note (13) | Depends on 9 |

Steps 0 and 1 are days. Steps 2–5 are the real work and are what
[FOUNDATIONS.md](../architecture/FOUNDATIONS.md) designs.

**[REC] P2P before O2C for implementation**, as originally proposed — O2C is the live revenue path
(POS + facturas in production) and should be touched only once the foundations are proven inbound.
The exception is step 0: the POS revenue defect is in the live path and cannot wait its turn.
