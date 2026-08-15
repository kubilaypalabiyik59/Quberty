# Configuration Architecture — Module Parameters, Posting Profiles, Number Sequences

**Status:** design proposal. No implementation. Answers the question *"can we manage configuration
with a per-module parameters page, the way D365 F&O does?"*

**Short answer: yes, and it is the right pattern — but only if we copy the D365 *separation* along
with the page. D365 does not put everything on the parameters page, and the three things it keeps
apart are exactly the three things Skarpine currently conflates.**

---

## 1. What D365 actually means by "parameters"

*Official documentation.* The Accounts payable setup guide defines the parameters page precisely:

> On the **Accounts payable parameters** page, set up default settings that are applied if a more
> specific setting isn't specified, parameters for various kinds of functionality, and the various
> number sequences for Accounts payable.

— [Configure Accounts payable overview](https://learn.microsoft.com/dynamics365/finance/accounts-payable/accounts-payable-overview)

Three roles, and only three:

1. **Defaults** — a fallback used when nothing more specific is configured.
2. **Functional switches** — policy choices that change behaviour (e.g. `Line matching policy`,
   `Enable invoice matching validation`).
3. **Number sequence bindings** — *which* sequence each document reference uses.

Note what is **not** on that page. The same setup list puts **Vendor posting profiles** at step 4, a
separate page, before parameters at step 5:

> On the **Vendor posting profiles** page, define how vendor transactions are posted to the general
> ledger.

*Official documentation, same URL.*

**Cardinality is the reason.** Parameters are a **singleton per legal entity** — one row, many
columns. Posting profiles are a **resolution matrix** — many rows, searched most-specific-first.
Learn documents that search order explicitly for price tolerances:

> Table/Table → Table/Group → Table/All → Group/Table → Group/Group → Group/All → All/Table →
> All/Group → All/All

— [Set up Accounts payable invoice matching validation](https://learn.microsoft.com/dynamics365/finance/accounts-payable/tasks/set-up-accounts-payable-invoice-matching-validation)

A singleton cannot express that. This is not a UI preference; it is a different data shape.

---

## 2. The four configuration classes — keep them apart

*Architectural recommendation.*

| Class | Shape | Cardinality | Example in Skarpine |
|---|---|---|---|
| **Parameters** | wide singleton row per scope | 1 | IVA inclusive yes/no, allow negative inventory, default payment terms |
| **Posting profiles** | resolution matrix | many | which GL account for AR, revenue, IVA débito, COGS |
| **Number sequences** | framework + per-reference binding | many | factura series, journal voucher series |
| **Reference / master data** | ordinary tables | many | tax codes, payment terms, customer groups, sites |

**The single most important line in this document:** every one of D-1 … D-7 in
[GAP_ANALYSIS.md §0](../process/GAP_ANALYSIS.md) is a **posting profile** defect, not a parameters
defect. Account codes `'2103'`, `'2105'`, `'1201'` are literals in service code. Putting them on a
parameters page would move the literal from code into a column — better, but still a singleton, and
still unable to express "this item group posts to a different revenue account".

**If we build parameters pages and treat that as the configuration story, we will have made the UI
nicer and left the actual defect class intact.**

---

## 3. Where Skarpine's configuration lives today — *repo-verified*

It is in four incompatible places:

| Location | What | Problem |
|---|---|---|
| [schema.prisma:23-28](../../backend/prisma/schema.prisma#L23-L28) | `Tenant.modules`, `Tenant.branding`, `Tenant.tax_config` — untyped `Json` | No validation, no history, no per-module ownership, not queryable |
| [config/tax.ts:20](../../backend/src/config/tax.ts#L20) | `BOLIVIA_DEFAULTS` hardcoded | Deploy required to change a tax rate |
| [coa-templates/bolivia-pcg.json:5](../../backend/src/data/coa-templates/bolivia-pcg.json#L5) | a *second* `tax_config` | Two sources of truth for the same rates |
| 6 route files | GL account code literals | Root cause of D-1 … D-7 |

`resolveTax()` already does `{ ...BOLIVIA_DEFAULTS, ...(cfg ?? {}) }` — the defaulting *concept* is
there. It just has no table behind it.

---

## 4. Scope — the one genuine schema hook

*Architectural recommendation, and the highest-stakes decision here.*

D365 parameters are **per legal entity**: *"Use the following pages to set up the basic functionality
of Accounts payable for each legal entity"* (official, URL above).

Skarpine has **no legal entity concept**. The hierarchy is `Tenant → Site → Warehouse`
([schema.prisma:18,77,96](../../backend/prisma/schema.prisma#L18)). Today `tenant_id` is the de facto
scope, and for the anchor customer — one Bolivian company, three stores — that is correct.

**But a Bolivian SME with two SRLs under one owner is a completely ordinary situation**, and each SRL
has its own NIT and its own factura authorisation. The moment that customer arrives, configuration
must be scoped per company, not per tenant.

**Hook:** every parameters and posting-profile table carries a **nullable `legal_entity_id`** from
day one, with uniqueness on `(tenant_id, legal_entity_id, …)` treating `NULL` as "tenant default".
No `LegalEntity` table is needed yet — only the column and the constraint shape.

**Cost of not doing it:** retrofitting a scope column onto config tables that already hold live rows
means backfill plus a uniqueness change on configuration that posting logic reads — i.e. a migration
that can silently repoint GL accounts. That is precisely the class of migration
[CLAUDE.md §3](../../CLAUDE.md) says must never become necessary.

---

## 5. Number sequences — and what this tells us about the factura question

*Official documentation.* D365 splits this in two, and the split is the design:

- The **framework** lives in Organization administration. A sequence has a **scope** — `Shared`,
  `Company`, `Legal entity`, `Operating unit`, optionally combined with `Fiscal calendar period` —
  and a **format** built from segments.
- The **module parameters page only binds** a reference to a sequence: *"If you need module-specific
  settings, use the parameters page in a module to specify number sequences for the references in
  that module."*

— [Number sequences overview](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/organization-administration/number-sequence-overview)

**Continuous vs non-continuous is a first-class property**, and Learn is explicit about both the
legal need and the cost:

> Continuous number sequences don't allow gaps between numbers. […] For many businesses, especially
> in industries that have regulatory oversight, continuous number sequences are mandatory. […]
> Because of the way that the mechanism for continuous numbering works, every transaction that needs
> a new number demands interaction with the database. The frequent interactions with the database
> lead to frequent locking, increased resource usage, and system slowdowns.

— [TechTalk: Performance improvements for continuous number sequences](https://learn.microsoft.com/dynamics365/guidance/techtalks/finance-operations-continuous-number-sequence-performance-improvements)

France's FEC rules are the closest documented analogue to the Bolivian factura question — the
requirement there is that numbering *"must increase over time, and it shouldn't include any break"*,
implemented by setting `Continuous = Yes`
([FEC prerequisites](https://learn.microsoft.com/dynamics365/finance/localizations/france/emea-fra-fec-audit-file-pre-requisites)).

**This resolves the shape of the open factura question in
[HANDOVER.md §7](../../HANDOVER.md), though not the legal answer.** We do not need to decide whether
Bolivian law is gapless *before* designing: we need a `continuous` flag per sequence. If gapless,
the factura sequence is continuous (accepting the locking cost — trivial at SME volume); if gaps with
justification are allowed, it is non-continuous and we add a voiding/justification record. **The
legal question still needs the Finance co-founder** — but it no longer blocks the schema.

*Repo-verified consequence:* D-5 exists precisely because there is no such framework — two ad-hoc
series (`JE-2026-00077` and `JE-000007`) share one globally-unique column.

---

## 6. Recommended shape

*Architectural recommendation.*

**Parameters — one table per module, not one generic key-value table.**

```
sales_parameters      (tenant_id, legal_entity_id NULL, … typed columns …)
purchase_parameters   (tenant_id, legal_entity_id NULL, … typed columns …)
inventory_parameters  (tenant_id, legal_entity_id NULL, … typed columns …)
finance_parameters    (tenant_id, legal_entity_id NULL, … typed columns …)
```

Typed columns, not JSON. Reasons: validation at the database, migrations that are reviewable,
and — decisive here — **`Tenant.tax_config` as an untyped blob is how two rival tax configurations
came to exist without anyone noticing.**

Rejecting the obvious alternative: a generic `settings(key, value)` EAV table is tempting and is the
wrong call, for the reason [CLAUDE.md §3](../../CLAUDE.md) already states about dimensions — maximum
generality costs query performance and developer ergonomics, and our selling point is that reporting
is easy. Four typed tables are less clever and better.

**Posting profiles — separate, and this is the one that actually fixes the defects.**

```
posting_profiles(
  tenant_id, legal_entity_id NULL,
  posting_type,          -- AR, REVENUE, VAT_OUTPUT, VAT_INPUT, COGS, INVENTORY, AP, TAX_TURNOVER…
  scope_kind,            -- ALL | GROUP | ITEM  (the Table/Group/All axis)
  scope_id NULL,
  account_id,
  valid_from, valid_to
)
```

Resolution: most specific first, exactly the D365 search order. `ALL` is the mandatory fallback —
D365 does the same for price tolerances (*"You can't delete the record for the default legal entity
price tolerance"*).

**Number sequences — framework plus binding, per §5**, with `continuous` and `scope` as columns from
the start.

---

## 7. Effect on the agreed plan

The remediation order proposed in chat was: D-7 hotfix → correction journals → pull posting profiles
forward in the foundation sequence. **This analysis strengthens the third item and adds nothing to
the first two.**

Revised recommendation for [FOUNDATIONS.md §6](FOUNDATIONS.md):

| # | Step | Why here |
|---|---|---|
| 1 | D-7 report hotfix | Legal exposure, one file, reversible |
| 2 | Correction journals for D-2 / D-6 / D-3 | Needs Finance co-founder sign-off on the entries |
| 3 | **Posting profiles** | Structurally eliminates D-1, D-2, D-6 and the whole defect class |
| 4 | Number sequences framework | Eliminates D-5; unblocks the factura legality question |
| 5 | Module parameters tables | Retires `Tenant.tax_config` and `config/tax.ts` |
| 6 | Product dimensions → financial dimensions → tax engine | As already designed |

Steps 3 and 4 were *later* in the original sequence. They should move ahead of product dimensions:
they are what stops the ledger being wrong, and product dimensions do not depend on them.

**Open item — not decided here:** whether `legal_entity_id` should be a real `LegalEntity` table now
or a bare nullable column. *Recommendation: bare column now, table when the second company appears.*
The column is the part that is expensive to add later; the table is not.

---

## 8. Tax engine — correcting §6

**§6 above proposed `vat_rate` and `turnover_tax_rate` as columns on `SalesParameters`. That was
wrong, and it was caught before anything was wired to it.** The tables were empty; migration 002
replaced those columns at no cost. Recording the mistake because the reasoning matters more than the
outcome.

### Why a rate column fails

It is Bolivia's shape parameterised, not a tax engine. It breaks in every target market:

| Market | What breaks a single rate column |
|---|---|
| **Bolivia** | IVA 13% price-**inclusive**, plus IT 3% — a **turnover** tax that is **not recoverable** and exists on the sales side only. Two different tax *kinds*, not two rates. |
| **Turkey** | KDV at **20% / 10% / 1% concurrently**, chosen by product. Plus **tevkifat**: partial withholding where the *buyer* remits a share of the VAT, above a statutory invoice threshold (currently TRY 9 900), and only for designated withholding agents. One rate column cannot say *"20%, of which the buyer remits half"*. |
| **Germany** | USt **19% / 7%** by product, plus **reverse charge (§13b)** where the customer accounts for the tax entirely, plus **intra-community supply** — exempt, but still reportable and requiring a legal reference on the invoice and a validated counterparty VAT ID. |

Sources: [VAT withholding in Turkey (tevkifat)](https://workon.com.tr/en/vat-withholding-in-turkey-tevkifat-guide/) ·
[VAT in Turkey — rates & compliance](https://workon.com.tr/en/vat-in-turkey-rates-exemptions-compliance/) ·
[Germany reverse charge §13b](https://germanpedia.com/reverse-charge-procedure-germany/) ·
[Intra-community supply from Germany](https://norman.finance/de/en/blog/intra-community-supply-gmbh-germany).
*Community/vendor sources, not primary legislation — treat the specific thresholds as
**needing validation** before shipping to either market. The structural conclusion does not depend
on the exact numbers.*

### The model adopted — D365's, verbatim

*Official documentation.*

> "Both groups contain a list of sales tax codes, and the intersection of the two lists of sales tax
> codes determines the list of applicable sales tax codes for the transaction."
> — [Sales tax overview](https://learn.microsoft.com/dynamics365/finance/general-ledger/indirect-taxes-overview)

- **`TaxCode`** — one tax: rate, inclusive/exclusive, recoverable or not, `tax_type`
  (VAT / TURNOVER / WITHHOLDING / EXCISE / EXEMPT), `region_type` (DOMESTIC / EU / THIRD),
  `reverse_charge`, `exempt_reason`, and `withholding_share` + `withholding_threshold` for tevkifat.
- **`TaxGroup`** — hangs off the **party** (customer / supplier).
- **`ItemTaxGroup`** — hangs off the **product**.
- Applicable tax = **intersection**. No intersection → no tax, which is D365's behaviour too, not an
  error.

Three deliberate choices worth naming:

1. **`tax_type = TURNOVER` is what makes Bolivia's IT representable.** It is charged on the net,
   is not recoverable, and must never appear in a VAT netting report. A tax model derived from VAT
   alone cannot express it — which is exactly the warning in [CLAUDE.md §6](../../CLAUDE.md).
2. **Tax codes never name a GL account.** They carry a `posting_type` that resolves through the
   posting profiles from §6. One account-resolution mechanism, not two.
3. **Reverse charge and tevkifat share one field pair.** Both are "someone other than the seller
   remits this"; reverse charge is simply the 100% case. Modelling them separately would have
   duplicated the invoice-presentation logic.

### Bolivia does not regress — and this is tested, not asserted

`src/__tests__/tax.service.test.ts` asserts that `calculateTax` configured with IVA13 + IT3 returns
**exactly** what the existing `config/tax.ts resolveTax()` returns, across the real amounts found in
the production database (1 299 · 3 000 · 115 · 7 127 · 25 000 · 0,01). 19 tests, all passing.

If that test ever fails, the generalisation is wrong — not the test.

### Scope hooks left open, deliberately

| Deferred | Hook that exists today | Cost of the hook |
|---|---|---|
| Tax settlement periods and returns (monthly TR return due the 26th, German Voranmeldung, Bolivian IVA) | `TaxCode.settlement_period_id` nullable | one column |
| Counterparty VAT-ID validation (required for EU exemption) | `Customer.tax_id` | one column |
| Multiple legal entities per tenant | `legal_entity_id` on every config table | already there |
| e-invoicing (e-Fatura, German structured e-invoice) | none — it is an integration, not a schema shape | nothing |

**Not built and not hooked:** per-jurisdiction tax *reporting* layouts. The current IVA report is
still Bolivia-specific. Generalising it is a reporting problem to solve when the second jurisdiction
is real, and it needs no schema change to start.
