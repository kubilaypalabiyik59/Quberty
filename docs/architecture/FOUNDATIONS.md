# Foundation Design

**Phase 4 deliverable.** Design only — no schema has been modified. Prisma fragments below are
proposals for review, not applied migrations.

Depends on [GAP_ANALYSIS.md](../process/GAP_ANALYSIS.md) and
[SCOPE_AND_HOOKS.md](../process/SCOPE_AND_HOOKS.md).

---

## 0. Why five foundations, not four

The brief named four: financial dimensions, posting profiles, document numbering, tax engine.
Research changed that.

**[OFFICIAL]** In the business process catalog, the item master is a **mandatory prerequisite** for
the entire Inventory to Deliver process — *"An item must exist before you can begin to receive,
handle inventory, or ship the product"*
([inventory-to-deliver-overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/inventory-to-deliver-overview)).
Product definition sits in **Design to Retire (40)**, officially upstream of both S2P and O2C.

**[OFFICIAL]** And it is the one that cannot be changed afterwards: *"A product can't be converted
from one model to another after implementation."*
([product-information](https://learn.microsoft.com/dynamics365/supply-chain/pim/product-information))

For a shoe retailer, the variant *is* the stocking unit. **Product dimensions is foundation zero.**

### Mapping foundations to catalog processes

| Foundation | Catalog home |
|---|---|
| Product dimensions | Design to Retire (40) |
| Financial dimensions, posting profiles, tax | Record to Report (90) → *Define accounting policies* |
| Document numbering, reference data | Administer to Operate (99) |

**[OFFICIAL]** R2R is upstream of everything: *"you could draw a circle and put all other end to end
processes inside of it"*
([record-to-report-overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/record-to-report-overview)).
Getting these right is what makes Forecast to Plan, Plan to Produce and Prospect to Quote *additive*
later rather than destructive.

---

## 0.1 A calibration note before the designs — [REC]

D365's own dimension framework is heavy: `DimensionAttribute`, `DimensionAttributeValue`,
`DimensionAttributeValueSet`, `DimensionAttributeValueSetItem`,
`DimensionAttributeValueCombination`, plus account structures and advanced rules. Microsoft
themselves are retreating from part of it — **[OFFICIAL]** *"Starting September 11, 2026, Microsoft
deprecates the Financial dimension service… and aligns future investment with Optimized Financial
dimensions"*
([financial-dimensions](https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-dimensions)).

Copying that verbatim into an SME product would be a mistake. Our selling point is that reporting is
easy; D365's dimension storage is famously hard to query. **The designs below adopt the *anatomy*
(named axes, values, sets, resolution precedence) and reject the *indirection* (combination hashing,
account structures as a separate rules engine).** Where I have simplified against the reference, it
is stated.

---

## 1. Product dimensions

### 1.1 Reference model

**[OFFICIAL]** Five product dimensions — color, configuration, size, style, version. Combined into
**dimension groups**, assigned to **product masters**. A master needs at least one dimension to have
variants. Variants are the **explicitly valid combinations**, not the cartesian product — the
official jeans example has 3 colours × 6 sizes = 18 possible but only 9 produced
([product-dimensions](https://learn.microsoft.com/dynamics365/supply-chain/pim/product-dimensions)).

That last point is the reason a matrix or a JSON blob is the wrong model: validity is per-combination
and must be a row.

### 1.2 Proposed entity model

```prisma
model ProductDimensionAttribute {          // the axis: "Size", "Color", "Width"
  id         String  @id @default(uuid()) @db.Uuid
  tenant_id  String  @db.Uuid
  code       String                        // SIZE, COLOR, WIDTH
  name       String
  sort_order Int     @default(0)           // display order in the variant matrix
  @@unique([tenant_id, code])
}

model ProductDimensionValue {              // "38", "Black", "EE"
  id           String @id @default(uuid()) @db.Uuid
  tenant_id    String @db.Uuid
  attribute_id String @db.Uuid
  value        String
  name         String?
  sort_order   Int    @default(0)          // so 38 sorts before 39, not "10" before "9"
  @@unique([tenant_id, attribute_id, value])
}

model ProductDimensionGroup {              // "SizeColor" — reusable across masters
  id        String @id @default(uuid()) @db.Uuid
  tenant_id String @db.Uuid
  code      String
  name      String
  @@unique([tenant_id, code])
}

model ProductDimensionGroupLine {          // which axes this group uses
  id           String @id @default(uuid()) @db.Uuid
  group_id     String @db.Uuid
  attribute_id String @db.Uuid
  sequence     Int
  @@unique([group_id, attribute_id])
}

// ProductVariant gains a real dimension set; size/color columns retire
model ProductVariantDimension {            // one row per axis per variant
  id           String @id @default(uuid()) @db.Uuid
  tenant_id    String @db.Uuid
  variant_id   String @db.Uuid
  attribute_id String @db.Uuid
  value_id     String @db.Uuid
  @@unique([variant_id, attribute_id])     // one value per axis per variant
}
```

`Product` gains `dimension_group_id String? @db.Uuid`.
`ProductVariant` keeps `sku_variant` as the human key and gains the dimension rows above.

### 1.3 Resolution logic

- A variant is identified by its full set of `(attribute, value)` pairs. The `@@unique([variant_id,
  attribute_id])` constraint guarantees exactly one value per axis.
- Variant lookup from a dimension combination is a grouped join with a count equal to the group's
  line count — a well-indexed query, not a scan.
- **[REC]** `sku_variant` stays the denormalised human identifier and stays unique per tenant. It is
  what the barcode scanner and the POS resolve against; do not make the POS join four tables at the
  till.
- **[OFFICIAL]** Variant naming follows a nomenclature of segments (master number, text constants,
  dimension values) — e.g. `TS1234-Red-Small-Polo`
  ([product-variant-identification-nomenclature](https://learn.microsoft.com/dynamics365/supply-chain/pim/product-variant-identification-nomenclature)).
  Worth adopting as a configurable format string on the dimension group.

### 1.4 Migration path

1. Add the new tables. Nothing breaks; `ProductVariant.size`/`.color` still authoritative.
2. Seed `SIZE` and `COLOR` attributes; derive values from `SELECT DISTINCT size/color FROM
   product_variants`.
3. Backfill `ProductVariantDimension` from the existing columns. This is a pure read — the data is
   all there.
4. **Add the missing FK relations** on `SalesOrderLine`, `PurchaseOrderLine`, `ArrivalJournalLine`,
   `WarehouseWorkLine`. Run an orphan check first; expect some, given no constraint has ever been
   enforced.
5. Switch reads to the new model. Keep the old columns populated for one release as a safety net.
6. Drop `size`/`color` and the orphan `VariantType` table.

**No destructive step.** Steps 1–3 are additive, step 4 is the only one that can fail, and it fails
loudly with a list of bad rows.

### 1.5 Cost

**Medium — 1.5 to 2 weeks.** Six new tables is the easy part. The real work is every read path that
currently does `variant.size` — POS, storefront, import, reporting, and the variant matrix UI. The
import module in particular maps spreadsheet columns to `size`/`color` and needs rework.

---

## 2. Financial dimensions

### 2.1 Reference model

**[OFFICIAL]** Dimensions are named attributes with values; **default dimensions** are sets of
(dimension, value) pairs held on master data; a **ledger dimension** is main account + dimension
values. Defaults flow from master data and journal headers onto transactions, with the more specific
source winning
([financial-dimensions](https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-dimensions),
[dimensions-default-values](https://learn.microsoft.com/dynamics365/finance/general-ledger/dimensions-default-values)).

### 2.2 Proposed entity model

```prisma
model DimensionAttribute {                 // the axis: "Store", "CostCenter", "Channel"
  id           String  @id @default(uuid()) @db.Uuid
  tenant_id    String  @db.Uuid
  code         String
  name         String
  is_mandatory Boolean @default(false)     // must be present on a posting
  is_active    Boolean @default(true)
  sort_order   Int     @default(0)
  @@unique([tenant_id, code])
}

model DimensionValue {
  id           String  @id @default(uuid()) @db.Uuid
  tenant_id    String  @db.Uuid
  attribute_id String  @db.Uuid
  value        String                      // max 30 chars, per D365 convention
  name         String
  is_active    Boolean @default(true)
  @@unique([tenant_id, attribute_id, value])
}

model DimensionSet {                       // an immutable named combination
  id         String   @id @default(uuid()) @db.Uuid
  tenant_id  String   @db.Uuid
  hash       String                        // deterministic hash of sorted (attr,value) pairs
  created_at DateTime @default(now())
  @@unique([tenant_id, hash])              // dedupe: identical combinations share one row
}

model DimensionSetItem {
  id           String @id @default(uuid()) @db.Uuid
  set_id       String @db.Uuid
  attribute_id String @db.Uuid
  value_id     String @db.Uuid
  @@unique([set_id, attribute_id])
}
```

Then `dimension_set_id String? @db.Uuid` is added to:
**every postable line** — `JournalLine`, `SalesOrderLine`, `PurchaseOrderLine`,
`InventoryTransaction`, `FacturaLine` — and as a **default** on master data: `Customer`, `Supplier`,
`Product`, `Site`, `Warehouse`, `Employee`, `Account`.

### 2.3 Resolution logic

Defaulting precedence, most specific wins:

```
explicit on the line
  ↓ else
document header default
  ↓ else
master data default   (customer / supplier for the party axis, product for item axes)
  ↓ else
site / warehouse default   ← this is where Store comes from automatically
  ↓ else
blank (rejected if attribute.is_mandatory)
```

**[REC]** The `hash` column is the one piece of D365's indirection worth keeping. Identical
combinations collapse to one `DimensionSet` row, so a store-level P&L is a join to a few dozen sets
rather than millions of rows. This is deliberately *simpler* than D365's
`DimensionAttributeValueCombination` — we skip account structures and advanced rules entirely, and
enforce only `is_mandatory`. That covers the SME need at a fraction of the query cost.

**[REC]** Reporting: expose dimension values as denormalised columns in the reporting views only.
Keep the normalised model for writes and the flat model for reads. The existing raw-SQL reporting
layer makes this straightforward.

### 2.4 Migration path

1. Add tables. Additive.
2. Seed the `STORE` attribute; create one value per `Site`.
3. Set `Site.default_dimension_set_id` for each store.
4. New postings populate `dimension_set_id`.
5. **Historical rows stay null.** Backfill only where provenance is genuinely recoverable —
   `SalesOrder.site_id` exists ([schema:624](../../backend/prisma/schema.prisma#L624)), so
   historical sales can be attributed to a store; POS orders can go via `RegisterSession.site_id`
   ([schema:906](../../backend/prisma/schema.prisma#L906)). Purchases and manual journals cannot be
   attributed and must stay null.
6. Reports treat null as "Unassigned" rather than failing.

**[REC]** Do not fabricate dimension values for history. An "Unassigned" bucket that shrinks to zero
is honest; a guessed attribution is a silent lie in the financials.

### 2.5 Cost

**Medium-high — 2 to 3 weeks.** Four tables and a resolver are perhaps a week. The rest is touching
every posting path and every report. The reporting layer is the larger half.

---

## 3. Posting profiles

### 3.1 Reference model

**[OFFICIAL]** A matrix, not a mapping. Item axis (`Table`/`Group`/`All`/`Category`) × account axis
(`Table`/`Group`/`All`), optionally qualified by tax group, resolving to a main account per posting
type
([inventory-posting-profiles](https://learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting-profiles)).

**[OFFICIAL]** And there are **two families** — the inventory posting profile resolves inventory /
COGS / revenue; the **AR/AP posting profile** resolves the customer and vendor control accounts
([sales-order-posting](https://learn.microsoft.com/dynamics365/finance/general-ledger/sales-order-posting)).

### 3.2 Proposed entity model

```prisma
enum PostingRelationType { TABLE  GROUP  ALL  CATEGORY }

model ItemGroup {
  id        String @id @default(uuid()) @db.Uuid
  tenant_id String @db.Uuid
  code      String
  name      String
  @@unique([tenant_id, code])
}
// CustomerGroup and VendorGroup follow the same shape.

model PostingProfile {
  id             String @id @default(uuid()) @db.Uuid
  tenant_id      String @db.Uuid
  profile_family String              // INVENTORY | AR | AP
  transaction_type String            // PURCHASE_ORDER | SALES_ORDER | INVENTORY | ...
  posting_type   String              // see the catalogue in §3.3

  item_relation_type    PostingRelationType @default(ALL)
  item_relation_id      String?  @db.Uuid   // Product.id or ItemGroup.id or ProductCategory.id
  account_relation_type PostingRelationType @default(ALL)
  account_relation_id   String?  @db.Uuid   // Customer/Supplier id or their group id
  tax_group_id          String?  @db.Uuid   // optional extra qualifier

  main_account_id String  @db.Uuid
  priority        Int     @default(0)       // computed specificity, see §3.3
  is_active       Boolean @default(true)

  @@index([tenant_id, profile_family, transaction_type, posting_type])
}
```

### 3.3 Resolution logic

Posting types to support initially — **[OFFICIAL]**, from the two posting pages:

| Transaction type | Posting types |
|---|---|
| Purchase order | `CostOfPurchasedMaterialsReceived`, `PurchaseExpenditureUninvoiced`, `PurchaseAccrual`, `CostOfPurchasedMaterialsInvoiced`, `PurchaseExpenditureForProduct`, `PurchaseExpenditureForExpense`, `Discount` |
| Sales order | `CostOfUnitsDelivered`, `CostOfGoodsSoldDelivered`, `CostOfUnitsInvoiced`, `CostOfGoodsSoldInvoiced`, `Revenue`, `Discount` |
| AR / AP family | `CustomerBalance`, `VendorBalance` |
| Tax | `TaxPayable`, `TaxReceivable`, `TaxExpense` |

Resolver:

```
resolve(family, txType, postingType, itemId, partyId, taxGroupId) → accountId

1. Select candidate rows matching family + txType + postingType.
2. Keep rows where the item axis matches:
     TABLE    → item_relation_id == itemId
     GROUP    → item_relation_id == item.item_group_id
     CATEGORY → item_relation_id == item.category_id
     ALL      → always
3. Keep rows where the account axis matches, same way.
4. Drop rows with a tax_group_id that does not match.
5. Order by specificity, take the first:
     item axis:    TABLE=3, GROUP=2, CATEGORY=1, ALL=0
     account axis: TABLE=3, GROUP=2, ALL=0
     priority = item_score * 10 + account_score + (tax_group_id ? 1 : 0)
6. No match → RAISE. Never fall back to a literal, never skip the posting.
```

Step 6 is the fix for defect **D-4**. **[REC]** A financial document that cannot resolve an account
must fail the transaction, loudly, with the unresolved `(txType, postingType, item, party)` tuple in
the error.

### 3.4 Migration path

1. Add tables. Seed `ItemGroup`/`CustomerGroup`/`VendorGroup` with one `DEFAULT` row each; assign
   every existing master record to it.
2. **Reconcile the two charts of accounts first** — defect D-1. Pick one canonical COA, map the
   other onto it, migrate existing `JournalLine.account_id` references. This is a prerequisite, not
   part of this step.
3. Seed `PostingProfile` rows with `ALL`/`ALL` that reproduce today's hardcoded literals exactly.
   Behaviour is unchanged at this point — that is the acceptance criterion.
4. Replace each hardcoded `account.findFirst({ code: '...' })` with a resolver call. Six files:
   `sales.routes.ts`, `pos.routes.ts`, `purchase.routes.ts`, `hr.routes.ts`, `finance.routes.ts`,
   `sales.service.ts`.
5. Remove the truthiness guards; let the resolver raise.
6. Add the missing POS IT posting types (defect D-3) — now a configuration row, not code.

Step 3 is the safety property: the migration is a no-op until someone adds a more specific row.

### 3.5 Cost

**Medium — 1.5 to 2 weeks**, of which step 2 (COA reconciliation) is the risky part because it
touches posted history. **[REC]** Do step 2 as its own reviewed change with a full backup and a
reconciliation report proving trial-balance equality before and after.

---

## 4. Document lifecycle and numbering

### 4.1 Current state

Three mechanisms coexist:
- `OrderCounter(tenant_id, doc_type)` [schema:960](../../backend/prisma/schema.prisma#L960) —
  correct generic shape
- `FacturaCounter(tenant_id)` [schema:881](../../backend/prisma/schema.prisma#L881) — correctly
  isolated for the legal series
- Count-based generation for journal entries — **broken**, defect D-5

### 4.2 Proposed entity model

Extend `OrderCounter` rather than replacing it.

```prisma
model DocumentSequence {
  tenant_id    String  @db.Uuid
  doc_type     String                       // SO, PO, PR, RFQ, QUOTE, RECEIPT, VINV, JE, SHIP, CN
  series       String  @default("DEFAULT")  // supports parallel legal series
  prefix       String  @default("")
  format       String  @default("{prefix}-{year}-{seq:5}")
  last_number  Int     @default(0)
  year_scope   Boolean @default(true)       // reset annually?
  current_year Int?
  is_legal     Boolean @default(false)      // gapless guarantee required
  updated_at   DateTime @updatedAt
  @@id([tenant_id, doc_type, series])
}
```

`FacturaCounter` stays as-is, or migrates to a row with `is_legal = true`. **[REC]** If in doubt,
leave it alone — a working legal counter is not worth refactoring for tidiness.

### 4.3 Resolution logic

```
nextNumber(tenantId, docType, series) →
  atomic UPDATE ... SET last_number = last_number + 1 RETURNING last_number
  (single statement; the row lock is the serialisation point)
  if year_scope and current_year != now.year → reset to 1, set current_year
  format the result
```

Two allocation policies:

| `is_legal` | Policy | Rationale |
|---|---|---|
| `false` | Allocate early, tolerate gaps on rollback | Cheap, no contention held across the transaction |
| `true` | Allocate as late as possible inside the transaction, immediately before commit | Minimises the window in which a rollback burns a number |

**[REC]** Even with late allocation a crash between allocation and commit can gap the sequence. If
Bolivian law tolerates no gaps at all, the correct pattern is a *reservation* table where allocated
numbers are recorded and unused ones must be explicitly voided with a reason — which is what most
fiscal regimes actually expect. **[ASSUMPTION]** flagged for the co-founder: which is it — gapless,
or gaps-with-justification?

### 4.4 Migration path

1. Add `DocumentSequence`; copy existing `OrderCounter` rows in.
2. Point journal entry numbering at it — **fixes D-5 immediately** and is independent of everything
   else.
3. Point SO/PO numbering at it.
4. Leave `FacturaCounter` untouched until the legal question in §4.3 is answered.
5. New document types register a row at creation.

### 4.5 Cost

**Low — 3 to 4 days.** The smallest and highest-leverage of the five. Step 2 alone removes a live
data-corruption risk.

---

## 5. Tax engine

### 5.1 Reference model

**[OFFICIAL]** Tax codes carry rates. Two group families: **sales tax group** on the party, **item
sales tax group** on the resource. The applicable codes are the **intersection** of the two. Both
default from master data and are overridable per line
([indirect-taxes-overview](https://learn.microsoft.com/dynamics365/finance/general-ledger/indirect-taxes-overview)).

### 5.2 Proposed entity model

```prisma
model TaxCode {
  id             String  @id @default(uuid()) @db.Uuid
  tenant_id      String  @db.Uuid
  code           String                      // IVA-13, IT-3
  name           String                      // "IVA Débito Fiscal"
  jurisdiction   String  @default("BO")
  tax_type       String                      // VAT | TURNOVER | WITHHOLDING | EXCISE
  rate           Decimal @db.Decimal(9, 6)
  is_inclusive   Boolean @default(false)     // Bolivia IVA: true
  is_recoverable Boolean @default(false)     // IVA: true, IT: false
  basis          String  @default("NET")     // NET | GROSS | OTHER_TAX
  is_active      Boolean @default(true)
  valid_from     DateTime?                   // rate changes are date-effective
  valid_to       DateTime?
  @@unique([tenant_id, code])
}

model TaxGroup     { /* party side  — id, tenant_id, code, name, applies_to: SALES|PURCHASE|BOTH */ }
model ItemTaxGroup { /* item side   — id, tenant_id, code, name */ }

model TaxGroupCode     { group_id String @db.Uuid; tax_code_id String @db.Uuid; @@unique([group_id, tax_code_id]) }
model ItemTaxGroupCode { group_id String @db.Uuid; tax_code_id String @db.Uuid; @@unique([group_id, tax_code_id]) }

model TaxTransaction {                       // the calculated result, per line
  id            String  @id @default(uuid()) @db.Uuid
  tenant_id     String  @db.Uuid
  source_type   String                       // FACTURA_LINE | VENDOR_INVOICE_LINE | ...
  source_id     String  @db.Uuid
  tax_code_id   String  @db.Uuid
  base_amount   Decimal @db.Decimal(14, 2)
  tax_amount    Decimal @db.Decimal(14, 2)
  rate_applied  Decimal @db.Decimal(9, 6)    // snapshot — never recompute history
  is_recoverable Boolean
  @@index([tenant_id, source_type, source_id])
}
```

`Customer`/`Supplier` gain `tax_group_id`. `Product` gains `item_tax_group_id`.

### 5.3 Resolution logic

```
codes = TaxGroupCode(party.tax_group)  ∩  ItemTaxGroupCode(product.item_tax_group)
for each code, ordered by basis:
    base = is_inclusive ? gross / (1 + rate) : net
    tax  = base * rate
    write a TaxTransaction row with rate_applied snapshotted
```

**Bolivia expressed in this model — no special cases:**

| Group | Codes | Effect |
|---|---|---|
| `BO-CUST-DOM` (customers) | `IVA-13`, `IT-3` | Sales carry both |
| `BO-VEND-DOM` (vendors) | `IVA-13` | Purchases carry IVA only |
| `BO-GOODS` (products) | `IVA-13`, `IT-3` | — |
| `BO-EXEMPT` (products) | *(empty)* | Exempt products intersect to nothing |

IT never appears on a purchase — not because of an `if`, but because the vendor group does not
contain it. This is the concrete reason the tax engine could not be designed from P2P alone: derived
only from the purchase side, `IT-3` would never have entered the model.

### 5.4 Migration path — the no-regression requirement

Bolivia must keep behaving **exactly** as today.

1. Add tables. Seed `IVA-13` (`rate 0.13`, `is_inclusive true`, `is_recoverable true`) and `IT-3`
   (`rate 0.03`, `is_inclusive false`, `is_recoverable false`, `basis NET`) from
   [config/tax.ts:19-26](../../backend/src/config/tax.ts#L19-L26).
2. Seed the four groups above; assign every existing customer, supplier and product to them.
3. Implement the resolver **alongside** `resolveTax()`. Run both. Assert equality on every
   transaction in a staging replay of production data. The existing
   [`__tests__/tax.test.ts`](../../backend/src/__tests__/tax.test.ts) is the regression floor and
   must stay green.
4. Switch writes to the new engine; keep `Factura.iva_amount`/`it_amount` populated as derived
   totals for one release so reports and the IVA book do not move.
5. Add `FacturaLine` with per-line `TaxTransaction` rows.
6. Retire the derived columns once the *Libro de Ventas* report reads from `TaxTransaction`.

**[REC]** Step 3 is not optional. This is live tax data in a regulated jurisdiction; a parallel-run
proof is the only acceptable evidence.

### 5.5 Cost

**High — 3 to 4 weeks.** Not because the model is complex, but because of the parallel run, the
`FacturaLine` introduction, and the IVA reporting rework
([finance.routes.ts:338](../../backend/src/modules/finance/finance.routes.ts#L338),
[:388](../../backend/src/modules/finance/finance.routes.ts#L388)). This is the foundation where
cutting corners is most expensive and least visible.

---

## 6. Summary

| # | Foundation | Cost | Risk if deferred |
|---|---|---|---|
| 0 | Product dimensions | 1.5–2 wk | **[OFFICIAL]** unconvertible after implementation |
| 1 | Financial dimensions | 2–3 wk | Unbackfillable — history permanently unanalysable |
| 2 | Posting profiles | 1.5–2 wk | Blocks a correct fix for D-1/D-2 |
| 3 | Document numbering | 3–4 d | Live data-corruption risk (D-5) |
| 4 | Tax engine | 3–4 wk | Compliance exposure; blocks line-level tax |

**Total: 9 to 12 weeks** for the foundation layer, plus defect remediation (D-1…D-6) first.

**[REC]** That is a real number and it should be said plainly: this is a quarter of foundation work
before a single new user-facing feature ships. The alternative is not "ship faster" — it is
"ship features onto a schema that has to be rewritten in eighteen months, with production data in
it." The judgement call is genuinely yours, but it should be made with the number visible.

**[REC]** Suggested order: **D-1…D-6 → numbering (3) → product dimensions (0) → financial dimensions
(1) → posting profiles (2) → tax (4)**. Numbering first because it is days and removes a live risk.
Tax last because it is the one that most benefits from the other four being in place.
