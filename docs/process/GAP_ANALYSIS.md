# Gap Analysis — Skarpine vs D365 Reference Model

**Phase 2 deliverable.** Everything here is **repo-verified** with `file:line`, or labelled
otherwise. Reference model: [P2P_REFERENCE.md](P2P_REFERENCE.md) · [O2C_REFERENCE.md](O2C_REFERENCE.md).

Gap types: `MISSING-ENTITY` · `MISSING-STATE` · `MISSING-POSTING` · `MISSING-CONFIG` ·
`STRUCTURALLY-WRONG`.

---

## 0. Live defects found during analysis — read this first

These are not architecture gaps. They are **defects in code that is running now**. They were found
while tracing posting logic and are reported here because the gap analysis is what surfaced them.

### D-1 · Two incompatible charts of accounts exist — CRITICAL

There are two COA definitions that assign **different codes to the same account**:

| Account | `bolivia-pcg.json` (template) | `finance.routes.ts` (seed) |
|---|---|---|
| Cuentas por Cobrar (AR) | **1201** ([:21](../../backend/src/data/coa-templates/bolivia-pcg.json#L21)) | **1103** ([:78](../../backend/src/modules/finance/finance.routes.ts#L78)) |
| Activo Fijo | *not defined* | **1201** ([:81](../../backend/src/modules/finance/finance.routes.ts#L81)) |
| IVA Débito Fiscal | **2105** ([:25](../../backend/src/data/coa-templates/bolivia-pcg.json#L25)) | **2103** ([:84](../../backend/src/modules/finance/finance.routes.ts#L84)) |
| IT por Pagar | *not defined* | **2104** ([:85](../../backend/src/modules/finance/finance.routes.ts#L85)) |
| IT expense | *not defined* | **5203** ([:96](../../backend/src/modules/finance/finance.routes.ts#L96)) |

`1201` means **Accounts Receivable** in one and **Fixed Assets** in the other.

### D-2 · POS and ERP Sales are hardcoded to different charts — CRITICAL

| Path | AR | IVA Débito | IT | Matches |
|---|---|---|---|---|
| `sales.routes.ts` [:184-188](../../backend/src/modules/sales/sales.routes.ts#L184-L188) | `1103` | `2103` | `5203` + `2104` | the **seed** |
| `pos.routes.ts` [:274-278](../../backend/src/modules/pos/pos.routes.ts#L274-L278) | `1201` | `2105` | *none* | the **template** |

Because every posting block is wrapped in a truthiness guard, a missing account does not raise an
error — the journal entry is simply skipped and the document is still created.

**Consequence, by which COA the tenant was provisioned with:**

| Tenant provisioned from | ERP sales invoice | POS sale |
|---|---|---|
| **JSON template** | `1103`, `2103`, `2104`, `5203` all missing → guard at [sales.routes.ts:213](../../backend/src/modules/sales/sales.routes.ts#L213) fails → **factura created with no GL entry at all** | works (except IT, see D-3) |
| **`finance.routes.ts` seed** | works | `2105` missing → revenue guard at [pos.routes.ts:281](../../backend/src/modules/pos/pos.routes.ts#L281) fails, **but the COGS block at [:304](../../backend/src/modules/pos/pos.routes.ts#L304) uses `1110`/`5101` which exist in both and posts anyway** |

The second row is the severe one: **every POS sale debits COGS and credits inventory with no
corresponding revenue entry.** The P&L records cost with no sale. Inventory is relieved, revenue is
invisible, and no error is ever raised.

### D-3 · POS never posts IT — HIGH

`pos.routes.ts` has no IT expense or IT payable line in either journal block
([:294-299](../../backend/src/modules/pos/pos.routes.ts#L294-L299)). `sales.routes.ts` does
([:229-232](../../backend/src/modules/sales/sales.routes.ts#L229-L232)). Every POS sale under-accrues
the 3% transaction tax, independent of which COA is in use. For a retailer whose sales are
overwhelmingly POS, this is most of the IT liability.

### D-4 · Silent-failure posting pattern — HIGH (root cause of D-1..D-3)

Two patterns hide the above:
- Truthiness guards: [sales.routes.ts:213](../../backend/src/modules/sales/sales.routes.ts#L213),
  [pos.routes.ts:281](../../backend/src/modules/pos/pos.routes.ts#L281),
  [pos.routes.ts:304](../../backend/src/modules/pos/pos.routes.ts#L304)
- Swallowed exception: [purchase.routes.ts:305-307](../../backend/src/modules/purchase/purchase.routes.ts#L305-L307)
  logs and continues, so a PO receipt succeeds with no GL entry

**[REC]** A financial document that cannot post its journal must fail the whole operation. An
unbalanced or absent posting is worse than a rejected transaction.

### D-5 · Journal entry numbering has a race and a uniqueness collision — HIGH

`entry_number` is globally `@unique` ([schema.prisma:822](../../backend/prisma/schema.prisma#L822)),
but is generated from a row count:

- [sales.routes.ts:214](../../backend/src/modules/sales/sales.routes.ts#L214) — `tx.journalEntry.count()` inside the transaction
- [purchase.routes.ts:282](../../backend/src/modules/purchase/purchase.routes.ts#L282) — `db.journalEntry.count()` **outside** any transaction

Two concurrent postings compute the same `count + 1`. In sales the unique violation rolls back the
factura; in purchase it is swallowed by D-4. The count is also not year-scoped, so the `JE-<year>-`
prefix desynchronises from the sequence after a year boundary.

`pos.routes.ts` pre-allocates numbers atomically and is correct — the comment at
[:272](../../backend/src/modules/pos/pos.routes.ts#L272) says so explicitly. The pattern exists in
the codebase; it just was not applied to sales and purchase.

### D-6 · Latent: POS AR account maps to Fixed Assets under the seed COA — MEDIUM

`pos.routes.ts:276` resolves AR as `1201`, which is *Activo Fijo* in the seed COA. Today this does
not post, because the guard fails on the missing `2105` first. It becomes an active defect the
moment someone adds `2105` to a seed-based COA — POS would then debit fixed assets on every sale.
Fixing D-2 without fixing this would *create* the bug.

---

## 1. Source to Pay

| Process step | D365 reference | Skarpine today | Gap type | Severity |
|---|---|---|---|---|
| Identify need | Purchase requisition, approval workflow | Nothing | `MISSING-ENTITY` | Low (SME) |
| Competitive bidding | RFQ, bid comparison, award | Nothing | `MISSING-ENTITY` | Low (SME) |
| Volume commitment | Purchase agreement / blanket order | Nothing | `MISSING-ENTITY` | Low |
| Issue PO | PO with independent receipt + invoice state axes | `PurchaseOrder.status` single string [:542](../../backend/prisma/schema.prisma#L542); `received_at`/`paid_at` timestamps on the header [:555-559](../../backend/prisma/schema.prisma#L555-L559) | `STRUCTURALLY-WRONG` | **Critical** |
| Receive goods | Product receipt as a posted document, per line, repeatable | `PurchaseOrderLine.received_qty` accumulator [:575](../../backend/prisma/schema.prisma#L575); `ArrivalJournal` exists [:475](../../backend/prisma/schema.prisma#L475) but is warehouse-side and not the financial receipt document | `MISSING-ENTITY` | **Critical** |
| Physical posting | `Purchase expenditure, uninvoiced` + `Purchase, accrual` (GRNI clearing pair) | Receipt posts straight to Inventory + IVA Crédito + AP [purchase.routes.ts:297-299](../../backend/src/modules/purchase/purchase.routes.ts#L297-L299) — no accrual, no clearing | `MISSING-POSTING` | High |
| Vendor invoice | Separate document, own date, own number, own tax point | Does not exist | `MISSING-ENTITY` | **Critical** |
| Three-way match | PO ↔ receipt ↔ invoice | Structurally impossible — two of three documents absent | `MISSING-ENTITY` | High |
| Financial posting | `Cost of purchased materials invoiced`, `Purchase expenditure for product` | Collapsed into the receipt posting | `MISSING-POSTING` | High |
| Vendor payment | Payment document, settlement against invoices, partial + many-to-many | `PurchaseOrder.paid_at`/`paid_by` [:558-559](../../backend/prisma/schema.prisma#L558-L559) | `STRUCTURALLY-WRONG` | **Critical** |
| Return to vendor | Return order, disposition | Nothing | `MISSING-ENTITY` | Medium |
| GL account resolution | Posting profile matrix (item/group/all × account/group/all) | Hardcoded literals in 6 files — see §3 | `MISSING-CONFIG` | **Critical** |
| Purchase pricing | Trade agreements, date-effective, vendor-specific, qty breaks | `PurchaseOrderLine.unit_cost` typed by hand [:576](../../backend/prisma/schema.prisma#L576) | `MISSING-CONFIG` | Medium |
| Landed cost | Charges allocated into inventory value | Single `unit_cost` on the batch [:313](../../backend/prisma/schema.prisma#L313) | `MISSING-ENTITY` | High |
| Purchase tax | Vendor tax group ∩ item tax group → codes | Header `tax_amount` only [:547](../../backend/prisma/schema.prisma#L547); rate from a config constant [config/tax.ts:20](../../backend/src/config/tax.ts#L20) | `MISSING-CONFIG` | High |

---

## 2. Order to Cash

| Process step | D365 reference | Skarpine today | Gap type | Severity |
|---|---|---|---|---|
| Lead / opportunity | Prospect to Quote (85) — separate process | Nothing | `MISSING-ENTITY` | Low |
| Quotation | Quote document, conversion to order | Nothing | `MISSING-ENTITY` | Medium |
| Sales order | Independent delivery + invoice state axes; line-level `delivered_qty` / `invoiced_qty` | `status` string [:623](../../backend/prisma/schema.prisma#L623) + `shipped_at`/`paid_at`/`returned_at` header timestamps [:637-641](../../backend/prisma/schema.prisma#L637-L641); line has only `quantity` [:663](../../backend/prisma/schema.prisma#L663) | `STRUCTURALLY-WRONG` | **Critical** |
| Fulfilment (I2D) | Load → shipment → wave → work → packing slip | Wave/work/directive layer exists [:395-473](../../backend/prisma/schema.prisma#L395-L473) — genuinely good. But `Shipment` has **no lines** [:675-691](../../backend/prisma/schema.prisma#L675-L691) | `STRUCTURALLY-WRONG` | High |
| Packing slip | Posted document; physical GL posting | Does not exist | `MISSING-ENTITY` | High |
| Physical posting | `Cost of units, delivered` + `Cost of goods sold, delivered` (clearing pair) | Not posted at all — COGS only at invoice | `MISSING-POSTING` | Medium |
| Customer invoice | Invoice with **lines**, linked to order lines | `Factura` is header-only [:853-875](../../backend/prisma/schema.prisma#L853-L875); no `FacturaLine`; `source_id` is a soft ref with no FK [:858](../../backend/prisma/schema.prisma#L858) | `STRUCTURALLY-WRONG` | **Critical** |
| Financial posting | `Cost of units, invoiced`, `COGS invoiced`, `Revenue`, AR control from **AR posting profile** | Hardcoded account lookups; AR control fixed to one literal | `MISSING-CONFIG` | **Critical** |
| Tax | Sales tax group ∩ item sales tax group → codes | `iva_amount` and `it_amount` are **columns on the invoice** [:863-864](../../backend/prisma/schema.prisma#L863-L864) | `STRUCTURALLY-WRONG` | **Critical** |
| AR settlement | Payment document, partial, many-to-many against invoices | `SalesOrder.paid_at`/`paid_by` [:636-637](../../backend/prisma/schema.prisma#L636-L637) | `STRUCTURALLY-WRONG` | **Critical** |
| Credit / collections | Credit limit, aging by document, dunning | Nothing; aging can only be derived from `paid_at` | `MISSING-ENTITY` | Medium |
| Returns / exchanges | Return order, disposition, credit note as fiscal document | `SalesOrder.returned_at` timestamp [:637](../../backend/prisma/schema.prisma#L637) | `STRUCTURALLY-WRONG` | High |
| Sales pricing | Price lists, date-effective, customer-specific | `Product.selling_price` single column [:202](../../backend/prisma/schema.prisma#L202) | `MISSING-CONFIG` | Medium |

---

## 3. Cross-cutting foundations

| Foundation | D365 reference | Skarpine today | Gap type | Severity |
|---|---|---|---|---|
| **Product dimensions** | 5 dimensions (color, configuration, size, style, version) in **dimension groups** on a **product master**; variants are explicit valid combinations | `ProductVariant.size`/`.color` hardcoded nullable columns [:234-235](../../backend/prisma/schema.prisma#L234-L235); `VariantType` [:748](../../backend/prisma/schema.prisma#L748) is an orphan table wired to nothing | `STRUCTURALLY-WRONG` | **Critical** |
| **Variant referential integrity** | Every inventory transaction carries the dimension combination | `variant_id` present but **no relation declared** on `SalesOrderLine` [:662](../../backend/prisma/schema.prisma#L662), `PurchaseOrderLine` [:573](../../backend/prisma/schema.prisma#L573), `ArrivalJournalLine` [:499](../../backend/prisma/schema.prisma#L499), `WarehouseWorkLine` [:459](../../backend/prisma/schema.prisma#L459) | `STRUCTURALLY-WRONG` | **Critical** |
| **Financial dimensions** | Dimension attributes + values + sets; dimension on every postable line | `JournalLine` has account, debit, credit, description only [:839-851](../../backend/prisma/schema.prisma#L839-L851). No dimension anywhere. Three stores, no per-store P&L | `MISSING-ENTITY` | **Critical** |
| **Posting profiles** | Matrix resolution, most-specific-wins | Literals in `sales.routes.ts`, `pos.routes.ts`, `purchase.routes.ts`, `hr.routes.ts` [:132-133](../../backend/src/modules/hr/hr.routes.ts#L132-L133), `finance.routes.ts` | `MISSING-CONFIG` | **Critical** |
| **Tax engine** | Tax codes + party group ∩ item group intersection | Rates in a TS constant [config/tax.ts:19-26](../../backend/src/config/tax.ts#L19-L26); amounts as named invoice columns | `MISSING-CONFIG` | **Critical** |
| **Document numbering** | Per-type sequences with format and scope | `OrderCounter(tenant_id, doc_type)` [:960-968](../../backend/prisma/schema.prisma#L960-L968) is the right shape and already generic; `FacturaCounter` [:881](../../backend/prisma/schema.prisma#L881) correctly isolated; but JE numbering bypasses both (D-5) | Partially present | High |
| **Item model group** | Costing method, which postings are enabled | Nothing; FIFO hardwired via `InventoryBatch` [:304-323](../../backend/prisma/schema.prisma#L304-L323) | `MISSING-CONFIG` | Medium |
| **Multi-tenant isolation** | — | Document numbers globally `@unique`, not tenant-scoped: `order_number` [:620](../../backend/prisma/schema.prisma#L620), `po_number` [:539](../../backend/prisma/schema.prisma#L539), `shipment_number` [:678](../../backend/prisma/schema.prisma#L678), `entry_number` [:822](../../backend/prisma/schema.prisma#L822), `journal_number` [:478](../../backend/prisma/schema.prisma#L478), `work_id_code` [:432](../../backend/prisma/schema.prisma#L432), `reference` [:767](../../backend/prisma/schema.prisma#L767). `Factura` does it correctly [:872](../../backend/prisma/schema.prisma#L872) | `STRUCTURALLY-WRONG` | **Critical** |
| **Currency** | Currency table + exchange rates | Free strings with four different defaults: Tenant `USD` [:27](../../backend/prisma/schema.prisma#L27), Supplier `BOB` [:525](../../backend/prisma/schema.prisma#L525), PurchaseOrder **`TRY`** [:545](../../backend/prisma/schema.prisma#L545), SalesOrder `BOB` [:626](../../backend/prisma/schema.prisma#L626); `Site.country` defaults **`TR`** [:83](../../backend/prisma/schema.prisma#L83). No exchange rate table | `MISSING-ENTITY` | Medium |
| **Address book** | Party → multiple addresses with purposes | Flat strings on Customer/Supplier/Site + `shipping_address Json?` [:631](../../backend/prisma/schema.prisma#L631) | `MISSING-ENTITY` | Low |

---

## 4. The `STRUCTURALLY-WRONG` list, ranked

Per the Phase 2 brief this category is flagged aggressively — these are the ones that force
destructive migrations if left.

1. **Product dimensions as hardcoded columns.** For a shoe retailer the variant *is* the stocking
   unit. **[OFFICIAL]** *"A product can't be converted from one model to another after
   implementation"*
   ([product-information](https://learn.microsoft.com/dynamics365/supply-chain/pim/product-information)) —
   Microsoft's own warning about exactly this class of change. Adding a third dimension (width — real
   for shoes) today means a schema change plus a backfill of every historical transaction.

2. **Dangling `variant_id` with no FK.** Four transaction tables reference variants with no
   referential integrity. Orphan rows are silently possible now; any future dimension work has to
   repair data before it can migrate it.

3. **No financial dimensions.** Cannot be backfilled — the store attribution of a 2025 transaction
   is not recoverable in 2027. Every day without this is permanently unanalysable history.

4. **Payment as a header timestamp.** `paid_at` cannot express partial payment or one payment against
   several invoices. Converting later means synthesising payment documents from timestamps, which
   loses amounts, dates and bank references that were never recorded.

5. **Tax as invoice columns.** `iva_amount` / `it_amount` are the schema. A third tax, a second
   jurisdiction, or a tax-exempt customer requires a migration.

6. **Header-only invoice.** No `FacturaLine` means line-level tax, line-level discount, partial
   invoicing and credit notes against specific lines are all unreachable. **[ASSUMPTION]** Bolivian
   facturas require line detail — if true this is also a compliance gap, not only an architectural one.

7. **Global uniqueness on document numbers.** The SaaS positioning fails on the second tenant.
   Cheap to fix now, expensive after there is data.

---

## 5. What is genuinely good and should not be touched

Stated because a gap list reads as a condemnation otherwise, and because these are load-bearing.

- **The warehouse layer** — waves, work templates, work lines, location directives, zone/bin
  hierarchy [:329-473](../../backend/prisma/schema.prisma#L329-L473). This is real I2D structure and
  is more sophisticated than most SME ERPs ship. Keep it.
- **`OrderCounter(tenant_id, doc_type)`** [:960](../../backend/prisma/schema.prisma#L960) — already
  the correct generic shape for the numbering framework. Extend, do not replace.
- **`FacturaCounter` kept separate** [:881](../../backend/prisma/schema.prisma#L881) — correctly
  isolates the legally-constrained series. Preserve this isolation through the generalisation.
- **FIFO batch ledger** [:304-323](../../backend/prisma/schema.prisma#L304-L323) — a real costing
  subledger with `received_at` ordering and remaining-quantity tracking. Needs landed cost and a
  configurable model, but the spine is right.
- **`resolveTax()` already reads tenant config** [config/tax.ts:28](../../backend/src/config/tax.ts#L28)
  and `Factura.invoice_metadata` snapshots the tax labels at issue time
  [:868](../../backend/prisma/schema.prisma#L868). Someone was already thinking about
  multi-jurisdiction. The structure just stopped one level short of the tax *codes*.
- **POS journal numbering** is atomic and correct — the pattern to propagate, not replace.
