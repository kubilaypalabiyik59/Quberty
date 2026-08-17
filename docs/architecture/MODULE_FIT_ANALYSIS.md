# PIM · Inventory · Warehouse · Procurement — fit analysis against D365

> Status: **ANALYSIS. Nothing implemented.** Opened 2026-08-17.
> Question asked: analyse these four modules fundamentally, judge how compatible our structure is
> with what we want to build, and work out the path.
>
> Standing requirement that framed it: **variants stay**, and **batch / license plate must later be
> sellable to a customer as an option.**
>
> Labels: **[OFFICIAL]** Learn with URL · **[REPO]** file:line · **[REC]** recommendation ·
> **[CHALLENGE]** where I disagree with the ask.

---

## 1. The spine: these are not four modules, they are one dimension model

The four modules look separable and are not. What connects them is **inventory dimensions**, and
"can a customer switch batch tracking on later?" is a question about exactly that structure.

**[OFFICIAL]**
[Glossary — inventory dimensions](https://learn.microsoft.com/dynamics365/guidance/business-processes/glossary#i)
and [Product dimensions](https://learn.microsoft.com/dynamics365/supply-chain/pim/product-dimensions):

| Family | Members | Owned by |
|---|---|---|
| **Product** | colour, configuration, size, style, version | PIM — these *create variants* |
| **Storage** | site, warehouse, location, license plate | Inventory / Warehouse |
| **Tracking** | batch, serial, owner | Inventory / Warehouse |

Each family is grouped and the group is attached to the product: product dimension group, storage
dimension group, tracking dimension group. **This is the whole architecture**, and every module in
the question is a consumer of it.

### The reservation hierarchy is the load-bearing idea

**[OFFICIAL]**
[Flexible warehouse-level dimension reservation](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/flexible-warehouse-level-dimension-reservation):

> "the demand order carries the mandatory dimensions of site, warehouse, and inventory status. In
> other words, the mandatory dimensions are **all the dimensions above the location dimension** in the
> reservation hierarchy, while the warehouse logic is responsible for assigning a location."

So the hierarchy is an **ordered list**, and the position of `Location` in it is a semantic boundary:

```
Site ─ Warehouse ─ [Inventory status] ─ LOCATION ─ License plate ─ Batch ─ Serial
        ▲ specified on the order              ▲ resolved by warehouse logic
```

Everything **above** location must be on the demand order. Everything **below** is decided during
picking. And whether batch sits above or below location (*Batch-above* vs *Batch-below[location]*) is
the difference between "the customer ordered lot B11 specifically" and "the warehouse picks whatever
lot it finds".

**This is the exact shape of the answer to your requirement.** "Batch as an option we sell later" is
not a feature flag — it is a row inserted into a hierarchy, and *where* it is inserted changes the
sales order screen, the picking flow and the reservation logic all at once.

**[REPO] we already implement the top of this hierarchy without having named it.**
`inventoryDimension.service.ts` resolves site from warehouse and refuses to accept site from the
caller; `InventoryStock` is unique on `(tenant, product, variant, location)`
([schema.prisma:318](../../backend/prisma/schema.prisma#L318)). That is precisely
*Site ─ Warehouse ─ Location*, with nothing below it. The structure is right. It just stops early.

---

## 2. Product Information Management

**[OFFICIAL]** a product master carries a **product dimension group** and a **configuration
technology** (predefined variants / dimension-based / constraint-based), and
[Product information overview](https://learn.microsoft.com/dynamics365/supply-chain/pim/product-information)
warns: *"A product can't be converted from one model to another after implementation."*

| D365 | Repo | Verdict |
|---|---|---|
| Product master → variants | `Product` → `ProductVariant` | **present** |
| Product dimensions as first-class values (Size/Colour/Style pages, size groups) | `ProductVariant.size` and `.color` are **plain string columns** + an `attributes` Json ([schema.prisma:267](../../backend/prisma/schema.prisma#L267)) | **gap** |
| **Product dimension group** — which dimensions this product varies by | **missing entirely** | **the significant gap** |
| Variant nomenclature (`TS1234-Red-Small-Polo`) | `sku_variant` typed by hand | gap, cosmetic |
| Item model group (valuation) | `ItemModelGroup` | **present, and good** |
| Item group (posting) | `ItemGroup` | **present** |
| Storage / tracking dimension groups | **missing** | see §3 |

**Why the missing dimension group actually matters**, beyond tidiness:

1. **The system cannot state that a product varies by size only.** With `size` and `color` as
   nullable columns, "shoes vary by size" and "shoes vary by size and colour" are indistinguishable —
   which means no variant matrix, no completeness check, and no way to stop a half-defined variant.
2. **It is where a size group lives.** **[OFFICIAL]** size/colour/style groups exist so a new shoe
   inherits EU 36–46 instead of somebody retyping it. For a shoe retailer this is the single highest
   daily-labour item in PIM.
3. **[REPO] `SalesOrderLine.variant_id` and `PurchaseOrderLine.variant_id` are bare UUID columns with
   no foreign key** — stated in the schema itself
   ([schema.prisma:286-290](../../backend/prisma/schema.prisma#L286-L290)). Since the variant is the
   stocking unit for this business, the one dimension that must be referentially sound is the one that
   is not. **This is also the direct cause of yesterday's dead stock:** 37 units on a
   `variant_id = NULL` row that nothing prevents and nothing reports.

**[REC] PIM is the right place to start**, and not because it is foundational in the abstract — because
its two gaps are causing live damage today (unenforced variant FKs, no size groups) whereas the
warehouse gaps are merely absent features.

---

## 3. Inventory Management

| D365 | Repo | Verdict |
|---|---|---|
| On-hand by dimension | `InventoryStock` per location | **present** |
| Inventory transactions | `InventoryTransaction` | present, but see below |
| **Inventory transaction status** (Ordered → Reserved → Registered → Received → Purchased / Sold) | **missing** | **the significant gap** |
| **Inventory status** dimension (available / blocked / quarantine) | **missing** | gap |
| Physical vs financial update | `ItemModelGroup` has the flags; **not wired** (HANDOVER §3d) | half-present |
| Counting journals, cycle counting | `InventoryCountLine` exists; counting groups/policies missing | partial |
| Costing FIFO | `InventoryBatch` as a FIFO cost layer | **present** |
| Batch / serial as tracking dimensions | **missing** | the thing you want to sell later |

### The naming collision that must be fixed before batch tracking exists

**[REPO]** `InventoryBatch` ([schema.prisma:353](../../backend/prisma/schema.prisma#L353)) has
`unit_cost`, `received_at`, `source_po_id` and a remaining `quantity`. **That is a FIFO cost layer,
not a batch.** It has no batch number, no expiry date, no customer-facing identity — the three things
a tracking batch exists for.

If batch tracking is added later under the obvious name, this codebase will contain two unrelated
concepts called batch, one financial and one physical, joined to the same tables. Nobody will
reliably remember which is which.

**[REC] rename `InventoryBatch` → `InventoryCostLayer` now.** It is a table rename plus a handful of
references while nothing external depends on it. After batch tracking ships it is a rename touching
two meanings at once, which nobody will attempt.

### Inventory transaction status is the deeper gap

**[OFFICIAL]**
[Physical and financial updates](https://learn.microsoft.com/dynamics365/supply-chain/cost-management/physical-financial-updates)
and [Inventory posting](https://learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting):
a purchase receipt sets a transaction to *Received* (physical), the vendor invoice moves it to
*Purchased* (financial); an item arrival journal sets *Registered*.

**[REPO]** `InventoryTransaction` has a `transaction_type` but **no status**, so "registered but not
received", "received but not invoiced" and "reserved but not picked" are not representable in the
subledger. We reconstruct them from document status instead — which works while there is one path per
document and stops working the moment putaway, waves and picking sit between receipt and stock.

**[REC]** this is the prerequisite for the warehouse roadmap's Phase 1, not a parallel task. Putaway
work is exactly the state between *Registered* and *available to pick*.

---

## 4. Warehouse Management

Covered in full in [WAREHOUSE_ROADMAP.md](../process/WAREHOUSE_ROADMAP.md). In summary: work
templates, location directives, waves and work **already exist**; putaway, load, shipment-as-grouping
and license plate do not; and the live bug is the missing putaway, not a missing workbench.

One addition from this round of research, directly relevant to a shoe retailer:

**[OFFICIAL]**
[Location product dimension mixing](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/location-product-dimension-mixing)
— a location profile can permit mixing *sizes* in one location while forbidding mixed colours or
styles, and the article names the fashion industry as the reason it exists. This is the one piece of
advanced-warehouse configuration where our anchor customer is the textbook case: one bin per model
and colour, all sizes together. **[REC]** it needs no table today — `WarehouseLocation` can carry the
allowed-mixing flags when location profiles arrive — but it is worth knowing the requirement is real
rather than enterprise decoration.

---

## 5. Procurement and Sourcing

**[OFFICIAL]**
[Procurement and sourcing overview](https://learn.microsoft.com/dynamics365/supply-chain/procurement/procurement-sourcing-overview).

| D365 | Repo | Verdict |
|---|---|---|
| Requisition → RFQ → PO | built (migration 005) | **present** |
| Product receipt, vendor invoice, 3-way match | built (migration 010) | **present** |
| Arrival registration before receipt | `ArrivalJournal` exists, **not in the flow** | half-present |
| **Purchasing policies** (catalog, category access, vendor selection, RFQ thresholds, PO reapproval) | missing | gap |
| **Procurement categories** | missing — `ProductCategory` is merchandising | gap |
| **Trade agreements** (vendor price lists, date-effective) | missing | **the one that pays for itself** |
| Purchase agreements / blanket orders | missing (hook only) | fine |
| Approved vendor list per product | missing | cheap, useful |
| Vendor collaboration portal | missing | out of scope |

**[CHALLENGE] most of this module is not for us.** Purchasing policies are an internal-control
apparatus for organisations with a procurement department and spending limits — **[OFFICIAL]** they
are bound to the "procurement internal control hierarchy". A three-store retailer has one buyer, and
that buyer is probably the owner.

**Two exceptions, both worth building:**

1. **Trade agreements — vendor price lists with validity dates.** Right now a purchase price is typed
   on each order line. A retailer reordering the same shoes every season is retyping prices and has no
   way to answer "what did we pay last time, and has this vendor raised prices?" That is a small
   table with a real daily payoff, and it feeds the RFQ comparison already built.
2. **Approved vendor list per product.** One join table; prevents ordering shoes from the vendor who
   supplies bags.

**[REC] everything else in Procurement is correctly deferred**, and the existing requisition/RFQ chain
already covers the process shape.

---

## 6. The one-way doors

D365 has three settings that cannot be changed after transactions exist. Each is a decision we must
take deliberately, because **the whole point of §1 is that a customer can buy batch tracking later.**

| Door | **[OFFICIAL]** | Our position |
|---|---|---|
| **`Use warehouse management processes`** on the storage dimension group | *"you can no longer change the setting… you'll have to create a new warehouse… There's no automated process to move all the inventory"* ([Costing FAQ](https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq#dimension-groups)) | **Do not reproduce.** We already store at location granularity everywhere, so WMS depth is a per-warehouse behaviour parameter. Detailed in WAREHOUSE_ROADMAP §3 |
| **Configuration technology** on a product master | *"A product can't be converted from one model to another after implementation"* | **Accept, narrowed.** We only ever do predefined variants. Recording the group is what makes it safe |
| **Reservation hierarchy** per product | only one per product; the batch/serial timing *"can't be changed on an ad-hoc basis"*, and `Allow reservation on demand order` can't be cleared once reserved/ordered transactions exist. There is a **Change reservation hierarchy for items** function, but only *"provided that the hierarchy level structure is the same in both hierarchies"* | **Accept — and design for the migration from day one.** See below |

### [REC] How to keep "batch later" genuinely possible

Do **not** build a configurable hierarchy table now; three stores do not need one, and it would be the
EAV mistake in another costume. Do these three cheap things instead:

1. **One resolver owns dimension resolution, top to bottom.** `inventoryDimension.service.ts` already
   owns site and warehouse. Location, and later license plate and batch, extend the same function.
   Ad-hoc dimension handling at each call site is what makes adding a level a rewrite — and we have
   already been bitten by exactly that (`reserveStock` had no warehouse filter at all).
2. **Treat the `InventoryStock` unique key as the hierarchy.** It is `(tenant, product, variant,
   location)` today. Adding a level is adding a nullable column to that key. It stays a plain index
   rather than an EAV join, which is what keeps reporting fast.
3. **Give the product a `tracking_policy` from the start** — `NONE` now, `BATCH` / `SERIAL` later —
   even though only `NONE` is implemented. One nullable column, and it is the flag a sales screen
   later reads to decide whether to ask for a lot. Without it, turning batch tracking on for one
   product means a migration; with it, it is a row update plus a guard that refuses the change once
   transactions exist.

That third item is the smallest possible version of the storage/tracking dimension group, and it is
the honest answer to "sell batch as an option later".

---

## 7. Recommended order

Not the order the modules were listed in — the order the dependencies force.

| # | Work | Why here |
|---|---|---|
| 1 | **Variant integrity**: real FKs on `SalesOrderLine.variant_id` / `PurchaseOrderLine.variant_id`, plus a report and cleanup of `variant_id = NULL` stock | Live damage. Everything downstream reads these rows, and directed putaway will move them around |
| 2 | **Product dimension group + size/colour groups** | Removes the highest daily-labour item in PIM and makes the variant matrix statable |
| 3 | **Rename `InventoryBatch` → `InventoryCostLayer`** | One hour now; impossible later |
| 4 | **`InventoryTransaction.status`** (Ordered → Registered → Received → Purchased / Sold) | Prerequisite for putaway, and it is what finally wires `post_physical_inventory` / `post_financial_inventory` from migration 009 |
| 5 | **Warehouse Phase 1** — putaway + `WarehouseParameters` + pick-location availability | Closes the confirmed live bug properly |
| 6 | **Trade agreements** (vendor price lists) | Small, daily payoff, feeds the existing RFQ comparison |
| 7 | Warehouse Phases 2–4 — shipment grouping, loads, mobile picking | Judged on their own once 1–5 are in |
| 8 | `tracking_policy` column + batch tracking as a sellable option | The stated future requirement; cheap once 3 and 4 exist |

**Items 1–4 are foundation and cost far less than they sound; item 5 is the bug you already hit.**

---

## 8. Fit verdict

**The structure is compatible.** The top of the reservation hierarchy is implemented correctly and
with the right instincts — one resolver, dimensions derived rather than accepted, refusal to guess.
Item model groups and item groups are properly separated, which is more than most implementations
manage. What is missing is depth below `Location`, and depth is exactly what was left out on purpose.

**The two real risks are both naming and integrity, not architecture:** a cost layer called `Batch`,
and a variant reference with no foreign key. Both are cheap today and expensive after the warehouse
work lands on top of them.

---

## 9. Sources

- [Product dimensions](https://learn.microsoft.com/dynamics365/supply-chain/pim/product-dimensions)
- [Product information overview](https://learn.microsoft.com/dynamics365/supply-chain/pim/product-information)
- [Create predefined product variants](https://learn.microsoft.com/dynamics365/supply-chain/pim/tasks/create-predefined-product-variants)
- [Nomenclature of product variant numbers and names](https://learn.microsoft.com/dynamics365/supply-chain/pim/product-variant-identification-nomenclature)
- [Flexible warehouse-level dimension reservation policy](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/flexible-warehouse-level-dimension-reservation)
- [Serial number capturing](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/serial-number-capturing)
- [Location product dimension mixing](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/location-product-dimension-mixing)
- [Inventory on-hand list](https://learn.microsoft.com/dynamics365/supply-chain/inventory/inventory-on-hand-list)
- [Inventory journals](https://learn.microsoft.com/dynamics365/supply-chain/inventory/inventory-journals)
- [Physical and financial updates](https://learn.microsoft.com/dynamics365/supply-chain/cost-management/physical-financial-updates)
- [Inventory posting](https://learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting)
- [Inventory costing FAQ — dimension groups](https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq#dimension-groups)
- [Procurement and sourcing overview](https://learn.microsoft.com/dynamics365/supply-chain/procurement/procurement-sourcing-overview)
- [Purchasing policies overview](https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-policies)
- [Glossary — inventory dimensions](https://learn.microsoft.com/dynamics365/guidance/business-processes/glossary#i)
