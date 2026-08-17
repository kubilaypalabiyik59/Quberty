# CEO Dashboard — design

> Status: **design only.** No code written from this document yet except the chart
> tokens (§6, Phase 0). Opened 2026-08-16.
>
> Two inputs drove it: [HyperUI](https://hyperui.dev/components/application/charts/) as a
> chart-composition reference, and the `ERP Gamification` panel at `D:\ERP Gamification`
> (a separate Next.js app, read in full for this document) as the operations-panel reference.

Labels used throughout, per [CLAUDE.md §5](../../CLAUDE.md):
**[OFFICIAL]** Microsoft Learn · **[REPO]** verified in this or the referenced codebase ·
**[REC]** my architectural recommendation · **[ASSUMPTION]** needs validation.

---

## 1. Why this exists

Kubi's framing, and it is correct: the process work is ahead of the interface. The product
now has a real document chain, a real posting engine and a real tax engine — and it presents
all of it as data grids. A CEO cannot read a data grid to find out where the business is
stuck.

The panel's job is **translation, not invention.** The data already exists and is already
correct. It is simply not readable without knowing where to click.

---

## 2. What we take from the gamification panel — and what we do not

### Take

| Idea | Why it survives the port |
|---|---|
| **Facts on the wire, derivation in the browser** | The server sends status + dates. Position, colour and progress are computed client-side from a virtual clock: `progress = clamp((now − start) / (due − start), 0, 1)`. Motion stays smooth however far apart the refreshes are, and swapping the data source never touches the render code. **[REPO]** `D:\ERP Gamification\src\domain\health.ts`, `README.md` |
| **One agent per document, never one aggregate** | Every order, purchase and collection is an independent unit. One turning red does not affect the others, and the panel does not choke as volume grows. **[REPO]** `src/domain/agent.ts` |
| **`unknown` is a real health state** | Painting a job green when it has no time window is the panel claiming "all is well" with no evidence. No plan → no colour claim. This matters more here than there, because our sales orders have no due date at all today (§5). |
| **Colour marks a situation, never a person** | No screen names a responsible employee. A panel that assigns blame gets gamed, and then the data it draws from starts lying. Enforced by test in the source repo; we keep the rule and the test. |
| **No location is hardcoded** | Every place is a coordinate resolved from data. Matches this repo's standing "parametric and configurable" rule. |
| **Four floors, quiet to rich** | Process cards → map → station strip → journey stage. Floors 1–3 stay deliberately plain so all the appetite lands on floor 4. A control room has quiet walls and one lit table. |

### Reject or adapt

| Their choice | Ours | Reason |
|---|---|---|
| **Make to Order is the flagship process** | **Order to Cash is** | Order to Make is explicitly out of scope ([CLAUDE.md §4](../../CLAUDE.md)) — the anchor customer is a retailer. Their flagship does not exist in our product, and the two processes they left shallow (O2C, S2P) are exactly our two in-scope ones. **This is a rebuild of the content on top of their engine, not a port.** |
| The walking figure's spine is a **production order lead time** | The spine is the **shipment** | Kubi's correction, 2026-08-16: e-commerce already has the real journey — order placed → handed to carrier → delivered to the customer's address. That is the motion worth drawing, and it is the one a carrier tracking API can later feed for real. |
| CSS Modules, own palette | Our design tokens | A component here never names a raw colour. See [skarpine-design-system](../../HANDOVER.md#4-active-workstream--frontend-design-system-opened-2026-08-14). |
| Reads D365 OData entity JSON | Reads our Prisma models through a source adapter | Same shape of boundary: renaming happens in exactly one layer. |
| Nominatim geocoder + hand-entered override coordinates | Needs a tenant-scoped coordinate cache (§5) | We have no coordinates at all today. |
| Position is always clock-derived | Position comes from a **pluggable source** (§4) | Kubi's requirement. Clock today, carrier API tomorrow, without touching the render. |

---

## 3. One correction to the source brief, from Learn

The gamification brief states the delegation chain is four stops —
*confirmation → picking → packing slip → invoice* — and calls that the official flow. That is
**Document Status**, and it is right as far as it goes:

> **[OFFICIAL]** The **Document Status** enumeration specifies the most recent document
> generated for the order: `Confirmation → Picking List → Packing Slip → Invoice`.
> The **Status** enumeration specifies the overall order status:
> `Open Order → Delivered → Invoiced → Canceled`.
> — [Set up the mapping for the sales order status columns](https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/data-entities/dual-write/sales-status-map)

But **Document Status cannot express a partial**, and the partial split is a headline feature
of the visual language — the character divides in two, half gone and half still waiting. The
enumeration that carries it is **Processing Status**:

> **[OFFICIAL]** `Active · Confirmed · Picked · Partially Delivered · Delivered ·
> Partially Invoiced · Delivered and Partially Invoiced · Invoiced · Canceled`
> — same page, "Mappings for the updated Dual-write Supply chain solution"

**Consequence for us:** the station strip is drawn from the four Document Status stops, but the
figure's *state within a stop* — and whether it splits — is read from Processing Status. Building
the strip on Document Status alone would silently drop every partial, which is precisely the case
the visual language exists to make obvious.

Our own equivalent already exists: `documentChain.ts` carries the provenance enums and the two
official aggregation rules. **[REPO]** `backend/src/shared/services/documentChain.ts`

---

## 4. The architectural addition — `PositionSource`

Kubi's requirement, and it is the thing that makes this worth building rather than decorating:

> *"ileride kamyonun nerede olacağını anlayacağımız bir api alırız, sen apiye göre mal nerede
> görürsün"*

The source panel derives position from the clock and only from the clock. If we hardcode that,
plugging in carrier tracking later means rewriting the render layer. So the derivation is named
and made replaceable:

```ts
/** Where a piece of work physically is, right now. */
type PositionSource = {
  kind: 'clock-derived' | 'carrier-tracking' | 'manual-checkpoint';
  /** 0..1 along the route, or an explicit coordinate when the source knows one. */
  resolve(agent: Agent, now: number): { t: number } | { lat: number; lng: number };
  /** Never claim precision the source does not have — drives how the figure is drawn. */
  confidence: 'planned' | 'observed';
};
```

- **`clock-derived` / `planned`** — today. Interpolates between `shipped_at` and the promised
  delivery date. The figure is drawn with a soft edge, because it is a plan, not an observation.
- **`carrier-tracking` / `observed`** — later. The figure gets a hard edge and a real coordinate.
- **`manual-checkpoint` / `observed`** — a warehouse user marking "left the depot". Cheap, and
  useful for a customer with no carrier API at all.

**[REC]** The `confidence` field is the part not to skip. A panel that draws a guessed position
identically to a measured one is the same failure as painting an unplanned job green.

---

## 5. Data gaps found — three, all with cheap hooks

**[REPO]** verified against `backend/prisma/schema.prisma`.

### 5.1 Sales orders have no promised delivery date — **blocking**

| Document | Time window |
|---|---|
| `PurchaseOrder` | `order_date` + **`expected_date`** — S2P health is computable today |
| `SalesOrder` | `confirmed_at`, `shipped_at`, `completed_at`, `paid_at` — **no due date at all** |

`healthOf()` needs a start *and* an end. Without an end, every O2C agent is `unknown` and the
whole traffic light is grey on the half of the panel that matters most.

**Decision (Kubi, 2026-08-16): add it.** One nullable column,
`SalesOrder.requested_delivery_date` — the counterpart of D365's `RequestedReceiptDate`.
Additive, nullable, existing rows untouched; orders without one stay honestly `unknown`.

### 5.2 No coordinates anywhere

`Site`, `Customer` and `Supplier` all carry `address` / `city` / `country` and **no lat/lng**.
The map needs a tenant-scoped coordinate cache keyed by a normalised address hash, so the same
store is geocoded once. Deferred to Phase 3, but the table is the hook.

### 5.3 The missing dimension is **warehouse**, not site — **blocking**

> **Correction, 2026-08-16.** An earlier revision of this section asked "which site does an order
> belong to — the one that took it or the one that ships it?" and recommended capturing it from
> the user's assigned site. **That was a false question and the recommendation was wrong.** Kubi's
> correction: *site is the warehouse's site.* It is not an independent attribute of the order.

**[REPO]** `Warehouse.site_id` is `String @db.Uuid` — **not null**. Every warehouse belongs to
exactly one site, always. So `SalesOrder.site_id` is not data to be captured; it is a
**denormalised copy of `warehouse.site_id`**, and it must never be able to disagree with it.

Keeping the copy is still right — D365 carries site and warehouse together as inventory
dimensions, and joining through the warehouse on every geographic query is needless work. But it
is *derived*, never entered.

**Which relocates the defect.** Running it against the test tenant:

```
sales_orders             51 rows   site 0   warehouse 10
sales_quotations          6 rows   site 0   warehouse  6
purchase_requisitions     5 rows   site 0   warehouse  5

sales orders by provenance:   DIRECT 48 → 7 with warehouse
                              QUOTATION 3 → 3 with warehouse
```

The documents built during the process-chain work set the warehouse every time. **The old direct
sales path sets it on 7 of 48**, because `warehouse_id` is optional in the payload and nothing
enforces it (`sales.service.ts:53` passes `data.warehouse_id` straight through; `pos.routes.ts:48`
writes `warehouse_id ?? null`).

So the fix is two things, in this order:

1. **Make `warehouse_id` required on the sales write paths** (ERP order, POS, storefront), defaulted
   from the user's or terminal's warehouse. This is the real gap.
2. **Derive `site_id` from it** on write, and backfill the 10 orders that already have a warehouse.
   The other 41 cannot be backfilled — there is nothing to derive from. They stay null and honestly
   report as unattributed.

### 5.3b And it is not only a reporting problem

**[REPO]** `sales.routes.ts:500-506`, the **return** path:

```ts
if (order.warehouse_id) stockWhere.location = { zone: { warehouse_id: order.warehouse_id } };
const stock = await db.inventoryStock.findFirst({ where: stockWhere });
```

When the order has no warehouse the filter is skipped, so `findFirst` — with no ordering —
restores the returned goods to **whichever stock row the query happens to reach first**. On a
single-warehouse tenant that is invisible. This tenant has three warehouses and 41 orders with no
warehouse, so a return can silently put stock in the wrong building.

**[REC]** Worth confirming with the same execution approach that found it, and fixing alongside
item 1 above — the root cause is the same optional field.

### 5.4 The site master will mislead the map on day one

**[REPO]** the same run:

| name | city | country |
|---|---|---|
| Istanbul | Istanbul | TR |
| Ankara | Ankara | TR |
| Warehouse Bolivia | La Paz | BO |
| Santa Cruz Store Site | **Bolivia** | BO |

Two Turkish sites in a Bolivian tenant (the template leftovers again, same family as
`PurchaseOrder.currency = TRY`), and one row with a **country in the city column** — geocoding
"Bolivia" as a city drops that store at the centroid of the country, roughly 400 km from Santa
Cruz. The map would look plausible and be wrong, which is worse than looking broken.

**Before Phase 3, the site master needs a clean-up pass and a validation rule.** Test data, so the
clean-up is cheap; the validation rule is what stops it recurring.

`Site.country` also still defaults to `"TR"` (already on the known-issues list).

---

## 6. Charts — the honest diagnosis, and Phase 0

### The diagnosis is not "too few chart types"

**[REPO]** `frontend/src/components/erp/charts/SalesChart.tsx` is the product's only chart
component, and it hardcodes hex — including a **maroon/red dark palette** left over from the
visual direction we abandoned when the accent became deep teal:

```
tickColor   = dark ? 'rgba(255,180,180,0.3)' : '#9ca3af'
gridColor   = dark ? 'rgba(255,80,80,0.06)'  : '#f3f4f6'
defaultFill = dark ? '#b91c1c' : '#3b82f6'
Cell fill   = i === maxIdx ? '#22c55e' : '#e5e7eb'
```

So the dashboard is not merely plain — it is **outside the design system**. Adding chart types on
top of that produces a decorated inconsistency. Tokens first.

### On HyperUI specifically

**[REPO/verified externally]** HyperUI ships **Chart.js**-based, **Tailwind v4**, copy-paste
**plain HTML**. We run **Tailwind 3 + Recharts + React**. Two consequences:

1. Adding Chart.js means a second chart library — reintroducing the "two parallel component
   systems" problem this frontend workstream was opened to remove.
2. HyperUI markup hardcodes `bg-white` / `text-gray-*`: the exact classes the design system
   forbids and the legacy bridge exists to delete. Pasting it *increases* the debt.

**[REC] Take the composition, not the code.** The stat-card row, the chart-card header/filter
layout and the details-list rhythm are worth copying as *shapes*; we rebuild them in Recharts
against tokens. HyperUI is MIT, so either route is licensed — this is an architecture call, not
a legal one.

### Phase 0 — the series palette

The design system has an accent and four semantics and **no categorical series ramp**, which is
why every chart invented its own. Both ramps below were validated with the `dataviz` skill's
checker (lightness band, chroma floor, CVD separation, normal-vision floor, contrast) rather
than chosen by eye — **all checks pass in both modes**:

| Slot | Light (on `#ffffff`) | Dark (on `#151b23`) |
|---|---|---|
| 1 | `#0d9488` teal | `#12a594` |
| 2 | `#d1490b` orange | `#e2703a` |
| 3 | `#4f46e5` indigo | `#6d76e0` |
| 4 | `#b45309` amber | `#c08a1e` |
| 5 | `#c026d3` magenta | `#c85bd8` |

Notes that must travel with the palette:

- **Slot 1 is not the accent token.** `--accent` (`hsl(184 72% 26%)`) fails the chroma floor —
  at that lightness it reads grey as a fill. The chart ramp is a *sibling* of the accent hue,
  not the accent step itself.
- **Worst adjacent tritan ΔE is 6.1–7.7**, inside the 6–8 band. That is legal only with
  secondary encoding, so every chart with ≥2 series ships a legend, and ≤4 series are also
  direct-labelled. Not optional.
- **Status colours stay reserved.** `success / warning / danger` carry the traffic light and are
  never reused as "series 4". The traffic light is the dominant colour job on this panel, and a
  series that borrows a status colour makes it unreadable.
- Dark is a **selected** set of steps for the dark band, not an automatic lightening.

---

## 7. Phases

| Phase | Delivers | Depends on |
|---|---|---|
| **0** | Chart tokens: series ramp into `globals.css` + `tailwind.config.ts`; `SalesChart` off hardcoded hex; maroon dark palette deleted | nothing |
| **1** | `/reports/ceo-dashboard`: S2P + O2C process cards (agent count, health distribution, worst single item), the four-stop station strip, and the event feed | §5.1 migration |
| **2** | Journey stage — drill into one document and watch its whole story: Requisition→RFQ→PO→Receipt→Invoice→Payment, or Quotation→Order→Shipment→Invoice→Payment | Phase 1 |
| **3** | Map, geocoding cache, `PositionSource` with a real carrier adapter | §5.2, and a customer with a journey worth drawing |

Phase 1 needs **no geocoding** and answers most of what a CEO actually asks. That is why the map
is not first.

---

## 8. What we are NOT building — recorded on purpose

Per the standing rule that deferred scope stays visible:

- **No forecasting or projection.** "This order will get stuck on Thursday" is out. The panel
  reports what is, not what might be.
- **No history replay.** The architecture allows it (facts + a clock), but it is not built.
- **No person-level anything** — not a name, not a leaderboard, not a productivity metric. This
  is a permanent rule, not a deferral.
- **No role-based scoping** in Phase 1; the panel assumes one viewer who may see everything.
  The eventual shape is department head → own module, C-level → whole picture.
- **No Make to Order floor**, and no schema hook for one. Correct per CLAUDE.md §4.
- **No real-time push.** Refresh interval is a parameter. **[OFFICIAL]** D365's own throttling
  makes per-second polling impossible against F&O; for our own database it is merely wasteful.
  15 minutes reads as "live" to a CEO.

---

## 8b. Finance / General Ledger — does our structure match the reference model?

Checked against Learn on 2026-08-17, at Kubi's request, because a mismatch here would be
expensive to discover later.

### What matches, and matches deliberately

| Reference concept | Ours | Verdict |
|---|---|---|
| Main account + **main account category** | `Account.code` + `Account.category` (migration 003) | **Match.** Adopted for the documented reason — categories make the default reports work "without making any modifications" ([Plan your chart of accounts](https://learn.microsoft.com/dynamics365/finance/general-ledger/plan-chart-of-accounts)). It is also what makes the chart country-independent. |
| Account type / normal balance | `Account.type`, `Account.normal_balance` | Match |
| **General Posting Setup** — "combinations of general business and general product posting groups […] map customers, vendors, items […] to general ledger accounts" ([Understand the general ledger and COA](https://learn.microsoft.com/dynamics365/business-central/finance-general-ledger)) | `PostingProfile` with `scope_kind` ITEM → ITEM_GROUP → PARTY → PARTY_GROUP → ALL | **Match, and a close one.** Our most-specific-first resolver *is* the party × product posting matrix. `ItemGroup` supplies the product axis; `PARTY_GROUP` is the customer axis and is still unpopulated. |
| Journal-based posting, voucher numbering | `JournalEntry` / `JournalLine` + `numberSequence.service` | Match |
| Fiscal periods | `AccountingPeriod` | Match |

### The one real gap: **financial dimensions do not exist**

**[OFFICIAL]** "You can include up to 10 additional financial dimensions in the account structure.
The account structure defines which dimension values are valid in combination with other values."
— [Financial dimensions and posting](https://learn.microsoft.com/dynamics365/finance/general-ledger/default-dimensions)

**[OFFICIAL]** "instead of setting up separate general ledger accounts for each department and
project, you can use dimensions as a basis for analysis and avoid having to create a complicated
chart of accounts." — [Understanding the Chart of Accounts](https://learn.microsoft.com/dynamics365/business-central/finance-chart-of-accounts)

**[REPO]** `JournalLine` carries no dimension column of any kind. There is no `AccountStructure`,
no `DimensionValue`, no `Ledger` and no `LegalEntity` entity.

**This absence is deliberate and CLAUDE.md §3 argues for it** — a generic EAV dimension framework
is exactly the indirection that makes D365 painful to report against, and easy reporting is this
product's selling point. That reasoning still holds. **But the operational rule in the same section
says a deferred capability must ship with a documented schema hook, and this one has none.**

**The cost is already concrete, and this session found it.** Sales orders now carry a derived
`site_id`, so "open value by site" works on the *document* side — but the dimension stops there. It
never reaches `JournalLine`, so **a profit-and-loss by site or by store cannot be produced at all.**
For a three-store retailer that is close to the first question an owner asks.

**[REC] The hook, and it is small.** Two nullable FK columns on `JournalLine` — `site_id` and
`dimension_2_id` — rather than a generic key/value table. That covers the dimension a retailer
actually has (which store), keeps every query a plain join, and does not commit us to the account
structure / advanced rules machinery. If a tenant later needs a third and fourth axis, *that* is
when the generic table earns its place; migrating two typed columns into it is cheap, whereas
backfilling dimensions onto historical ledger lines that never captured them is not possible at all.

**Not implemented. Flagged for the Finance co-founder before anything is built** — the choice of
which axes are worth a column is an accounting decision, not an architectural one.

---

## 9. Open questions

1. **Does any tenant have a journey worth mapping?** Kubi's position is that Bolivia may not
   today, but Turkey / Netherlands / Germany later will, and the e-commerce delivery leg already
   qualifies. Accepted — but Phase 3 should still wait for one real multi-location dataset rather
   than being built against invented coordinates.
2. **Which carrier?** The `PositionSource` contract is written to be carrier-agnostic, but the
   first real adapter will reveal what the contract is missing. **[ASSUMPTION]** that a tracking
   number plus a polled status endpoint is enough.
3. **Is `requested_delivery_date` customer-promised or internally-planned?** They diverge the
   moment anyone renegotiates. D365 keeps both (`RequestedReceiptDate` vs `ConfirmedReceiptDate`).
   Starting with one; the second is another nullable column when it is needed.
