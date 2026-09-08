# Source to Pay / Order to Cash — where we are, and what is left

> The tracking list. Updated 2026-08-16, after the vendor invoice / three-way matching build.
>
> Legend: ✅ built and verified by running it · 🟡 partly there, with a named limitation ·
> ❌ not built · ⛔ deliberately out of scope (with the reason)
>
> "Verified by running it" means a script or a browser session actually drove it against the real
> database, not that the code reads correctly.
>
> This narrative status predates the July 2026 catalog adoption. Future revisions must map each
> claim to the selected catalog IDs and controlled scope/implementation statuses defined in
> [CORE_ERP_PROCESS_CATALOG.md](CORE_ERP_PROCESS_CATALOG.md). Do not reinterpret the existing symbols
> as catalog-level coverage until that mapping is completed.

---

## 1. The short answer

**Source to Pay is now complete end to end, except payment.** Requisition → RFQ → purchase order →
product receipt → vendor invoice → three-way match → posting all exist, all post to the ledger, and
the goods-received-not-invoiced accrual clears to zero. What remains is the last step: a payment
document that settles against invoices.

**Order to Cash is the weaker half now.** The front (lead → opportunity → quotation → order) was
built, and the money engine underneath both processes is shared and sound. But the customer invoice
is still a header-only `Factura` with no lines, and settlement is still a `paid_at` timestamp. The
vendor-invoice work has an exact mirror waiting on the sales side.

The single most valuable next piece of work is **not** more S2P. It is the O2C invoice document,
because it is the same defect shape we just removed from the purchase side, on the revenue side,
where the legal exposure is.

---

## 2. Source to Pay

| # | Step | State | Note |
|---|---|---|---|
| 1 | Purchase requisition + approval | ✅ | Threshold and approval-enabled are parameters, not a workflow engine |
| 2 | RFQ, bid comparison, award | ✅ | Award fans one case out to several POs; the cheapest marker survives the award |
| 3 | Purchase agreement / blanket order | ⛔ | Deferred. Hooks exist: `source_document_type` + `agreement_line_id` |
| 4 | Purchase order | 🟡 | Lines now carry `received_qty` **and** `invoiced_qty`, and the header reaches `PARTIALLY_RECEIVED` / `RECEIVED` / `INVOICED`. Still one status string rather than two independent axes |
| 5 | **Product receipt** | ✅ | Own document, own number, supplier packing slip required. Many per order |
| 6 | **Physical posting** | ✅ | DR inventory / DR purchase expenditure, CR purchase accrual. No tax, no payable |
| 7 | **Vendor invoice** | ✅ | The supplier's number, date, NIT and factura authorisation |
| 8 | **Three-way matching** | ✅ | Match rows tie invoice lines to specific receipt lines; policy and tolerance resolved on two axes |
| 9 | **Financial posting** | ✅ | Accrual reversed, recoverable tax recognised against the factura, payable created, price variance posted |
| 10 | **Vendor payment / settlement** | ❌ | **The biggest remaining S2P gap.** Still `PurchaseOrder.paid_at`. Now also *inconsistent*: payment is keyed to the ORDER while the liability is created by the INVOICE |
| 11 | Return to vendor | ❌ | No return order, no disposition |
| 12 | GL account resolution | ✅ | Posting profiles, most-specific-first, no account literals in the purchase path |
| 13 | Purchase pricing / trade agreements | ❌ | `unit_cost` typed by hand |
| 14 | Landed cost / charges | ❌ | Hook only (`VendorInvoiceLine.charges_amount`, `PRICE_VARIANCE`). Real for an importer |
| 15 | Purchase tax | 🟡 | Engine-driven and jurisdiction-portable — but see the IT finding in §5 |

**Verified by running it:** `scripts/verifyPurchaseCycle.ts` (32 assertions) and two full browser
sessions — separate receipt-then-invoice, and the combined receive-and-invoice. Ledger checked line
by line with `scripts/showPurchaseVouchers.ts`.

---

## 3. Order to Cash

| # | Step | State | Note |
|---|---|---|---|
| 1 | Lead → opportunity | ✅ | Pipeline stages configured, not hardcoded |
| 2 | Quotation → order | ✅ | Revision, expiry, conversion; provenance recorded on the order |
| 3 | Sales order | 🟡 | Status string; **no line-level `delivered_qty` / `invoiced_qty`** — the accumulators the purchase side now has |
| 4 | Fulfilment (wave / work / directives) | ✅ | Genuinely good and deliberately D365-shaped. Do not simplify it |
| 5 | Shipment lines | ❌ | `Shipment` has no lines — a partial shipment cannot say what was on it |
| 6 | **Packing slip document** | ❌ | The mirror of the product receipt. `post_deferred_revenue_on_delivery` is declared and unreachable without it |
| 7 | Physical posting on delivery | ❌ | COGS only at invoice. The clearing pair does not exist on the sales side |
| 8 | **Customer invoice with lines** | ❌ | **The biggest remaining O2C gap.** `Factura` is header-only; `iva_amount` / `it_amount` are columns on it. No `FacturaLine`, so partial invoicing and line-level tax are both impossible |
| 9 | Financial posting | ✅ | Posting profiles; revenue split by item group |
| 10 | Sales tax | 🟡 | Engine-driven and correct per Ley 843, but the amounts still land in named columns rather than tax transaction lines |
| 11 | AR settlement | ❌ | `SalesOrder.paid_at`. Partial payment and one-payment-many-invoices are impossible |
| 12 | Credit limit / collections / dunning | ❌ | Hooks are cheap and additive (`credit_limit`, `payment_terms_days`) |
| 13 | Returns / credit note | ❌ | `returned_at` timestamp. A credit note is a fiscal document in Bolivia |
| 14 | Sales pricing / price lists | ❌ | `Product.selling_price`, one column |

---

## 4. Cross-cutting foundations

| Foundation | State | Note |
|---|---|---|
| Chart of accounts + account categories | ✅ | Country-independent; onboarding a country is a template, not code |
| Posting profiles | 🟡 | Works, resolves most-specific-first. **Single-axis** — cannot express "this item from that vendor". Deliberate; argued in [VENDOR_INVOICE.md §5](VENDOR_INVOICE.md) |
| Tax engine (codes, groups, base_kind) | ✅ | Bolivia + Turkey + Germany + an invented jurisdiction all correct from rows alone |
| Document numbering | ✅ | 9 sequences, allocation is atomic |
| Item model group / item group | ✅ | Both wired into posting; the purchase side now honours the physical/financial switches too |
| **Customer / vendor groups** | ❌ | `PARTY_GROUP` scope is defined and unreachable. Small, and it completes the party axis |
| **Financial dimensions (Store)** | ❌ | Three stores, no per-store P&L, and **the attribution of a past transaction is unrecoverable** |
| **Product dimension groups + variant FKs** | ❌ | `variant_id` has no relation on four line tables. **[OFFICIAL]** a product cannot be converted between variant models later |
| Currency + exchange rates | ❌ | No tables. The functional-currency amount must be stored at transaction time or history cannot be restated |
| UoM conversions | ❌ | Buy in boxes, sell in pairs |
| Per-line tax | ❌ | Hooks on 5 line tables. **Required before Turkey or Germany** |
| Tenant-scoped uniqueness | 🟡 | The new tables do it correctly. Older ones still carry global `@unique` on `po_number`, `order_number`, `entry_number`, `journal_number`, `shipment_number` — a cross-tenant collision waiting to happen |
| Live defects D-1 … D-7 | ✅ code / ❌ books | Every defective code path is fixed and `require_balanced_posting` is on. **The correction journals were never posted** — D-2 Bs 3 250, D-6 Bs 6 897, D-3 Bs 189,23, plus closing `2105` into `2103` |

---

## 5. Open findings that need a decision, not code

1. **IT is being applied to purchases.** The tax engine picks the tenant's tax group for the party
   side, but does not filter by tax *type*, so `IT3` is evaluated on vendor invoices and reported as
   `non_recoverable_tax` (Bs 75 on a Bs 2 500 purchase). **It never reaches the ledger** — the
   voucher is inventory + recoverable tax + payable, and it balances — but the figure shown on the
   invoice screen is wrong. Ley 843 art. 74 taxes *ingresos brutos*, which is a sales concept, and
   CLAUDE.md §6 says so explicitly. The fix is a side filter on the tax code (`applies_to`:
   SALES | PURCHASE | BOTH), which is one nullable column plus one `where` clause. **Not applied —
   it is a tax decision.**
2. **Historical tax understatement.** Bs 637,47 across 27 issued facturas, quantified but not
   corrected. Finance co-founder's call.
3. **Thirteen posted purchase orders** still carry the pre-fix arithmetic (Bs 27,68 understated input
   tax, −Bs 1 350,32 on AP). Correcting them needs adjusting journals.
4. **Ley 1733** moves Bolivia to IVA *por fuera* once its decree is published. The system switches on
   a date-effective row when that happens — nothing to build, something to watch.
5. **Where production runs, if anywhere.** Still unrecorded in this repo. Every figure quoted above
   is from the test database.

---

## 6. What I would do next, in order — [REC]

1. **Customer invoice with lines** (`FacturaLine` + line-level tax + `invoiced_qty` on the order
   line). It is the exact mirror of the work just finished, on the revenue side, and it unblocks
   partial invoicing, credit notes and per-line tax at once.
2. **Payment / settlement**, once — built against *documents*, so one implementation serves both AP
   and AR. Doing it after step 1 means it settles invoices on both sides rather than orders.
3. **Customer / vendor groups.** Small, completes the party axis, and makes the posting matrix whole.
4. **Financial dimensions (Store).** Every day of trading makes this more expensive, and past
   attribution is not recoverable.
5. **Per-line tax**, before any non-Bolivian customer.

Steps 1 and 2 together turn both processes into real document chains. Steps 3–5 are foundation debt
whose cost rises with time rather than with scope.
