# Source to Pay — Reference Process Model

**Phase 1 deliverable.** Reference model only — this document describes D365, not Skarpine.
Gap analysis against Skarpine is in [GAP_ANALYSIS.md](GAP_ANALYSIS.md).

Catalog ID **75**. Every claim is labelled:
**[OFFICIAL]** = Microsoft Learn, cited · **[REC]** = architectural recommendation ·
**[ASSUMPTION]** = needs validation · **[UNVERIFIED]** = could not confirm on Learn.

---

## 1. Where the process actually starts and ends

**[OFFICIAL]** Source to Pay covers *"the entire process of purchasing goods or services from a
supplier and paying for them… all the steps from the initial procurement request to the final
payment to the supplier."*
([source-to-pay-introduction](https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-introduction))

It starts at **identification of need** — not at the purchase order. It ends at **payment
settlement and record keeping** — not at goods receipt.

### Boundaries — what is officially NOT in S2P

This matters more than what is in it, because it determines where our schema seams belong.

| Concern | Officially belongs to |
|---|---|
| Physical receiving, put-away, material movement, inventory costing | **Inventory to Deliver (60)** |
| GL recording of vendor invoices and payments | **Record to Report (90)** |
| Item master existence | **Design to Retire (40)** — *mandatory prerequisite* |
| Demand that triggers the purchase | **Forecast to Plan (50)** / **Order to Cash (65)** |

**[OFFICIAL]** I2D is not a sibling process, it is nested: *"When the inventory to deliver process
is completed as a sub process in the Source to pay process, the Source to pay process continues.
For example, the invoicing and payment for the purchases."*
([inventory-to-deliver-overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/inventory-to-deliver-overview))

**[OFFICIAL]** *"An item must exist before you can begin to receive, handle inventory, or ship the
product"* — listed as **mandatory prerequisite** (same page).

---

## 2. Business process areas (Level 2)

**[OFFICIAL]** ([source-to-pay-areas](https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-areas))

| # | Area | Status |
|---|---|---|
| 1 | Develop procurement and sourcing strategies | Current (absorbed *Define procurement catalogs*) |
| 2 | Manage supplier relationships | Current |
| 3 | Source and contract goods and services | Added 2024 — RFI/RFQ/RFP, bid evaluation, contract registration |
| 4 | Procure goods and services | Current — the operational core |
| 5 | Manage accounts payable | Current (was *Process vendor invoices*) |
| 6 | Analyze procurement and sourcing | Added 2024 |
| — | ~~Issue and settle vendor payments~~ | **Deprecated** → merged into *Manage accounts payable* |
| — | ~~Process supplier rebates and incentives~~ | **Deprecated** → merged into *Manage accounts payable* |

**[OFFICIAL]** *Procure goods and services* subprocesses:
Raise purchase requisitions · Issue blanket purchase orders · Issue purchase order ·
Manage open purchases · Return goods to suppliers · Consolidate requisitions ·
Analyze supply purchase plan
([source-to-pay-procure-materials-services-overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-procure-materials-services-overview))

---

## 3. Document chain and state model

**[OFFICIAL]** The four procurement documents and their purpose (same source):

| Document | Purpose | Nature |
|---|---|---|
| **Purchase requisition (PR)** | Internal authorisation — *"identifies internal needs"* | Internal only, no vendor commitment |
| **Request for quotation (RFQ)** | *"gather competitive bids and select the most suitable supplier"* | External, non-binding |
| **Purchase agreement** | *"commits the organization to buying a specified quantity or amount over time, through multiple purchase orders"* | Binding commitment, spans many POs |
| **Purchase order (PO)** | *"finalizes the agreement… authorizes the supplier to fulfill the order"* | Binding, per-delivery |

**[REC]** State model to adopt. D365's exact enum values are product-version-specific and were not
verified page-by-page, so these are modelled on the documented lifecycle rather than copied:

```
PR      DRAFT → SUBMITTED → APPROVED → CLOSED (converted to RFQ or PO)
                         ↘ REJECTED
RFQ     DRAFT → SENT → BIDS_RECEIVED → AWARDED → CLOSED
                                     ↘ CANCELLED
PO      DRAFT → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED
                          → PARTIALLY_INVOICED  → INVOICED → CLOSED
                          ↘ CANCELLED
VendorInvoice  DRAFT → MATCHED → APPROVED → POSTED → SETTLED
                     ↘ MATCH_EXCEPTION
```

**[REC]** Receipt state and invoice state are **independent axes**, not one linear status. A PO can
be fully received and not invoiced, or invoiced and not received (prepayment). Modelling them as a
single `status` string is the single most common structural mistake in SME ERP, and it is the one
Skarpine currently makes.

---

## 4. Posting: what hits the GL, what moves inventory, what is only a status change

**[OFFICIAL]** *"Two main activities post to the general ledger for a purchase order: 1. Product
receipt 2. Invoice"*
([purchase-order-posting](https://learn.microsoft.com/dynamics365/finance/general-ledger/purchase-order-posting))

| Event | Inventory | GL | Notes |
|---|---|---|---|
| PR approved | — | — | Status only. (Optionally pre-encumbrance — see §4.1) |
| RFQ awarded | — | — | Status only |
| PO confirmed | On-order qty ↑ | — | Status only. (Optionally encumbrance) |
| **Product receipt** | **Physical qty ↑** | **Physical posting** | Goods on hand, not yet invoiced |
| **Vendor invoice** | **Financial qty ↑** | **Financial posting** | Cost fixed, liability recognised |
| Payment | — | AP settlement | Subledger settlement |

### Physical posting — product receipt

**[OFFICIAL]** Posting types required (same source):
- `Cost of purchased materials received`
- `Purchase expenditure, uninvoiced`
- `Purchase, accrual`

Gated by: *Post product receipt in ledger* parameter + item model group flags *Post physical
inventory* and *Accrue liability on product receipt*.

**[OFFICIAL]** Why this accrual matters: *"Because there's typically a delay between posting of the
product receipt for a purchase order and posting of the invoice, most organizations must recognize
the liability on the balance sheet to comply with local regulations such as… (GAAP)."*
([inventory-costing-faq](https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq))

This is the **GRNI** (goods received not invoiced) accrual. It is a clearing pair: posted at
receipt, reversed at invoice.

### Financial posting — vendor invoice

**[OFFICIAL]** Posting types required:
- `Cost of purchased materials invoiced`
- `Purchase expenditure for product`
- `Purchase expenditure for expense`
- `Discount` (optional)

Gated by item model group flag *Post financial inventory*.

### 4.1 Encumbrance

**[OFFICIAL]** *"You can also optionally configure purchase requisitions to post pre-encumbrances,
and purchase order confirmations to post encumbrances automatically into the general ledger."*
([record-to-report-overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/record-to-report-overview))

**[REC]** Out of scope for an SME product. Public-sector / budget-controlled pattern. No schema hook
required — encumbrance is a journal entry with a distinct source type, and the journal model already
supports arbitrary source types.

---

## 5. Three-way matching

**[OFFICIAL]** *"Once the invoice is matched with the purchase order and the product receipt, it can
be posted for payment. The system supports both two-way and three-way matching, ensuring that only
the goods or services ordered and received are paid for."*
([supply-chain-procure-to-pay-overview](https://learn.microsoft.com/dynamics365/guidance/techtalks/supply-chain-procure-to-pay-overview))

The three documents matched:

| # | Document | Supplies |
|---|---|---|
| 1 | Purchase order line | Ordered qty, agreed price |
| 2 | Product receipt line | Received qty |
| 3 | Vendor invoice line | Invoiced qty, invoiced price |

**Two-way** = PO ↔ invoice (price + qty). **Three-way** = adds receipt (proof of delivery).

**[REC]** Three-way matching is structurally impossible without a **vendor invoice entity distinct
from the PO** and a **product receipt entity distinct from the PO line**. This is the hard schema
requirement of S2P, and it does not become easier by deferring — the receipt records must exist from
day one or there is nothing to match against retroactively.

**[OFFICIAL]** Also in *Manage accounts payable*: invoice register (quick entry to accrue the
expense), prepayment invoices, debit memos, chargebacks, dispute handling.

---

## 6. Configuration entities the process depends on

**[OFFICIAL]** unless marked. These are the data-driven configuration layers — the things that must
be *tables*, not `if` statements.

| Entity | Role | Source |
|---|---|---|
| **Inventory posting profile** | Resolves GL account from item + account + tax dimension | [inventory-posting-profiles](https://learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting-profiles) |
| **Item groups** | Posting-profile resolution key on the item side | same |
| **Vendor groups** | Posting-profile resolution key on the party side | same |
| **Item model group** | Costing method + which postings are enabled | [inventory-costing-faq](https://learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq) |
| **Financial dimensions** | Analytic axes on every postable line | [financial-dimensions](https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-dimensions) |
| **Sales tax group** (vendor) + **item sales tax group** | Tax code resolution by intersection | [indirect-taxes-overview](https://learn.microsoft.com/dynamics365/finance/general-ledger/indirect-taxes-overview) |
| **Number sequences** | Document identity per type | [UNVERIFIED] — not fetched; behaviour assumed from product knowledge |
| **Units of measure** | Purchase UoM vs inventory UoM conversion | [UNVERIFIED] |
| **Trade agreements / purchase price lists** | Date-effective, vendor-specific, qty-break pricing | [OFFICIAL] mentioned in *Develop procurement and sourcing strategies* |
| **Delivery terms / payment terms** | Incoterms, due-date calculation | [UNVERIFIED] |

### 6.1 Posting profile resolution — the exact algorithm

**[OFFICIAL]** ([inventory-posting-profiles](https://learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting-profiles))

A posting profile row is a **matrix lookup**, not a single mapping:

| Field | Allowed values |
|---|---|
| Transaction type tab | Purchase order / Sales order / Inventory / … |
| Posting type | e.g. *Purchase expenditure for expense* |
| **Item code** | `Table` (one item) · `Group` (item group) · `All` · `Category` |
| **Item relation** | The specific item / group, blank for `All` |
| **Account code** | `Table` (one vendor) · `Group` (vendor group) · `All` |
| **Account relation** | The specific vendor / group, blank for `All` |
| Sales tax group | Optional extra qualifier |
| → **Main account** | The resolved GL account |

**[REC]** Resolution precedence must be **most-specific-wins**: `Table` beats `Group` beats `All`,
evaluated on the item axis and the account axis independently. This is the single most reusable
piece of design in this document — the same resolver serves S2P, O2C, inventory adjustments and
future production postings.

---

## 7. Bolivia-specific notes

**[OFFICIAL]** The July 2026 catalog release added LATAM content to *Record to Report* (90):
LATAM posting and dimension allocation, LATAM withholding taxes / tax groups / withholding base
calculation, LATAM tax ID types and taxpayer types, and a new Level 3 process *Define fiscal
document policies* (`90.10.300.000`).
([about-whats-new-2026-july](https://learn.microsoft.com/dynamics365/guidance/business-processes/about-whats-new-2026-july))

**[ASSUMPTION — needs validation with the co-founder / a Bolivian accountant]**
IVA *crédito fiscal* is recoverable against the supplier's **factura**, not against the physical
receipt of goods. If correct, recognising crédito fiscal at product receipt (which is what Skarpine
does today) records a recoverable tax asset before the legal right to claim it exists. This is a
tax-timing question, not an architecture question, and it must be answered before the P2P posting
design is frozen. The correct D365 shape — receipt posts an accrual, invoice posts the recoverable
tax — happens to resolve it cleanly.

---

## 8. Minimum viable S2P for an SME — [REC]

Not everything above belongs in the product. What must exist **as data structure** on day one:

| Must exist as an entity | Why it cannot be deferred |
|---|---|
| Product receipt (separate from PO) | Nothing to three-way match against later; receipts cannot be reconstructed |
| Vendor invoice (separate from PO) | AP subledger, partial invoicing, and invoice-date tax recognition all depend on it |
| Payment / settlement | Partial payment and one-payment-many-invoices are impossible without it |
| Posting profile | Retrofitting means restating every historical posting |
| Financial dimensions on every postable line | Cannot be backfilled — the dimension value at time of posting is unknowable later |

What can be **behaviour-deferred** with a cheap hook: PR, RFQ, purchase agreement, encumbrance,
vendor rebates, vendor collaboration portal. See [SCOPE_AND_HOOKS.md](SCOPE_AND_HOOKS.md).
