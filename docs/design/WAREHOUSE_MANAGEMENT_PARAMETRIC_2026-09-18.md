# Warehouse management: verified, parametric per warehouse (2026-09-18)

Catalog: 65.40 / 75.50 (inbound and outbound warehouse processes). Requested by Kubi: "D365 has
Inventory management and an optional Warehouse management module. Make sure our Work Tasks, Waves
and Arrivals work, make the WMS parametric, check it against Learn, and design it so that adding
another WMS feature later does not force a database rework."

## Official model

*official documentation* — WMS is enabled **per warehouse**: "To use WMS in Supply Chain Management,
you must create a warehouse and enable it for WMS. On the Warehouses page, select the **Use warehouse
management processes** option":
<https://learn.microsoft.com/dynamics365/supply-chain/warehousing/warehouse-configuration>. Items have
their own switch through the storage dimension group, and a WMS-enabled item can be used in both
WMS and non-WMS warehouses:
<https://learn.microsoft.com/dynamics365/supply-chain/warehousing/reservations-in-warehouse-management>.
Directed putaway uses location directives whose first action consolidates and whose second action
uses "empty location with no incoming work":
<https://learn.microsoft.com/dynamics365/supply-chain/warehousing/create-location-directive>.

## What exists — repo-verified

`WarehouseParameters` is one row per warehouse, so WMS is already parametric at the level D365
puts it, split into the switches an SME needs instead of one all-or-nothing flag:

| Parameter | Effect | Status |
|---|---|---|
| `require_putaway` | A receipt lands in the receiving location and creates put-away work to a shelf (inbound method C/D). | Live |
| `availability_counts` | `ALL_LOCATIONS`, or `PICK_LOCATIONS_ONLY`: goods still on the dock are not sellable until put away. | Live |
| `default_receive_location_id` | Where receipts land, and where put-away work starts. | Live |
| `require_pick_work` | Outbound pick work. | Hook: declared and shown disabled on Setup → Warehouse; nothing reads it yet. |

Setup → Warehouse maintains them per warehouse and warns when a warehouse has no pick location or
no putaway directive. A warehouse with every switch off runs as plain inventory management.

## Verification run on TEST

- `scripts/verifyPutaway.ts` — 14/14: defaults, dock stock not sellable under pick-only, put-away
  moves stock and its FIFO cost layer, subledger transfer pair, double completion refused,
  parameters restored.
- `scripts/verifyProcurementCycle.ts` now receives into the warehouse's default receive location and
  checks that a putaway warehouse raises put-away work off it — 26/26.
- e2e `17-warehouse-work` — a worker starts and completes the put-away task on screen; the database
  shows the work COMPLETED and the stock moved from the receiving location to the shelf.
- Work Tasks, Waves, Arrivals, Locations and Setup → Warehouse load without errors.

## Defect found and fixed

*repo-verified* — the CONSOLIDATE directive action matched **zero-quantity** stock rows and had no
ordering. A location that once held the item still counted as "where the item is", and which row
won depended on the database. On TEST the same receipt created put-away work one day and none the
next. It now requires a positive quantity and prefers the location with the most stock, then the
location code, so a receipt resolves the same way every time. (EMPTY_LOCATION already had the
zero-quantity rule.)

## Recorded, not changed

- *architectural recommendation* — a receipt for which no directive finds a destination creates no
  work and only logs a warning, so the goods can wait on the dock unnoticed. The receipt already
  returns `putawayWork`; the receiving screen should say "no put-away work created — check the
  location directives". That caller is in `productReceipt.service.ts`, which carries Codex's
  uncommitted WORK-051A change, so it is left to that item.
- *architectural recommendation* — hide Work Tasks and Arrivals for a tenant whose warehouses all
  have WMS switched off. Not done: waves may be created by outbound shipping regardless of the
  switches (9 on TEST), and hiding a menu over live data would be worse than showing an empty one.
  Needs a check of `addOrderToWave` callers first.
- Schema hooks for later WMS features, none needing a data migration: `require_pick_work` (outbound
  pick work), `WarehouseWork.work_type` (a string, so replenishment or movement work types are new
  values), `LocationDirective.directive_type` (PUTAWAY today; PICK is a new value), and
  `WarehouseZone.zone_type`. An item-level WMS switch (D365's storage dimension group) would be a
  nullable column on the item model group; not needed while every stocked item follows the
  warehouse's switch.
