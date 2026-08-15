# Order to Cash — Reference Process Model

**Phase 1 deliverable.** Reference model only. Gap analysis is in [GAP_ANALYSIS.md](GAP_ANALYSIS.md).

Catalog ID **65**. Labels: **[OFFICIAL]** · **[REC]** · **[ASSUMPTION]** · **[UNVERIFIED]**.

---

## 1. Two corrections to our working assumption

> **This section is the most important output of Phase 1.** Two things we had placed inside O2C are
> officially outside it. Both change where our schema seams belong.

### 1.1 Lead → Opportunity → Quotation is NOT Order to Cash

**[OFFICIAL]** *"The process defined here **does not include** the process for marketing to
prospective customers, tracking leads and opportunities and the creation of quotes. Learn more at
Prospect to quote overview."*
([order-to-cash-introduction](https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-introduction))

That chain is **Prospect to Quote (85)**, a separate end-to-end process, officially *upstream* of
O2C.

**Why this matters architecturally:** we had planned to build the quotation chain as "the missing
front of O2C". Treating it as a separate process with a defined handoff means the seam is a
**document conversion boundary** (quote → order), which is exactly where a nullable FK plus a
conversion audit trail belongs. Building it "inside" O2C would have produced a single sprawling
sales document with a mode flag — much harder to extend later.

### 1.2 Shipment / load / wave / packing slip is NOT Order to Cash

**[OFFICIAL]** *"the order to cash process described here **does not include order fulfillment
process**. The process of fulfilling orders is described in the inventory to deliver process."*
(same source)

Fulfilment is **Inventory to Deliver (60)**, officially *nested inside* O2C:
**[OFFICIAL]** *"When the inventory to deliver process is completed as a sub process in the order to
cash process, the order to cash process continues. For example, the invoicing, payment, and
collection of payment for the sales."*
([inventory-to-deliver-overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/inventory-to-deliver-overview))

**Note for Skarpine:** the wave / work template / location directive layer already in the codebase
belongs to I2D, not O2C. Part of the "third process" is already built.

---

## 2. Business process areas (Level 2)

**[OFFICIAL]** ([order-to-cash-overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-overview))

1. Develop sales policies
2. Manage sales orders
3. **Manage accounts receivable**
4. **Manage credit and collections**
5. Analyze sales performance

Note there is no fulfilment area and no quotation area. Areas 3 and 4 are half the process and are
the half Skarpine has least of.

**[OFFICIAL]** Upstream: Case to resolution, Forecast to plan, Plan to produce, Design to retire,
**Prospect to quote**.
Downstream: Case to resolution, Forecast to plan, Plan to produce, Source to pay, Design to retire,
**Inventory to deliver**, **Record to report**.

Downstream is identical to Source to Pay's downstream: **I2D + R2R**. That convergence is the
architectural centre of gravity — see [FOUNDATIONS.md](../architecture/FOUNDATIONS.md).

---

## 3. Document chain and state model

**[REC]** Composite chain across the three processes, showing which process owns each document:

```
Prospect to Quote (85)      Order to Cash (65)          Inventory to Deliver (60)
──────────────────────      ──────────────────          ────────────────────────
Lead
 → Opportunity
 → Quotation ──────────────→ Sales order
                              │                          → Load
                              │                          → Shipment
                              │                          → Wave → Work (pick/pack)
                              │                          → Packing slip ──┐
                              ↓                                           │
                            Customer invoice ←───────────────────────────┘
                              → AR settlement / payment
                              → Collections (if overdue)
```

**[REC]** State model. Same principle as P2P: **delivery state and invoice state are independent
axes.**

```
Quotation   DRAFT → SENT → ACCEPTED → CONVERTED
                         ↘ REJECTED / EXPIRED
SalesOrder  DRAFT → CONFIRMED → PARTIALLY_DELIVERED → DELIVERED
                              → PARTIALLY_INVOICED  → INVOICED → CLOSED
                              ↘ CANCELLED
Shipment    OPEN → PICKED → PACKED → SHIPPED → DELIVERED
Invoice     POSTED → PARTIALLY_SETTLED → SETTLED
                   ↘ CREDITED (credit note)
```

**[OFFICIAL]** Partial delivery and partial invoicing are first-class in the reference model:
*"You can also create a partial shipment and a partial invoice by filling in the Qty. to Ship and
Qty. to Invoice fields on the individual sales order lines before you post."*
([ui-post-sales](https://learn.microsoft.com/dynamics365/business-central/ui-post-sales) — Business
Central, cited because it states the principle most plainly; the same split exists in F&O)

**[REC]** This means quantity tracking lives on the **line**, in three separate accumulators:
`quantity`, `delivered_qty`, `invoiced_qty`. A header-level boolean cannot express it. For a shoe
retailer this is not theoretical — a customer orders five pairs, three are in stock, two follow next
week, and the factura must match what actually shipped.

---

## 4. Posting: packing slip vs invoice

**[OFFICIAL]** *"Two main activities post to the general ledger for a sales order: 1. Packing slip
2. Invoice"*
([sales-order-posting](https://learn.microsoft.com/dynamics365/finance/general-ledger/sales-order-posting))

| Event | Inventory | GL | Notes |
|---|---|---|---|
| Quotation accepted | — | — | Status only |
| Sales order confirmed | Reserved / on-order ↑ | — | Status only |
| Wave / work / pick | Bin-level movement | — | Physical location change, no value change |
| **Packing slip** | **Physical issue** | **Physical posting** | Goods gone, revenue not yet earned |
| **Invoice** | **Financial issue** | **Financial posting** | Revenue + COGS + AR + tax |
| Payment | — | AR settlement | Subledger |
| Credit note | Physical + financial reversal | Reversal posting | See §6 |

### Physical posting — packing slip

**[OFFICIAL]** Posting types (same source):

| Posting type | Type | Dr/Cr | Clearing |
|---|---|---|---|
| `Cost of units, delivered` | Asset | Credit | Yes |
| `Cost of goods sold, delivered` | Expense | Debit | Yes |

**[OFFICIAL]** Both are clearing accounts — *"The amount in this account is reversed when a sales
order invoice is posted."*

### Financial posting — invoice

**[OFFICIAL]** Posting types:

| Posting type | Type | Dr/Cr | Notes |
|---|---|---|---|
| `Cost of units, invoiced` | Asset | Credit | The balance-sheet inventory relief |
| `Cost of goods sold, invoiced` | Expense | Debit | The P&L COGS |
| `Revenue` | Revenue | Credit | Offsets to AR posting profile |
| `Discount` | — | — | Optional; *"many accounting regulations, such as GAAP and IFRS, require that discounts reduce the sales revenue, and therefore these accounts aren't used in many scenarios"* |

**[OFFICIAL]** Critical detail: the revenue offset does **not** come from the inventory posting
profile — *"The offset to this account is the Summary account (Customer balance) on the **Accounts
receivable posting profile**."*

**[REC]** So there are **two distinct posting-profile families**:

| Family | Resolves | Keyed by |
|---|---|---|
| **Inventory posting profile** | Inventory, COGS, revenue accounts | item / item group + party / party group |
| **AR / AP posting profile** | Customer balance (AR control), vendor balance (AP control) | customer / customer group, vendor / vendor group |

Collapsing these into one table is a modelling error that surfaces the moment a second AR control
account is needed (e.g. related-party receivables, or a separate control account per store).

---

## 5. Tax — the resolution model

**[OFFICIAL]** ([indirect-taxes-overview](https://learn.microsoft.com/dynamics365/finance/general-ledger/indirect-taxes-overview))

- **Sales tax group** — attached to the **party** (customer or vendor)
- **Item sales tax group** — attached to the **resource** (product / service / category)
- *"the intersection of sales tax codes in the sales tax group and the item sales tax group
  determines the sales tax codes that apply to that transaction"*
- Both are required on every transaction line; both default from master data and are overridable
- Sales tax **codes** carry the actual rate and posting behaviour

**[REC] Why this exact model solves Bolivia cleanly.** IVA applies to both purchases and sales; IT
applies to **sales only** (it is a turnover tax). With an intersection model this needs no special
case:

| Group | Contains codes |
|---|---|
| Sales tax group `BO-CUST-DOM` (on customers) | `IVA-13`, `IT-3` |
| Sales tax group `BO-VEND-DOM` (on vendors) | `IVA-13` |
| Item sales tax group `BO-GOODS` (on products) | `IVA-13`, `IT-3` |

A sale intersects to `{IVA-13, IT-3}`. A purchase intersects to `{IVA-13}`. IT never appears on a
purchase — not because of an `if`, but because the vendor's group does not contain it.

This is why the tax engine must not be designed from the purchase side alone: derived only from
P2P, `IT-3` would never appear in the model at all.

**[REC]** `IVA-13` must carry an `is_inclusive` flag (Bolivia prices include IVA) and a
`recoverable` flag (IVA is recoverable input/output VAT; IT is not — it is a P&L expense with a
matching liability). Skarpine's current entries already reflect this asymmetry correctly.

---

## 6. Returns and credit notes

**[OFFICIAL]** Case to Resolution is officially downstream of I2D and *"is also the starting point
for many returns and exchanges"*
([inventory-to-deliver-overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/inventory-to-deliver-overview))

**[OFFICIAL]** The return posting sequence mirrors the outbound one: *"Just as the invoice update
process is the update of the financial transaction, the packing slip update process is the physical
update of the inventory record."* Disposition actions (scrap, return to customer, replacement) are
executed at packing-slip update.
([sales-returns](https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/sales-returns))

**[REC]** For a shoe retailer, returns and size exchanges are a **primary** flow, not an exception.
A return that is modelled as `returned_at = <timestamp>` on the order header cannot express: partial
return, exchange for a different variant, restocking vs scrap, or the credit note that Bolivian tax
law requires as a separate fiscal document.

**[ASSUMPTION — needs validation]** Bolivian *nota de crédito-débito* is a distinct fiscal document
with its own legal numbering series, separate from the factura series. If so, the numbering
framework must support multiple independent legal series, not one global counter.

---

## 7. Configuration entities

Same foundation set as S2P (see [P2P_REFERENCE.md §6](P2P_REFERENCE.md#6-configuration-entities-the-process-depends-on)),
plus the O2C-specific ones:

| Entity | Role |
|---|---|
| **Customer groups** | AR posting profile + tax group resolution key |
| **AR posting profile** | Customer balance control account |
| **Price lists / trade agreements** | Date-effective, customer-specific, qty-break pricing |
| **Credit limit + payment terms** | Feeds *Manage credit and collections* |
| **Delivery terms / delivery mode** | Feeds I2D |
| **Financial dimensions** | **Store** is the axis that matters for a three-store retailer |

**[REC]** Of these, **financial dimensions with a `Store` axis** is the only one that is a genuine
gap *today* rather than a future one. The business has three physical stores and no way to produce a
P&L per store.

---

## 8. Bolivia: factura sequentiality

**[ASSUMPTION — needs validation, treated as binding until disproven]** Bolivian factura numbering
carries a legal sequentiality requirement: gapless, ordered, and non-reusable within an authorised
series.

**[REC]** Consequences for the numbering design, which must survive the generalisation in
[FOUNDATIONS.md](../architecture/FOUNDATIONS.md):

1. Factura numbers must be allocated **inside** the same database transaction that creates the
   factura, so a rollback does not burn a number — or, if the legal regime forbids gaps absolutely,
   allocation must be the last operation before commit.
2. Cancellation must be a **status change on an existing number**, never a delete.
3. The generic document-numbering framework must be able to express "this series has legal
   sequentiality" as a property, so that the factura series keeps its guarantee while `SO-`/`PO-`
   series can use cheaper allocation.

Skarpine's existing `FacturaCounter` already isolates this correctly. The generalisation must not
absorb it into a generic counter that loses the guarantee.
