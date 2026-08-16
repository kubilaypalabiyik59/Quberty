# Process Chain — the documents before the order

**Built 2026-08-16.** Migrations `005_process_chain.sql` and `006_opportunity_originating_lead.sql`,
both applied to the test database.

Until now the earliest document in this system was the order itself. That meant the system could
record *what* was sold or bought, but never *why*, to whom it was offered first, at what price, or
which of several vendors won the business. Two end-to-end processes now start in front of it:

```
Prospect to Quote (85)   Lead ──▶ Opportunity ──▶ Quotation ──▶ Sales Order ──▶ (unchanged)
Source to Pay (75)       Requisition ──▶ RFQ ──▶ Purchase Order ──▶ (unchanged)
```

Everything downstream of the order — reservation, wave, shipment, factura, receipt, payment — is
untouched. This adds ways *in* to the order; it does not add a second order lifecycle.

---

## 1. What is official, and what is ours

| Claim | Status |
|---|---|
| Lead → Opportunity → Quotation is *Prospect to Quote* (catalog **85**), a separate process upstream of Order to Cash | [official](https://learn.microsoft.com/dynamics365/guidance/business-processes/prospect-to-quote-introduction) |
| Lead has exactly three states: Open, Qualified, Disqualified | [official](https://learn.microsoft.com/dynamics365/sales/developer/lead-entity) |
| A lead is kept separate from customer data until qualified | [official](https://learn.microsoft.com/dynamics365/sales/developer/lead-entity) |
| Qualifying associates an account/contact and creates the opportunity | [official](https://learn.microsoft.com/dynamics365/sales/qualify-lead-convert-opportunity-sales) |
| A lead with an opportunity attached cannot be disqualified | [official](https://learn.microsoft.com/dynamics365/sales/qualify-lead-convert-opportunity-sales) |
| An opportunity is associated with exactly one account or contact, and tracks probability + estimated close | [official](https://learn.microsoft.com/dynamics365/sales/developer/create-opportunity) |
| Quotation lifecycle Created → Sent → Revised / Lost / Cancelled / Confirmed; confirming creates the order, links the two, and makes the quotation read-only | [official](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/data-entities/add-efficiency-in-quote-to-cash-concept) |
| A quotation may be raised for a **prospect**, converted to a customer at confirmation | [official](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/data-entities/prospects-in-prospect-to-cash-use) |
| A requisition is an internal authorisation; approved lines generate a purchase order | [official](https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-requisitions-overview) |
| Requisition header status is **derived from its line statuses** | [official](https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-requisitions-overview) |
| Requisition purpose Consumption vs Replenishment decides what an approved line produces | [official](https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-requisitions-overview) |
| Workflow may be configured to skip review and auto-approve | [official](https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-requisitions-workflow) |
| RFQ splits into a *case* (demand) and one *RFQ per vendor* (bid) | [official](https://learn.microsoft.com/dynamics365/supply-chain/procurement/request-quotations) |
| RFQ status ranking Created < Sent < Received < Rejected < Accepted < Declined < Canceled, aggregated as lowest/highest | [official](https://learn.microsoft.com/dynamics365/supply-chain/procurement/request-quotations) |
| Bid lines may be accepted individually and **across different vendors**; accepting generates a purchase order | [official](https://learn.microsoft.com/dynamics365/supply-chain/procurement/request-quotations) |
| Accepting a requisition-type bid writes unit price and vendor back onto the requisition line | [official](https://learn.microsoft.com/dynamics365/supply-chain/procurement/request-quotations) |
| Semantic `status` + configurable `stage_id` split | **architectural recommendation** (mine) |
| Computing RFQ lowest/highest on read instead of storing them | **architectural recommendation** (mine) |
| Auto-converting a lead at confirmation instead of a separate step | **architectural recommendation** (mine), switchable |
| No workflow engine for requisition approval | **architectural recommendation** (mine) |

---

## 2. The three rules that make this extensible

This is the part that matters for the productisation goal — a future customer will arrive with a
different process, and none of it may require a fork.

### Rule 1 — every step is optional

Each link is nullable and every document can be created standalone. A counter sale still goes
straight to a sales order with `source_document_type = DIRECT`, byte-identical to before. Which
steps a tenant actually uses is **declared in parameters**, not branched in service code:

| Parameter | Default | What it turns on |
|---|---|---|
| `SalesParameters.require_opportunity_for_quotation` | `false` | forces every quote to belong to a deal |
| `SalesParameters.auto_convert_lead_on_confirm` | `true` | off ⇒ "Convert to customer" becomes a deliberate step |
| `SalesParameters.quotation_validity_days` | `30` | default offer window |
| `PurchaseParameters.require_requisition_for_po` | `false` | forbids raising a PO out of nowhere |
| `PurchaseParameters.requisition_approval_enabled` | `true` | off ⇒ submitting approves immediately |
| `PurchaseParameters.requisition_approval_threshold` | `null` | value below which approval is skipped |
| `PurchaseParameters.rfq_response_days` | `7` | default bid deadline |

### Rule 2 — semantic status, configurable stage

`status` is a closed vocabulary the **code** reasons about (`OPEN`/`WON`/`LOST`). `stage_id` points
at a `SalesPipelineStage` row the **tenant** names and orders. This is the same split that
`Account.category` versus `Account.code` already makes, for the same reason.

Pipeline vocabulary is the single most customer-specific thing in CRM. A customer who wants "Demo
booked" between two stages edits data; a customer whose pipeline has nine stages does not fork the
code. Five stages ship as defaults and are ordinary rows — rename, reorder, delete.

### Rule 3 — provenance at header *and* line

```
SalesOrder.source_document_type   / source_document_id    DIRECT | QUOTATION | OPPORTUNITY | …
PurchaseOrder.source_document_type / source_document_id   DIRECT | REQUISITION | RFQ | …
SalesOrderLine.source_line_id
PurchaseOrderLine.source_line_id
```

The header alone is not enough on the purchase side: an RFQ award may accept lines from several
vendors, and a purchase order carries exactly one supplier. One RFQ case therefore fans out into
several orders, and only the **line** records which bid line it was awarded from.

`source_document_type` is a polymorphic string rather than a set of FKs because the set of upstream
documents is genuinely open — `PURCHASE_AGREEMENT` and `PLANNED_ORDER` are documented deferrals and
become new enum values, not migrations. Where the relation is *fixed* (opportunity → lead,
quotation → opportunity, RFQ case → requisition) there is a real FK instead, because referential
integrity is worth more than symmetry.

> **Note on `SalesOrder.source`** — that column records the *channel* (manual / storefront / pos /
> import). `source_document_type` records the *document*. An order can be `storefront` +
> `QUOTATION` at once. Two independent facts; collapsing them would lose one.

---

## 3. Nothing here touches the ledger

Leads, opportunities, quotations, requisitions and RFQs are **pre-financial**: no journal entry, no
posting profile, no factura. The first financial event is still the order and its invoice.

This is asserted, not assumed — `scripts/verifyProcessChain.ts` records the journal-entry and
factura counts before running both chains end to end and checks they have not moved.

---

## 4. Deviations from D365, and why

| D365 | Here | Reason |
|---|---|---|
| Stores RFQ *lowest*/*highest* status | Computed on read | A denormalised aggregate of two child tables can drift out of agreement with the rows it summarises. At SME row counts the computation is free. |
| "Convert to customer" is a separate action before confirming | Automatic at confirmation, switchable off | The extra click buys an SME nothing. Tenants wanting master-data control set `auto_convert_lead_on_confirm = false`. |
| RFQ case from a requisition requires status *In review* | Accepts *In review* **or** *Approved* | With one approver, sourcing a price before approving the spend is the normal order of events. Forbidding it would force the approver to sign off on a number nobody checked. |
| Multi-step configurable approval workflow | On/off + value threshold | At ≤50 employees the approver is one person. A routing engine would be the heaviest thing in the codebase for the least use. It attaches to `submitted_at`/`approved_by` later without touching these rows. |
| Requisition purpose *Replenishment* generates transfer/production orders | Rejected with an explanatory error | The enum value exists as the hook; the behaviour does not. Accepting the document and quietly producing a purchase order anyway would be worse. |
| Bid scoring by criteria set | Single 0–100 score | A criteria table attaches to this column's successor with no back-reference to populate. |

---

## 5. Two defects the verification script found

Both were found by running the chain against the real database, not by reading the schema.

**1. Qualification destroyed the lead's origin.** Migration 005 modelled an opportunity's party as
"customer OR lead, exactly one" — correct for the party, wrong as the only link. Qualifying moves
the party to the new customer, so `lead_id` *must* become null to satisfy the CHECK, and the origin
of the deal vanished at exactly the moment it became interesting. "Which lead sources actually
convert" is the one question lead tracking exists to answer, and 005 made it unanswerable.
Migration **006** adds `Opportunity.originating_lead_id`. D365 makes the same separation
(`originatingleadid`).

**2. The comparison matrix rewrote its own history.** `compareReplies` marked the cheapest bid per
line over `status = RECEIVED` only. Awarding flips the losers to `REJECTED` — so after the award the
"cheapest" marker silently jumped onto the winner, erasing the record of why a *dearer* vendor was
chosen. It now considers every submitted bid. There is a regression check for exactly this.

A third gap was found through the UI: a requisition sourced through a tender appeared to have
produced nothing, because the awarded order points at the **RFQ case**, not the requisition. The
detail route now follows both routes.

---

## 6. What is NOT built

- **Purchase agreements / blanket orders.** Hooks only: `PURCHASE_AGREEMENT` enum value and
  `PurchaseOrderLine.agreement_line_id`.
- **Replenishment requisitions** (transfer orders). Enum value only.
- **Vendor collaboration portal.** Bids are entered by the buyer on the vendor's behalf, which is
  what D365 calls "Purchaser is updating" and is the realistic mode at this market size.
- **RFQ questionnaires, solicitation types, sealed bidding, vendor Q&A.** Public-sector procurement
  features.
- **Quotation PDF / email.** `sent_at` is recorded; actually sending it is not built.
- **Inventory "quotation receipt" transactions** that D365 raises for PO-type RFQ case lines — a
  soft expected-supply signal, no GL effect. Not built.

---

## 7. Known issue this work surfaced but did not fix

**The purchase tax arithmetic is incoherent.** `POST /purchase/orders` decomposes IVA *out of* the
subtotal (the Bolivian IVA13 code is price-inclusive) and then adds the result *on top*:

```
Bs 2 500 → tax 2500 − 2500/1.13 = 287,61 → total 2 787,61     an effective 11,5%
```

Either the subtotal is gross (nothing should be added) or it is net (the tax is 325,00). It cannot
be both. This is the "purchase net-vs-inclusive" question already on the co-founder list.

**It is deliberately not fixed here** — correcting it moves every purchase total in the system, which
is Kubi's and the co-founder's decision. What the new RFQ and requisition paths do is reproduce the
existing behaviour *exactly*, with a test asserting they agree with the existing purchase path, so
that whichever way the question is answered, one fix covers all three.

---

## 8. Verification

```
backend/scripts/verifyProcessChain.ts        both chains end to end, 66 assertions, self-cleaning
backend/src/__tests__/documentChain.test.ts  19 unit tests on the two aggregation rules
backend/scripts/verifyMigration005.ts        tables, CHECK constraints, untouched pre-existing rows
```

`npx tsx scripts/verifyProcessChain.ts` creates a lead, qualifies it, quotes it, revises the
quotation, confirms it into a sales order, then raises a requisition, part-approves it, tenders it to
two vendors, records two bids, awards the dearer one on lead time, and checks the requisition closes
with the winning price written back. It deletes everything it made and asserts the counts return to
the baseline it started from. `--keep` leaves the documents in place for inspection.

Screenshots: [docs/design/screenshots/](../design/screenshots/) — `chain-*.png`.
