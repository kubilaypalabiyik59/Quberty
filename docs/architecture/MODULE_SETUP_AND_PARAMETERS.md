# Module-scoped setup and the parameter registry

> **Standing rules, set 2026-08-17. These bind all future work.**
>
> 1. **Setup is module-scoped.** Every setting lives under the module that owns it, never in a global
>    settings page. One module = one Setup area + one Parameters record.
> 2. **Everything is parametric and configurable.** A behaviour decided by an `if` in service code is
>    a defect unless Kubi exempts it.
> 3. **Everything must be enhanceable later.** A setting added today must not block the richer
>    version of itself arriving tomorrow — no behaviour cut may become a schema cut.
> 4. **Everything is verified against Microsoft Learn**, on the real parameter pages, not overview
>    pages.
>
> Companion to [ERP_SETUP_CHECKLIST.md](ERP_SETUP_CHECKLIST.md), which answers *in what order*.
> This one answers *where does it live, and what can be configured*.

---

## 1. The pattern is D365's own, and it is verifiable

**[OFFICIAL]** every module owns its own Setup area and its own parameters record:

| Module | Parameters page |
|---|---|
| Warehouse management | *Warehouse management > Setup > Warehouse management parameters* — tabs **General** (FastTabs: License plates, Batches), **Number sequences**, **Reports** ([Configure number sequences for warehouse flows](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/configure-number-sequence-extensions), [Global mobile device parameters](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/mobile-device-parameters)) |
| Inventory management | *Inventory and warehouse management parameters* — **General** tab holds *Reserve ordered items*; **Transfer** tab holds *Reserve items automatically* ([Reserve inventory quantities](https://learn.microsoft.com/dynamics365/supply-chain/inventory/reserve-inventory-quantities#inventory-reservation-policies)) |
| Procurement and sourcing | *Procurement and sourcing > Setup > Policies > Purchasing policies* ([Purchasing policies](https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-policies)) |
| General ledger | *General ledger > Ledger setup > General ledger parameters* — incl. *Transaction reversal > Correction* ([Storno accounting](https://learn.microsoft.com/dynamics365/finance/localizations/poland/emea-pol-red-storno)) |
| Accounts receivable | *Sales default values > Reservation* — and note **[OFFICIAL]** the inventory `Item sales reservation` default *"might be inherited from Accounts receivable parameters"* |

That last row is the part worth copying deliberately: **parameters cascade between modules with a
stated precedence**, rather than one module reaching into another's settings. It is the same shape
as our posting-profile resolver — most specific wins, and the fallback is written down.

---

## 2. Where we already comply

**[REPO]** migration 001 established exactly this shape and it has held:

| Record | Owns |
|---|---|
| `FinanceParameters` | `require_balanced_posting`, `allow_posting_to_closed_period`, `rounding_tolerance`, `correction_method`, `functional_currency` |
| `SalesParameters` | default tax groups, `invoice_label`, `allow_negative_inventory_sale`, `default_warehouse_id`, `require_warehouse_on_sales_order`, the process-chain step toggles |
| `PurchaseParameters` | purchase flow (split posting, three-way matching, tolerance), the requisition/RFQ step toggles |
| `InventoryParameters` | `costing_method`, `allow_negative_inventory`, `capitalise_landed_cost` |

All four carry a **nullable `legal_entity_id`** and a `@@unique([tenant_id, legal_entity_id])`, so a
per-company override is already a row rather than a migration. That is rule 3 satisfied structurally.

**Two modules have no parameters record at all:**

- **Warehouse management** — nothing. The warehouse roadmap needs `WarehouseParameters` *per
  warehouse* (`require_putaway`, `require_pick_work`, `availability_counts`), which is one level
  finer than the others and correct: **[OFFICIAL]** D365 likewise sets *Default inventory status ID*
  on the individual warehouse, not globally.
- **Product information management** — nothing. Needs the variant/dimension defaults (§4).

---

## 3. The verification that answers yesterday's question

You asked whether a location could be chosen on the sales order line. **[OFFICIAL]** the answer is
that it must not be
([Reservations in Warehouse management](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/reservations-in-warehouse-management#reservation-hierarchies)):

> "Don't enter the Location dimension and any dimensions below it on sales and transfer lines if you
> expect work to be created… Otherwise, WMS can't create work to carry out the pick and pack
> operations."

and, on the other side of the boundary:

> "If a dimension is above the location level, warehouse workers can't change it, because it's
> considered a **strict picking requirement**."

So the absence of a location field on `SalesOrderLine` is correct design, not an omission. The
missing piece was never a field — it was the putaway that moves stock into a pickable location.

### And a precise spec we should adopt when levels are added

**[OFFICIAL]** on-hand for WMS items is stored **per hierarchy level**, each level carrying four
quantities — available physical, available ordered, reserved physical, reserved ordered — and
availability is computed as:

> 1. Determine the available on-hand quantity based on the exact dimensions (the lowest level).
> 2. Determine the **smallest** available quantity from all levels **above** it.
> 3. Return the **smaller** of the two.

**[REPO]** `getAvailableStock` today is a single `SUM(quantity) − SUM(reserved_qty)` filtered by
warehouse. That is step 1 only, which is correct while there is nothing below location. **Write the
algorithm down in the resolver now**, so adding license plate or batch is filling in step 2 rather
than rediscovering why the number is wrong.

---

## 4. The parameter registry — what each module owns, and what is still missing

Every row is a setting that exists in D365, mapped to the module that must own it here. **Status**
is `built` / `gap` / `deferred (hook)`.

### Product information management

| Setting | Status | Note |
|---|---|---|
| Product dimension group (which dims a product varies by) | **gap** | MODULE_FIT_ANALYSIS §2 |
| Size / colour / style groups | **gap** | the daily-labour item for a shoe retailer |
| Variant number nomenclature | deferred | **[OFFICIAL]** segments: master number, text constant, dimensions |
| `tracking_policy` (NONE / BATCH / SERIAL) | **gap — add early** | one nullable column; the honest hook for "sell batch later" |
| Item model group, item group | **built** | migrations 008/009 |

### Inventory management

| Setting | Status | Note |
|---|---|---|
| `costing_method`, `allow_negative_inventory` | **built** | |
| **Reserve ordered items** | **gap** | **[OFFICIAL]** decides whether expected receipts count as available |
| Reservation policy: FIFO date-controlled, Backward from ship date, FEFO + pick criteria | **gap** | today reservation is oldest-`updated_at` first, hardcoded |
| Item sales reservation: manual / automatic | **gap** | we always reserve on confirm |
| Inventory status dimension (available / blocked / quarantine) | deferred | needs the hierarchy first |
| Counting groups / policies | deferred | |

**[CHALLENGE]** of these, only *Reserve ordered items* and *manual-vs-automatic reservation* are
plausible for a three-store retailer. FEFO belongs to food and pharma; note it and move on.

### Warehouse management (per warehouse)

| Setting | Status |
|---|---|
| `require_putaway`, `require_pick_work`, `availability_counts` | **gap — the roadmap's Phase 1** |
| Default receive location, default pick location | **gap** |
| Number sequences for warehouse documents | partially — `NumberSequence` exists, no warehouse references yet |
| License plate policy, GS1 prefix, batch reservation policy | deferred (hook) — **[OFFICIAL]** these are the *License plates* and *Batches* FastTabs |
| Location profiles incl. **product dimension mixing** | deferred (hook) — the fashion case, MODULE_FIT_ANALYSIS §4 |

### Procurement and sourcing

| Setting | Status |
|---|---|
| Split posting, three-way matching, price tolerance | **built** |
| Requisition / RFQ step toggles | **built** |
| Trade agreements (vendor price lists, date-effective) | **gap — recommended** |
| Approved vendor list per product | **gap — cheap** |
| Purchasing policies (catalog, category access, RFQ thresholds, PO reapproval) | **[CHALLENGE] not our market** |

---

## 5. The rule for adding any setting from now on

Four questions, answered in the commit that adds it:

1. **Which module owns it?** It goes in that module's parameters record. If two modules want it, it
   belongs to the one that *acts* on it, and the other reads it through a stated fallback (§1).
2. **What is the default?** It must preserve today's behaviour exactly, so applying the migration
   changes nothing until somebody opts in. This is how migrations 001–013 have all worked and why
   none of them broke a tenant.
3. **What is the enhancement path?** State the richer version it must not block. A boolean that will
   later want three values should be an enum from the start — `correction_method` is `REVERSE |
   STORNO` as text with a CHECK, not a `use_storno` boolean, for exactly this reason.
4. **Where is the Learn page?** Cite it. If none exists, label the setting **[REC]** and say so.

**The counter-rule, so this does not become its own disease:** a parameter with one legal value is
not configuration, it is a comment. Do not add a setting until either a second tenant needs the other
value or a Learn page shows the axis is real. Rule 2 says no hardcoded behaviour; it does not say
every constant deserves a row.

---

## 6. Sources

- [Configure number sequences for warehouse flows](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/configure-number-sequence-extensions)
- [Global mobile device parameters](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/mobile-device-parameters)
- [Warehouse management overview](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/warehouse-management-overview)
- [Reservations in Warehouse management](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/reservations-in-warehouse-management)
- [Reserve inventory quantities](https://learn.microsoft.com/dynamics365/supply-chain/inventory/reserve-inventory-quantities)
- [Purchasing policies overview](https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-policies)
- [Activate storno accounting for Poland](https://learn.microsoft.com/dynamics365/finance/localizations/poland/emea-pol-red-storno)
