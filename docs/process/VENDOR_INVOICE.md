# Vendor invoice and three-way matching — reference model, gap, and design

> **Status: analysis and design only. No implementation is approved.**
> Research source: Microsoft Learn MCP. Every claim below is labelled
> **[OFFICIAL]** (with URL), **[REPO]** (with file:line), **[REC]** (my recommendation), or
> **[ASSUMPTION]** (needs validation). Nothing is stated from memory.

This closes checklist item **5.12** — *separate physical from financial posting on the purchase
side* ([ERP_SETUP_CHECKLIST.md §5](../architecture/ERP_SETUP_CHECKLIST.md)) — which is the largest
remaining unlock in Source to Pay. It also determines whether input IVA is recognised legally.

---

## 1. The official cycle

**[OFFICIAL]** *"A vendor invoice completes the cycle from purchase order to product receipt to
vendor invoice."*
([Vendor invoices overview](https://learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-invoices-overview))

Three documents, three distinct events:

| Document | What it asserts | Ledger effect |
|---|---|---|
| Purchase order | We agreed to buy | None (encumbrance only, if configured) |
| Product receipt | The goods physically arrived | **Physical** update |
| Vendor invoice | The supplier has billed us | **Financial** update |

**[OFFICIAL]** Registration and receipt are themselves distinct: goods are first marked
*Registered* (arrival journal / handheld), possibly pass quality inspection, and only then marked
*Received* by posting a product receipt. *"During product receipt, specify a product receipt
identifier, which is typically a reference to the packing slip from the supplier. This identifier is
required for accounting, because it enables checks or audits of supplier packing slips against what
is received."*
([Product receipt against purchase orders](https://learn.microsoft.com/dynamics365/supply-chain/procurement/product-receipt-against-purchase-orders))

**[OFFICIAL]** A purchase order may carry many product receipts and many invoices. *"When you post
the invoice, the Invoice remainder quantity for each item is updated… If both the Invoice remainder
quantity and the Deliver remainder quantity for all items on the purchase order are 0, the status of
the purchase order changes to Invoiced."* Partial invoicing is the normal case, not an edge case.

**[OFFICIAL]** An invoice line may exist that was never on the purchase order: *"You can add a line
that wasn't on the purchase order… The line is included only in matching policies for invoice
totals."* So the invoice is **not** a projection of the order — it is its own document with its own
lines.

---

## 2. The official posting anatomy — physical vs financial

This is the part that matters most, and it is precisely what the current code collapses.

**[OFFICIAL]** ([Purchase order posting](https://learn.microsoft.com/dynamics365/finance/general-ledger/purchase-order-posting))

**For the physical transaction (product receipt) to reach the ledger:**
- *Inventory and warehouse management parameters* → **Post product receipt in ledger**
- *Item model groups* → **Post physical inventory** and **Accrue liability on product receipt**
- Posting types required: **Cost of purchased materials received**, **Purchase expenditure,
  uninvoiced**, **Purchase, accrual**

**For the financial transaction (invoice) to reach the ledger:**
- *Item model groups* → **Post financial inventory**
- Posting types required: **Cost of purchased materials invoiced**, **Purchase expenditure for
  product**, **Purchase expenditure for expense**, **Discount** (optional)

The behaviour of those accounts, quoted from the official posting table:

| Posting type | P/F | Clearing | Official description (abridged) |
|---|---|---|---|
| Cost of purchased materials received | P | Yes | *"Used when a purchase order product receipt is posted, the offset is Purchase expenditure, uninvoiced. The amount in this account is **reversed when a purchase order invoice is posted**."* |
| Purchase expenditure, uninvoiced | P | Yes | *"The offset on the first voucher is Purchase accrual… amounts posted in this account are **reversed when a purchase order invoice is posted**."* |
| Purchase, accrual | P | Yes | *"Used when a purchase order product receipt is posted and the option to accrue purchase amounts is enabled."* |
| Cost of purchased materials invoiced | F | No | *"Used when a purchase order invoice is posted… **This account represents the inventory on your balance sheet**."* |
| Purchase expenditure for product | F | Yes | *"The offset to this account is the Purchase expenditure, uninvoiced account which is used on the receipt posting and reversed during the invoice posting."* |
| Purchase expenditure for expense | Both | No | *"Used when posting a product receipt or invoice for a purchase order where **the items aren't stocked**, or a procurement category is used."* |
| Stock variation | Both | No | *"Used when there's a difference in the unit price between product receipt and invoice"*, or charges/indirect costs are added |
| **Accrued sales tax on receipt** | Both | Yes | *"Used when you select the **Post physical tax** option… The amount is posted when you update the purchase order physically (product receipt), and **reversed when you post the purchase order financially (invoice)**."* |

**The structural point:** every receipt-side account is a **clearing account**. The receipt records
an estimate against a liability; the invoice reverses the estimate and records the real amount. The
permanent inventory asset (*Cost of purchased materials invoiced*) is only established at
**invoice**, not at receipt.

**The tax point:** D365 has a dedicated posting type so that tax accrued at receipt is *reversed*
at invoice. Recoverable input tax is a financial-update concept. That is the official confirmation
of what §9 below argues for Bolivia.

---

## 3. The official matching machinery

**[OFFICIAL]** ([Accounts payable invoice matching overview](https://learn.microsoft.com/dynamics365/finance/accounts-payable/accounts-payable-invoice-matching))
Four independent matching types, not one setting:

1. **Invoice totals matching** — six totals compared (balance, total discount, charges, sales tax,
   round-off, invoice amount) against *expected* totals, where *"the expected invoice totals are
   calculated based on the prices, charges, and sales tax information from the purchase order and
   **the quantities from the invoice**."*
2. **Two-way matching** — price only, in one of two flavours:
   - *Net unit price matching*: `Net amount of the line / Quantity of the line`
   - *Price totals matching*: `(Unit price × Line quantity) + Line charges − Line discounts`,
     compared against **all pending and previously posted invoice lines** for that order line — a
     not-to-exceed control for split invoicing.
3. **Three-way matching** — everything two-way does, **plus** *"the quantity on the invoice is
   matched to product receipt quantities that have been received. If the invoice quantity differs
   from the matched product receipt quantity, a quantity matching error exists."*
4. **Charges matching** — actual vs expected charge amounts per charges code, and *"performed only
   on charges codes for which the Compare purchase order and invoice values toggle is selected."*

**The policy hierarchy** — **[OFFICIAL]**
([Set up AP invoice matching validation](https://learn.microsoft.com/dynamics365/finance/accounts-payable/tasks/set-up-accounts-payable-invoice-matching-validation)):

```
Item and vendor  →  Item  →  Vendor  →  Legal entity
```

and the legal-entity default is overridable per purchase order line only if **Allow matching policy
override** permits it.

**The tolerance hierarchy** is a *nine-way two-axis search*, item axis × vendor axis:

```
Table/Table · Table/Group · Table/All · Group/Table · Group/Group · Group/All ·
All/Table   · All/Group   · All/All
```

*"The default legal entity price tolerance is 0 percent… You can't delete the record for the default
legal entity price tolerance."* Tolerances are also settable for invoice totals per vendor, and for
charges per charges code.

**Discrepancy handling** — **[OFFICIAL]** *Post invoice with discrepancies* takes **Allow with
warning** or **Require approval**; with *Require approval*, the **Approve posting with matching
discrepancies** toggle must be set on the invoice before it can post. Note the official warning:
*"To use workflows together with invoice matching validation, make sure that the Post invoice with
discrepancies field is set to Allow with warning to avoid having to approve multiple times."*

**Where the invoice quantity comes from** — **[OFFICIAL]** the default is the product receipt
quantity, but five options exist: *Receive now*, *Ordered*, *Registered*, *Product receipt
quantity*, *Registered quantity and services*.

**Worth stealing verbatim** — the failure mode the official example is built around: an invoice line
that is *not matched to any product receipt* fails quantity matching. Three-way matching is not
"compare two numbers"; it is *"has this invoice line been tied to specific receipt lines, and do the
tied quantities add up?"* That requires a **match record**, not a computed comparison — one invoice
line can be satisfied by several receipts, and the same receipt can serve several invoices.

---

## 4. What the repo does today — [REPO]

| Fact | Evidence |
|---|---|
| There is **no vendor invoice document**. AP is credited at receipt. | [purchase.routes.ts:425-444](../../backend/src/modules/purchase/purchase.routes.ts#L425-L444) |
| There is **no product receipt document**. Receipt is a status plus a timestamp on the order header. | [purchase.routes.ts:328-330](../../backend/src/modules/purchase/purchase.routes.ts#L328-L330) |
| The receipt posts **physical and financial in one voucher**: inventory, recoverable input tax and AP together. | [purchase.routes.ts:339-444](../../backend/src/modules/purchase/purchase.routes.ts#L339-L444) |
| Recoverable input tax (`VAT_INPUT`) is therefore recognised **at goods receipt, with no vendor factura in the system**. | [purchase.routes.ts:439](../../backend/src/modules/purchase/purchase.routes.ts#L439) |
| No accrual account exists. `PURCHASE_ACCRUAL` is not a posting type. | [accountCategory.ts:73-88](../../backend/src/shared/services/accountCategory.ts#L73-L88) |
| Not-stocked purchases expense to `COGS` "because that is the closest configured account". | [purchase.routes.ts:395-402](../../backend/src/modules/purchase/purchase.routes.ts#L395-L402) |
| `ArrivalJournal` exists and is registration-only — it never posts to the ledger. | [schema.prisma:512-544](../../backend/prisma/schema.prisma#L512-L544) |
| Partial receipt is half-expressible: `received_qty` accumulates on the line, but nothing records *which* receipt delivered what. | [schema.prisma:628-637](../../backend/prisma/schema.prisma#L628-L637) |
| **The hooks were already put in place.** `line_matching_policy` (NONE/TWO_WAY/THREE_WAY), `price_tolerance_pct`, and `vat_input_recognition` (RECEIPT/INVOICE) exist and are unread. | [schema.prisma:1314-1358](../../backend/prisma/schema.prisma#L1314-L1358) |
| Item model group already carries `post_physical_inventory`, `post_financial_inventory`, `accrue_liability_on_receipt` — declared, honoured on the sales side, **not honourable on the purchase side** because there is only one posting event to switch. | [schema.prisma:1677-1691](../../backend/prisma/schema.prisma#L1677-L1691) |

Plus the defect surfaced while restating purchase orders, which this work must fix rather than
inherit: `inventory_batches.unit_cost` is written from the **gross** line unit cost
([purchase.routes.ts:308-320](../../backend/src/modules/purchase/purchase.routes.ts#L308-L320))
while the receipt journal capitalises the **net**
([purchase.routes.ts:350-352](../../backend/src/modules/purchase/purchase.routes.ts#L350-L352)).
The inventory subledger and the GL disagree by the IVA on every receipt.

---

## 5. The contradiction worth flagging — posting profiles are single-axis

**[REPO]** `PostingProfile.scope_kind` is one axis with flat precedence
`ITEM → ITEM_GROUP → PARTY → PARTY_GROUP → ALL`
([postingProfile.service.ts:42](../../backend/src/shared/services/postingProfile.service.ts#L42),
[schema.prisma:1156-1190](../../backend/prisma/schema.prisma#L1156-L1190)).

**[OFFICIAL]** D365's inventory posting profile is **two-axis**: *Item code* (Table | Group | All |
Category) **and** *Account code* (Table | Group | All), resolved as an intersection
([Inventory posting profiles](https://learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting-profiles)).
The price-tolerance search order quoted in §3 is the same two-axis shape spelled out explicitly, and
the matching-policy hierarchy has an **Item and vendor** level that a single axis cannot express at
all.

So our profile table can say *"inventory account for item group SHOES"* or *"…for vendor group
IMPORTERS"*, but never *"…for SHOES bought from IMPORTERS"* — and it silently resolves to the item
rule, because ITEM_GROUP outranks PARTY_GROUP in a list where D365 would have consulted a matrix.

**[REC]** Do not widen `PostingProfile` now — for a three-store retailer the intersection is not yet
needed, and the two-axis matrix is exactly the D365 reporting pain CLAUDE.md §3 warns against
importing wholesale. **But do not repeat the single-axis shape in the new matching-policy and
tolerance tables**, because there the intersection is officially the *first* level of the hierarchy
and is the common case (*"selected items ordered from certain vendors"* is the official example).
Design those two tables two-axis from the start; leave `PostingProfile` alone and record the
asymmetry here so it is a decision, not an accident.

---

## 6. Design — [REC]

### 6.1 Documents

Three new entities. The names follow the official ones so the vocabulary stays teachable.

- **ProductReceipt** / **ProductReceiptLine** — one per physical arrival, carrying the supplier's
  packing-slip identifier (**[OFFICIAL]** required for accounting). Many per purchase order.
  Correction rule to adopt verbatim: **[OFFICIAL]** *"When correcting a product receipt, you can only
  reduce the received quantity. To raise the quantity, you must post a new product receipt journal."*
- **VendorInvoice** / **VendorInvoiceLine** — the supplier's factura as its own document, with its
  own number (the supplier's, not ours), date, and lines. Lines may reference a purchase order line
  or stand alone.
- **VendorInvoiceMatch** — the join that three-way matching actually needs: *(invoice line, receipt
  line, matched quantity)*. Without it, many-receipts-to-one-invoice-line is unrepresentable and the
  match cannot be re-audited after posting.

### 6.2 Posting shape — reduced, but structurally identical

D365 uses four clearing accounts and raises two vouchers per event to carry standard-cost variance.
**[REC]** We use **one clearing account pair and one voucher per event.** We run FIFO, not standard
cost ([schema.prisma:1654](../../backend/prisma/schema.prisma#L1654)), so the second voucher exists
to carry a variance we do not have. This is a behaviour cut, not a schema cut: the posting types are
named the same, so adding standard cost later adds accounts, not a redesign.

**Receipt (physical), when `post_physical_inventory` and `accrue_liability_on_receipt`:**

```
DR  INVENTORY              net cost of goods received
    CR  PURCHASE_ACCRUAL   net cost of goods received      ← liability, clearing
```

**Invoice (financial), when `post_financial_inventory`:**

```
DR  PURCHASE_ACCRUAL       receipt-valued amount            ← reverses the accrual
DR  VAT_INPUT              recoverable tax per the factura  ← first time tax is recognised
DR/CR PRICE_VARIANCE       invoice price − receipt price, if any
    CR  AP                 what the supplier is owed
```

Two properties to preserve: the accrual account nets to zero once an order is fully received *and*
invoiced (so its balance is a real KPI — *goods received not invoiced*), and inventory is valued at
receipt while the payable is created at invoice, which is what makes month-end cut-off correct.

**Not stocked** lines take `PURCHASE_EXPENSE` in both events instead of `INVENTORY` — this finally
retires the "COGS is the closest configured account" approximation and closes checklist item 5.11.

New posting types: `PURCHASE_ACCRUAL` (→ new category `ACCRUED_PURCHASES`, a liability),
`PURCHASE_EXPENSE` (→ `OPERATING_EXPENSE`), `PRICE_VARIANCE` (→ `OPERATING_EXPENSE`).
`POSTING_TYPES_REQUIRED_TO_TRADE` gains `PURCHASE_ACCRUAL` only when receipt posting is enabled —
adding it unconditionally would block onboarding for every existing tenant
([accountCategory.ts:95-97](../../backend/src/shared/services/accountCategory.ts#L95-L97)).

### 6.3 Matching

Implement **invoice totals matching** and **three-way matching** (which subsumes two-way). Two-way
remains a policy value, so a services vendor with no goods receipt is configuration, not code.

Resolution order, officially derived and two-axis:

```
matching policy:  (item, vendor) → (item, ALL) → (ALL, vendor) → parameters default
price tolerance:  same nine-cell search, item axis × vendor axis, default row 0% and undeletable
```

Statuses per invoice line: `price_match`, `price_total_match`, `receipt_qty_match`, each
`PASSED | FAILED | NOT_APPLICABLE`, plus a header roll-up. Store them — do not compute on read.
**[OFFICIAL]** the match status is a stored, refreshable value in D365 (*Last match* status,
*Automatically update invoice header match status*), precisely because recomputing it against
history is not reliable.

Discrepancy gate: reuse `post_invoice_with_discrepancies = ALLOW_WITH_WARNING | REQUIRE_APPROVAL`
on `PurchaseParameters`. At ≤50 employees the approver is the owner, so this is a flag on the
invoice, not a workflow engine — the same argument already accepted for requisition approval
([schema.prisma:1340-1345](../../backend/prisma/schema.prisma#L1340-L1345)).

---

## 7. What we deliberately do NOT build

| Deferred | Why | Hook required |
|---|---|---|
| Charges (freight, duty) and charges matching | No charges module exists; landed cost is a separate, larger decision already argued in [SCOPE_AND_HOOKS.md §4](SCOPE_AND_HOOKS.md) | **Yes** — `VendorInvoiceLine.charges_amount` nullable, and the `PRICE_VARIANCE`/stock-variation posting type. Officially these two share an account, so the hook is one column |
| Invoice register / invoice pool / approval journal | Three ways to enter a non-PO invoice, aimed at AP departments with a data-entry clerk | **None.** A non-PO invoice is a VendorInvoice with no order reference — the header already permits it |
| Vendor invoice workflow, batch posting, invoice capture, vendor collaboration portal | Enterprise ceremony; one approver | None |
| Prepayment invoices, fixed-asset acquisition from PO, consignment, procurement categories | Out of the retailer's process entirely | None. Prepayment and fixed asset are additive posting types |
| Price totals matching across split invoices (not-to-exceed) | Meaningful when one order line is invoiced repeatedly — rare at this size | **Yes, and it is nearly free**: `VendorInvoiceLine.po_line_id` plus the match table already let the accumulated invoiced amount per order line be summed. Ship the column, defer the check |
| Standard cost / fixed receipt price variance vouchers | FIFO only today | Already hooked: `ItemModelGroup.fixed_receipt_price` ([schema.prisma:1663](../../backend/prisma/schema.prisma#L1663)) |
| Quality / quarantine orders between registration and receipt | No inspection process at a shoe retailer | None. `ArrivalJournal` already sits between arrival and receipt |

---

## 8. Schema changes required

New tables: `product_receipts`, `product_receipt_lines`, `vendor_invoices`, `vendor_invoice_lines`,
`vendor_invoice_matches`, `matching_policies`, `price_tolerances`.

Changed: `PurchaseParameters` gains `post_product_receipt_in_ledger`, `match_invoice_totals`,
`invoice_totals_tolerance_pct`, `post_invoice_with_discrepancies`, `allow_matching_policy_override`,
`default_invoice_quantity` — all with defaults that reproduce today's behaviour.
`PurchaseOrderLine` gains `invoiced_qty` alongside `received_qty`, and `matching_policy` (nullable
override, per the official per-line override).

Every uniqueness constraint carries `tenant_id` (CLAUDE.md §7). The supplier's invoice number is
unique **per tenant per supplier**, never globally — two suppliers issuing "0001" is normal, and
**[OFFICIAL]** duplicate-number handling is itself a parameter (*Check the invoice number used →
Reject duplicate*), so the constraint must be soft enough to configure.

**Migration safety:** every existing purchase order is `RECEIVED` with a posted single voucher. The
migration must **not** synthesise product receipts or invoices for them — that would be inventing
documents that never existed. Existing orders keep their history; the new documents apply to orders
raised after the switch. `PurchaseParameters.post_product_receipt_in_ledger` defaults to the
one-voucher behaviour so nothing changes until a tenant is migrated deliberately.

---

## 9. Bolivia

**[REPO/ASSUMPTION, carried from [P2P_REFERENCE.md §7](P2P_REFERENCE.md)]** IVA *crédito fiscal* is
recoverable against the supplier's **factura**, not against the physical receipt of goods. Skarpine
recognises it at receipt today, which would record a recoverable tax asset before the legal right to
claim it exists.

This design resolves it structurally: input tax moves to the financial update, where the factura
number, factura date and supplier NIT are actually present. `vat_input_recognition` already exists as
the switch ([schema.prisma:1328](../../backend/prisma/schema.prisma#L1328)); this work is what makes
`INVOICE` a reachable value.

**[OFFICIAL]** confirms the shape is not a Bolivian special case — the *Accrued sales tax on receipt*
posting type exists precisely so that receipt-time tax is a reversible accrual and the invoice
carries the real thing.

**Still unvalidated, and it must be answered by the Finance co-founder against Ley 843 / the RND, not
by me and not by inference from D365:** whether crédito fiscal at receipt is merely early or actually
non-compliant, and whether the vendor factura's *fecha de emisión* or our receipt date governs the
period in which it is claimed. That answer changes the posting **date**, not the design.

Vendor invoice numbering is the supplier's, so the legal sequentiality requirement on our own factura
numbering (CLAUDE.md §6) does not extend here — but the vendor's NIT, factura number, and
authorisation code must be storable on the header for the IVA purchase ledger.

---

## 10. Open questions

1. **Which comes first in the UI** — is the receipt posted by a store worker and the invoice by the
   owner later, or does the owner do both at once when the goods and the factura arrive together? If
   the second is the common case, we need a *receive and invoice* single action that raises both
   documents, or the process will feel like enterprise ceremony to the anchor customer.
2. Do suppliers deliver against one order more than once? If never, partial receipt is scaffolding —
   the documents are still right, but the UI should not lead with it.
3. Is the purchase unit cost entered gross or net (carried open from
   [BOLIVIA_TAX_BASIS.md §6](BOLIVIA_TAX_BASIS.md))? Three-way price matching compares the invoice
   unit price to the order unit price; if the two documents are entered on different bases, every
   line fails matching for a reason that is not a discrepancy.
4. The thirteen posted purchase orders still carrying the old tax arithmetic
   ([SMOKE_TEST.md](../SMOKE_TEST.md)) — restate by adjusting journal, or leave? Unrelated to this
   design, but it is the same ledger this work will write into.

---

## 11. Sequencing — [REC]

1. `PURCHASE_ACCRUAL` / `PURCHASE_EXPENSE` / `PRICE_VARIANCE` posting types and the new account
   category, plus provisioning. Small, independent, and closes checklist 5.11 on its own.
2. Fix `inventory_batches.unit_cost` to the capitalised net. Independent of everything else, and it
   is wrong today.
3. `ProductReceipt` document + split the receipt posting into physical-only.
4. `VendorInvoice` document + financial posting + the accrual reversal.
5. `VendorInvoiceMatch` + three-way matching + tolerances.
6. Invoice totals matching.

Steps 3 and 4 must ship together or the accrual account will hold a balance nothing clears.
