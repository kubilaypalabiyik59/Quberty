# ERP setup checklist — what defines what, and in which order

**Written 2026-08-16**, from the Microsoft Learn documentation, at Kubi's instruction: *"normalde
Microsoft dokümantasyonlarında ne nereden başlar, neyi neden tanımlamalısın yazar — git bunu oku,
anla, kendine bir takip listesi çıkar ve bunu uygulamayı fixlemek için kullan."*

This is that list. It exists so that the architecture conversation can start from a shared model
instead of from first principles every time.

**Legend:** ✅ built · 🟡 partial · ❌ missing · ⛔ deliberately out of scope

---

## 0. The one sentence that explains the whole shape

> A transaction never chooses a GL account. It resolves one, from the intersection of **what** is
> moving (the item axis) and **who** it is moving with (the party axis).

Everything below is either an input to that resolution, or a rule about when it may change.

---

## 1. The financial anatomy, stated plainly

Business Central documents the relationships more explicitly than the F&O pages do, and the model is
the same one:

> - The **revenue** posting (income statement) is determined by the combination of the general
>   business posting group **and** the general product posting group.
> - The **accounts receivable** posting (balance sheet) is determined by the **customer** posting group.
> - The **inventory** posting (balance sheet) is determined by the **inventory** posting group.
> - The **cost of goods sold** posting (income statement) is determined by the combination of
>   business **and** product posting groups.
>
> — [Set up posting groups](https://learn.microsoft.com/dynamics365/business-central/finance-posting-groups)

Read that carefully and the design rule falls out:

| Account | Driven by | Axis |
|---|---|---|
| Accounts receivable / payable | the **party** alone | party |
| Inventory | the **item** alone | item |
| Revenue, COGS | party **×** item | both |
| VAT output / input | the **tax code**, resolved party ∩ item | both |

In F&O the same matrix appears as the inventory posting profile, whose **Item code** may be
`Table | Group | All | Category` and whose **Account code** may be `Table | Group | All`
([Inventory posting profiles](https://learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting-profiles)).

**Skarpine already has this matrix.** `PostingProfile.scope_kind` is
`ALL | ITEM | ITEM_GROUP | PARTY | PARTY_GROUP`, resolved most-specific-first. What it lacked until
2026-08-16 was anything to put in the item axis.

---

## 2. The setup order

Microsoft's own "create a released product" procedure gives the mandatory sequence, and the order is
not arbitrary — each step is a prerequisite of the next
([Create a released product for a single company](https://learn.microsoft.com/dynamics365/supply-chain/pim/tasks/create-released-product-single-company)).

### Tier 0 — Organisation and ledger

| # | Thing | Why it must exist first | State |
|---|---|---|---|
| 0.1 | Legal entity | Everything financial is scoped to it | 🟡 `legal_entity_id` nullable on every config table; no table yet — deliberate |
| 0.2 | Chart of accounts | Nothing can post without accounts | ✅ |
| 0.3 | **Main account category** | Country-independent meaning, so reports and posting work without per-country code | ✅ `Account.category` (migration 003) |
| 0.4 | Fiscal calendar / periods | Posting must be refusable into a closed period | ✅ `AccountingPeriod` |
| 0.5 | Currency + exchange rates | Any foreign purchase is unrecordable without it | ❌ **no `Currency` or `ExchangeRate` table**; four different currency defaults exist in the schema |
| 0.6 | Number sequences | Every document needs an identity | ✅ 7 references configured |

### Tier 1 — Party and item classification (the two axes)

| # | Thing | Why | State |
|---|---|---|---|
| 1.1 | **Item model group** | HOW an item is valued: costing method, stocked or not, whether physical/financial updates post to the ledger | ✅ **new, migration 008** |
| 1.2 | **Item group** | WHERE its money goes — the item axis of the posting matrix | ✅ **new, migration 008** |
| 1.3 | Customer group / vendor group | The party axis of the same matrix | ❌ **missing** — `PostingProfile.scope_kind = PARTY_GROUP` is defined and unreachable, exactly as ITEM_GROUP was |
| 1.4 | Product dimension group (size/colour/style) | For shoes the VARIANT is the stocking unit | 🟡 `ProductVariant` exists with size/colour; no dimension *group* concept, and **[OFFICIAL]** a product cannot be converted between variant models later |
| 1.5 | Storage dimension group (site/warehouse/location) | Decides at which granularity stock is tracked and costed | 🟡 the dimensions exist; the *group* that declares which are active does not |
| 1.6 | Tracking dimension group (batch/serial) | Same, for traceability | ❌ |
| 1.7 | Unit of measure + conversions | A purchase in boxes and a sale in pairs need a conversion | 🟡 `UnitOfMeasure` exists; **no conversion table** |
| 1.8 | Tax groups (party ∩ item) | Which tax codes apply | ✅ |

### Tier 2 — Posting configuration

| # | Thing | State |
|---|---|---|
| 2.1 | Posting profiles per posting type, resolved most-specific-first | ✅ |
| 2.2 | …resolvable by **item group** | ✅ possible from 008; ❌ **not yet used by the posting routes** |
| 2.3 | …resolvable by **party group** | ❌ needs 1.3 |
| 2.4 | Tax codes with the correct base | ✅ **fixed 2026-08-16**, see [BOLIVIA_TAX_BASIS.md](../process/BOLIVIA_TAX_BASIS.md) |
| 2.5 | Financial dimensions (Store / cost centre) | ❌ **missing and unbackfillable** — three stores, no per-store P&L |

### Tier 3 — Transactions

Sales, purchase, inventory, warehouse. ✅ broadly built. The chain in front of them was added
2026-08-15/16 — see [PROCESS_CHAIN.md](../process/PROCESS_CHAIN.md).

---

## 3. What each of the two new groups actually controls

### Item model group — [official](https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq)

| Setting | Official meaning | Built |
|---|---|---|
| Costing method | "You can select only **one** costing model for each released product. The item model group controls this behavior." | ✅ column; only FIFO implemented in the engine |
| **Stocked product** | "If you don't enable [it], the system doesn't track any inventory transactions in the inventory subledger, and the cost of the items is typically expensed into your general ledger." | ✅ column; ❌ not honoured by the inventory service yet |
| Post physical inventory | Whether a product receipt / packing slip raises a voucher | ✅ column, ❌ not honoured |
| Post financial inventory | Whether an invoice raises a voucher | ✅ column, ❌ not honoured |
| Include physical value | Include physically-updated receipts in the running average | ✅ column, ❌ not honoured |
| Fixed receipt price | Receipt price as standard cost, variance posted | ✅ column, ❌ variance accounts not configured |

**The important one is `stocked`.** Today every product is implicitly stocked, so a repair service or
a delivery charge cannot be sold without inventing a phantom stock record. That is a real limitation
for a shoe shop that also does repairs.

### Item group

Purely the posting axis. **[OFFICIAL]** *"to manage how information is posted to main accounts,
create a series of different item groups that are associated with specific main accounts. This
process lets you track the inventory value of items at different stages."*

Deliberately **not** merged with the existing `ProductCategory`, which is a merchandising hierarchy
for the storefront. F&O keeps them apart too — the posting profile lists *Group* and *Category* as
different axes. A merchandising re-shuffle must never silently repoint the ledger.

---

## 4. The rule that constrains all of this

> **[OFFICIAL]** "Use caution when you change groups in master data… If you change the item group
> that you assigned to an item after transactions exist, the revenue on new transactions posts to the
> updated account. However, any revenue that you posted before the change remains in the original
> account."
> — [Recommended practices for posting profiles](https://learn.microsoft.com/dynamics365/finance/general-ledger/recommended-practices-pstg-prfles)

Consequences adopted here:

1. Provisioning **creates** the groups but does **not** auto-assign products to them. It reports how
   many are unassigned and says why it will not guess.
2. Assignment must eventually be blocked, or warned on, once a product has posted transactions.
   *(Not yet implemented — item 5.3 below.)*
3. Dimension groups are worse still: **[OFFICIAL]** the product dimension group cannot be changed
   after the record is created, and storage/tracking groups only while on-hand is zero.

---

## 5. The backlog this produces, in dependency order

| # | Work | Why it is where it is | Size |
|---|---|---|---|
| 5.1 | **Use the item group in posting** — resolve `ctx.itemGroupId` per line and split the journal by group | The tables exist and are unreachable from the posting routes; this is what makes 008 pay off | M |
| 5.2 | **Customer / vendor groups** | Completes the party axis; `PARTY_GROUP` is defined and unreachable | S |
| 5.3 | **Guard group changes once transactions exist** | The official warning above; cheap now, ugly later | S |
| 5.4 | **Honour `stocked = false`** | Lets services and charges be sold at all | M |
| 5.5 | **Financial dimensions (Store axis)** | Three stores, no per-store P&L, and the attribution of a past transaction is **unrecoverable** | L |
| 5.6 | **Currency + exchange rate tables** | Foreign purchases are unrecordable; the functional-currency amount must be stored **at transaction time** or history cannot be restated | L |
| 5.7 | **UoM conversions** | Buy in boxes, sell in pairs | S |
| 5.8 | **Per-line tax** | Required before Turkey or Germany; now spans quotation, requisition and RFQ lines too | M |
| 5.9 | **Dimension groups proper** | **[OFFICIAL]** cannot be changed after creation — every day of transactions raises the cost | L |
| 5.10 | Procurement category hierarchy + purchasing policies | Category-based buying, category access rules, RFQ thresholds | ⛔ **not now** — see below |

### On the procurement hierarchy specifically

Kubi named it, so here is the honest read. In D365 a procurement category hierarchy drives: which
categories a requester may order from (category access policy rule), which vendors are allowed per
category, informal-versus-formal RFQ thresholds, and catalog visibility
([Purchasing policies](https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-policies)).

Every one of those is an **internal control** mechanism for an organisation with many requesters and
a procurement department. The anchor customer has one owner who decides what to buy. Building the
hierarchy now would add a table, a policy engine and a UI that nobody in the target market would
populate.

**What it does affect financially** is posting: the F&O inventory posting profile accepts
`Item code = Category`. That is the hook worth keeping in mind — but it is the *same* item axis the
item group already provides, at a different granularity. The recommendation is therefore: item group
now, category later, and only if a customer needs category-level accounts that item groups cannot
express.

---

## 6. How to use this list

When a change is proposed, locate it in the tiers above. If its prerequisites are ❌, that is the
conversation — not the change itself. The most common failure in an ERP implementation is building
tier 3 on a missing tier 1, which is exactly how this codebase ended up with hardcoded account codes
in the posting routes.
