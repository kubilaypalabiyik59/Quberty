# Advanced warehousing — reference model, gap analysis and roadmap

> Status: **ROADMAP. Nothing here is implemented.**
> Requested 2026-08-17: shipments, a load planning workbench, and later a mobile picking interface
> for warehouse staff. Researched from Microsoft Learn as instructed.
>
> Labels: **[OFFICIAL]** Learn with URL · **[REPO]** verified in this codebase · **[REC]** my
> recommendation · **[CHALLENGE]** where I think the ask should change.

---

## 1. The finding that reframes the request

The request assumed we need to *add* advanced warehousing. **[REPO]** the opposite is closer to true:
the advanced machinery is already modelled, and what is missing is the ordinary connective tissue.

| D365 concept | In this repo? |
|---|---|
| Zones, locations with pick/receive flags and capacity | **yes** — `WarehouseZone`, `WarehouseLocation` |
| Stock held per location | **yes** — `InventoryStock.location_id` |
| Work templates + lines | **yes** — `WorkTemplate`, `WorkTemplateLine` |
| Location directives + lines, with quantity breaks and a strategy | **yes** — `LocationDirective`, `LocationDirectiveLine` |
| Wave templates, waves | **yes** — `WaveTemplate`, `Wave` |
| Warehouse work + lines, with from/to location | **yes** — `WarehouseWork`, `WarehouseWorkLine` |
| Inbound arrival registration | **yes** — `ArrivalJournal` |
| **Putaway work after receipt** | **NO** |
| **Load / load line / load template** | **NO** |
| **Shipment as a consolidation unit** | **NO — and this is the important one** |
| **License plate** | **NO** |

**[REPO]** `Shipment` is `order_id String @db.Uuid` — one row per sales order, carrying a carrier and a
tracking number ([schema.prisma:1210](../../backend/prisma/schema.prisma#L1210)). In D365 a shipment is
the opposite thing: a **grouping of load lines**, possibly spanning several orders. Our "shipment" is
a delivery note; theirs is a consolidation unit. That single modelling difference is what makes
shipment consolidation impossible today, and it is a schema change, not a feature.

**And the live bug you hit yesterday is the missing putaway, not a missing workbench.** Stock sits in
`RCV-001` (`is_receive_location = true`, `is_pick_location = false`) because the product receipt puts
it there and **nothing ever moves it**. There is no putaway work. In D365 that is not a warehouse
being "advanced" — it is step two of the most basic inbound flow.

---

## 2. The official chain

**[OFFICIAL]**
[Warehouse handling of outbound loads](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/outbound-load-handling):

```
Sales order ─▶ Reservation ─▶ Load ─▶ Release to warehouse ─▶ Shipment(s) ─▶ Wave ─▶ Work ─▶ Pick ─▶ Ship confirm
                              ▲                    │
              load planning workbench    shipment consolidation policies
```

Quoted mechanics that matter to the design:

- *"A sales order must exist before an outbound load can be generated. Nevertheless, you can define
  outbound loads before running the release to warehouse procedure."* — the load is a **planning**
  object that exists before the warehouse ever sees the order.
- *"The release to warehouse process creates **load lines** and groups them into **shipments**."* —
  confirming §1: shipment is downstream of load, and is a grouping.
- *"The system generates picking work through **wave processing**… **Work templates** determine how
  work is performed for each warehouse process. **Location directives** specify the pick and put
  locations."* — this is the half we already have.

**[OFFICIAL]**
[Release to warehouse](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/release-to-warehouse-process):
the **Outbound load planning workbench** (*Warehouse management > Loads*) shows tabs for shipments,
sales lines, transfer lines and outbound shipment order lines; you select lines and use *To new load*
/ *To existing load*, then *Release > Release to warehouse*. *"If you're using automatic wave
processing, because loads are already assigned to order lines, the system creates shipments and work
IDs when the release to warehouse operation is performed."*

### Inbound — the part that is actually broken here

**[OFFICIAL]**
[Design details: Inbound warehouse flow](https://learn.microsoft.com/dynamics365/business-central/design-details-inbound-warehouse-flow)
sets out four methods by two toggles, *Require Receipt* and *Require Put-away*:

| Method | Receipt | Putaway | Meaning |
|---|---|---|---|
| A | – | – | post receipt straight from the order line, no warehouse activity |
| B | – | on | inventory putaway, order by order |
| C | on | – | warehouse receipt, consolidated across orders |
| D | on | on | warehouse receipt **then** a separate warehouse putaway — advanced |

And the sentence that names our bug exactly:

> "In method D, the receipt is posted first to record the increase of inventory and that items are
> available for sale. The warehouse worker then **registers the put-away to make the items available
> to pick** for outbound orders."

**We are running a broken method D**: a receipt that lands in a receive location, and no putaway. So
inventory is on hand and not pickable, and nothing in the system knows the difference.

---

## 3. The one-way door we must NOT copy

**[OFFICIAL]**
[Inventory costing FAQ](https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq#dimension-groups):

> "After you save a storage dimension group, you can no longer change the setting of the **Use
> warehouse management processes** option for it. If you decide to use warehouse management processes
> later, you'll have to create a **new warehouse** where the option is enabled. There's **no automated
> process** that you can use to move all the inventory from one warehouse to another warehouse, or to
> copy related configurations to a new warehouse."

There is a whole troubleshooting article about people stuck on exactly this
([Issues moving from basic to advanced warehousing](https://learn.microsoft.com/troubleshoot/dynamics-365/supply-chain/warehousing/move-basic-to-advanced-warehousing)),
and an AX-2012 migration tool to escape it.

**[REC] do not reproduce this.** It is the purest example of what CLAUDE.md §3 warns against: a
capability that cannot be turned on later without a data migration. And we are already free of it by
accident — **[REPO]** `InventoryStock` is keyed on `location_id` for every warehouse, with no
basic/advanced split, so location granularity is universal.

**So WMS depth becomes a per-warehouse behaviour setting, not a dimension model.** A shop that wants
"receive and it's sellable" and a warehouse that wants directed putaway and pick differ by
configuration rows, not by which schema they were created under. This is a genuine advantage over
D365 for our segment and it should be stated as one, not stumbled into.

**[REC]** `WarehouseParameters` per warehouse:

```
require_putaway            false  →  receipt lands in a pick location, sellable immediately
                           true   →  receipt lands in a receive location, putaway work moves it
require_pick_work          false  →  ship confirms straight off the order
                           true   →  wave → work → mobile pick
availability_counts        ALL_LOCATIONS | PICK_LOCATIONS_ONLY
```

That third one is yesterday's decision made explicit and reversible instead of a silent code change.

---

## 4. [CHALLENGE] What a three-store shoe retailer actually needs

The tiebreaker in CLAUDE.md §2 is *would the anchor customer use this?* Applied honestly:

| Capability | Verdict |
|---|---|
| **Putaway** (receive → pick location) | **Needed now.** It is the cause of a live confirmed bug and it is step two of the most basic inbound flow. Not advanced at all. |
| **Availability that respects pick locations** | **Needed now**, and it is one predicate once putaway exists. |
| **Shipment as a grouping** | **Needed soon.** Three stores plus e-commerce means several orders going out on one van. Also the natural home for the carrier tracking the CEO-dashboard map is waiting for. |
| **Load + load planning workbench** | **Worth building, scoped down.** For this customer a load is *today's delivery run*, not a 20-foot container. The workbench is genuinely useful at that scale — one screen showing "what is going out today, on which van". |
| **Mobile picking** | **Real value.** A store employee with a phone beats a printed pick list, and it is the piece that makes the whole chain worth having. |
| Shipment **consolidation policies** (D365 has policies by mode of delivery, order pool, customer requisition…) | **Cut.** Configurable rule engines for grouping are enterprise weight. Group by customer + delivery date + warehouse, hardcoded to start, with the policy table as the later hook. |
| **License plates**, ASN receiving, wave labels, containerisation, cross-docking, cycle counting by ABC class, warehouse app detours, work classes | **Cut.** None of it has a customer asking. |
| Transportation management, rate shopping, carrier integration | **Cut.** One `carrier` + `tracking_number` field, which already exists. |

**The honest summary:** of what was asked for, **putaway is urgent, shipments are near-term, the
workbench is a nice screen over a small data model, and mobile is the payoff.** The enterprise WMS
surface around them is not our market.

---

## 5. Roadmap

### Phase 1 — Putaway, and availability that means something *(the bug fix)*

- `WarehouseParameters` (§3) — per warehouse, defaulting to today's behaviour so nothing changes
  until a warehouse opts in.
- Product receipt creates **putaway work** when `require_putaway` is on: `WarehouseWork` with
  `work_type = PUTAWAY`, from the receive location, to a location chosen by the **existing**
  `LocationDirective` engine. The directive tables are already there and unused — this is the first
  thing that reads them.
- `getAvailableStock` gains the pick-location predicate, **governed by the parameter**, not hardcoded.
- Screen: an inbound work list, so somebody can actually complete the putaway.

**This phase alone closes yesterday's bug properly** — the 15 units in `RCV-001` become 15 units in a
pick location, by a recorded movement rather than by relaxing a check.

### Phase 2 — Shipment as a grouping

- **Migration:** `Shipment` loses `order_id` and gains `ShipmentLine (shipment_id, order_id, order_line_id, quantity)`.
  Existing rows migrate one-to-one — every current shipment becomes a shipment with one order's lines,
  so nothing is lost and nothing changes visibly.
- Grouping key: customer + delivery date + warehouse. The consolidation-policy table is the hook;
  it is not built.
- `Shipment.shipment_number` gets a tenant-scoped unique — **[REPO]** it is a bare `@unique` today,
  the same defect class as `order_number` and `po_number`.

### Phase 3 — Loads and the planning workbench

- `Load`, `LoadLine`, `LoadTemplate` (template = capacity and a name; not a container catalogue).
- **Release to warehouse** as a single operation: load lines → shipments → wave → work, which is the
  official sequence and reuses the wave/work code that already exists.
- The workbench screen: unreleased sales lines on top, loads below, *add to new/existing load*,
  *release*. This is a UI over four tables, and it is the screen Kubi asked for.

### Phase 4 — Mobile picking

**[OFFICIAL]** D365's model is worth taking structurally: **mobile device menu items** with a `Mode`
(*Work* / *Indirect*), *Use existing work*, and a **Directed by** setting of *System directed* (the
system picks the order of work) or *User directed* (the worker picks)
([Set up mobile devices for warehouse work](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/configure-mobile-devices-warehouse)).
Also worth taking: *Display open work list*, explicitly intended for tablets.

**[REC] a mobile web app, not a native one.** We already run Next.js and already ship an Expo POS;
a third client is a maintenance burden a 50-employee customer will never pay for. A phone-shaped
route behind the existing auth, with a barcode scan via the browser camera API, covers scan-location
→ scan-item → confirm-quantity. **[CHALLENGE]** revisit only if a customer's warehouse has no
reliable WiFi, which is the real reason native clients exist in this space.

**Cut from the D365 model:** work classes, menu-item detours, GS1 parsing, work policies. Start with
one work list and two verbs, *start* and *complete*.

### Phase 5 — hooks only

Cycle counting by directive, replenishment work, license plates, cross-docking. Named here so the
scope stays visible; nothing built.

---

## 6. Sequencing note

Phase 1 is a bug fix and should not wait for a decision about phases 3–4. Phase 2 is a schema change
and is best done **before** any more code reads `Shipment.order_id`. Phases 3 and 4 are genuinely
optional and can be judged on their own once 1 and 2 are in.

**Prerequisite that is not warehouse work at all:** the variant data. **[REPO]** 37 units of a
variant-carrying product sit on a `variant_id = NULL` stock row, invisible to every variant-scoped
query. Directed putaway will move rows around; doing that on top of inconsistent variant data will
make it harder to see, not easier. Clean it first.

---

## 7. Sources

- [Warehouse handling of outbound loads](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/outbound-load-handling)
- [Release to warehouse](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/release-to-warehouse-process)
- [Consolidate shipments by releasing from the outbound load planning workbench](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/consolidate-shipments-load-planning-workbench)
- [Design details: Inbound warehouse flow](https://learn.microsoft.com/dynamics365/business-central/design-details-inbound-warehouse-flow)
- [Warehouse management overview](https://learn.microsoft.com/dynamics365/business-central/design-details-warehouse-management)
- [Inventory costing FAQ — dimension groups](https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq#dimension-groups)
- [Issues moving from basic warehousing to advanced warehousing](https://learn.microsoft.com/troubleshoot/dynamics-365/supply-chain/warehousing/move-basic-to-advanced-warehousing)
- [Set up mobile devices for warehouse work](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/configure-mobile-devices-warehouse)
- [Install the Warehouse Management mobile app](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/install-configure-warehouse-management-app)
