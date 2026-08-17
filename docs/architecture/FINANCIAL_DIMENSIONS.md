# Financial Dimensions — reference model and proposed design

> Status: **DESIGN ONLY. Not implemented. Not approved.**
> Opened 2026-08-17 on Kubi's instruction: *"Bize financial dimension yapısı lazım — bırak mağazayı,
> kocaman bir mağazanın içerisindeki departmanlar bazında bile finansal takip isteyebilirler."*
>
> Requirement restated: the ledger must be codable on **more than one axis**, the axis list must be
> **tenant-configurable**, and adding an axis later must not be a data migration.
>
> Labelling per CLAUDE.md §5: **[OFFICIAL]** = Microsoft Learn with URL · **[REPO]** = verified in
> this codebase with file:line · **[REC]** = my architectural recommendation · **[ASSUMPTION]** =
> needs validation.

---

## 1. Why this exists

[CEO_DASHBOARD.md §8b](../design/CEO_DASHBOARD.md) closed with the one real gap found when the GL was
checked against Learn: **financial dimensions do not exist, and unlike every other deferral in this
product they shipped without a schema hook.** CLAUDE.md §3 permits cutting the capability; it does
not permit cutting the hook.

The cost is already concrete and already paid:

- Sales orders carry a derived `site_id` since migration 011, so *"value by site"* works on the
  document side.
- The dimension never reaches `JournalLine`, so **a P&L by store cannot be produced at all** — not
  slowly, not approximately. It is not a query away; the data is not there.
- For a three-store retailer that is roughly the first question an owner asks.

And the requirement has now grown past store level: department-within-store. That growth is exactly
why the answer is not "two more FK columns".

---

## 2. The official model

### 2.1 What a financial dimension is

[OFFICIAL] Two types exist
([Financial dimensions](https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-dimensions#financial-dimension-types)):

| Type | Values come from | Notes |
|---|---|---|
| **Custom** | maintained by hand on *Financial dimension values* | always shared across legal entities |
| **Entity-backed** | an existing system table chosen in *Use values from* (Customers, Stores, Projects…) | some shared, some company-specific |

Two details from that page matter to our design:

- Entity-backed values are **not available in the dimension framework until the value is used** in a
  transaction, posting profile or journal. A new customer is not automatically a dimension value.
- Renaming or deleting an entity-backed value is done **on the source entity**, never on the value
  list.

[OFFICIAL] Value rules
([Define financial dimensions](https://learn.microsoft.com/dynamics365/finance/general-ledger/tasks/define-financial-dimensions#naming-requirements)):
values are max **30 characters**; names must start with a letter or underscore and contain only
letters, digits and underscores; **no value may contain the chart-of-accounts delimiter**, because
the segmented-entry parser will read it as a segment break.

### 2.2 The rule Microsoft states hardest — what must *not* be a dimension

[OFFICIAL]
[Make backing tables consumable as financial dimensions](https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/financial/dimensionable-entities):

> "Don't create financial dimensions that have values that are not reusable or use one-to-one
> dimension value combinations."

with an explicit list of what is forbidden: **documents, sales orders, purchase orders,
transactions, checks, serials, tickets, license numbers.** [OFFICIAL]
[Differences between financial tags and financial dimensions](https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-tag-financial-dimension)
gives the reason: non-reusable values "cause your chart of accounts to explode, because of the
uniqueness of so many ledger accounts", and the damage lands at year-end close, revaluation and
consolidation.

**A financial dimension is a reusable classification axis with a small, stable value set.** Store,
department, cost centre, channel, project. Anything with one value per transaction is not a
dimension.

### 2.3 Financial tags — the other half of the answer

[OFFICIAL] [Financial tags](https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-tag):
up to **20 user-defined fields** stored on the accounting entry, for exactly the values dimensions
must not carry — order numbers, payment references, external invoice numbers.

The differences that matter ([OFFICIAL], comparison table):

| | Dimensions | Tags |
|---|---|---|
| Account structure | part of it | not part of it |
| Validation | validated against structures | **none, ever** |
| Defaulting from master data | yes | **no** — header→line only |
| Reporting | dimension sets, balances, trial balance | **no balances**; drill-down and export only |
| Editable after posting | **no** — it would change the financial statements | **yes**, tags are internal analysis |

That last row is the cleanest way to tell them apart: **if changing it after posting would change a
financial statement, it is a dimension. If it would not, it is a tag.**

### 2.4 Account structures and advanced rules

[OFFICIAL]
[Ledger account combinations](https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/financial/ledgeraccountcombinations#part-4-advanced-rules)
and
[Configure account structures](https://learn.microsoft.com/dynamics365/finance/general-ledger/configure-account-structures):
the account structure decides which dimensions appear as segments for which main accounts, and which
values and combinations are valid. **Advanced rules** add further segments only when a filter matches
(e.g. only for main account 145 and customers G–Q). A structure must always exist and must always
contain at least the main-account segment.

[OFFICIAL]
[Segmented entry control](https://learn.microsoft.com/dynamics365/finance/general-ledger/enter-account-dimension-combinations-segmented-entry-control):
input is never blocked while typing; **validation happens on leaving the field.**

This is the heaviest part of the framework and the part CLAUDE.md §3 explicitly warns about:
D365's dimension implementation is "notoriously painful to report against", and our selling point is
that reporting is easy. §5 below cuts it deliberately.

### 2.5 Defaulting — the part most likely to be got wrong

[OFFICIAL]
[Default financial dimensions on financial journals](https://learn.microsoft.com/dynamics365/finance/general-ledger/dimensions-default-values).
The order is strict:

1. **Journal name → journal header.**
2. **Journal header → line account.** Blanks then fill from customer / vendor / bank / fixed asset /
   project / ledger defaults. For a *Ledger* account a **fixed dimension is treated as a default at
   entry time**; for customer/vendor/bank the main account is not yet known, so no fixed dimension
   defaults.
3. **Line account → offset account**, then the same master-data fallback. An already-defaulted value
   is **not** overridden.
4. **At posting**, each line's main account is re-evaluated and any **fixed dimension replaces
   whatever is on the line** — including a value the user typed. The journal line keeps showing the
   typed value; only the accounting entry changes.

And the sentence worth pinning to the wall:

> "the journal default process can't determine whether a blank dimension value was intentionally left
> blank, or whether the default entry wasn't made."

Microsoft's own workaround is to create a dimension value literally named `Blank` or `0`. That is a
design smell we can avoid — see §6.4.

[OFFICIAL] [Derived dimensions](https://learn.microsoft.com/dynamics365/finance/general-ledger/derived-dimensions):
entering a *driving* dimension auto-fills others (cost centre 10 → department 20, location 30).
Derivation runs **after** defaulting, does **not** override existing values unless *Replace existing
dimension values* is on, and is only available for **shared, not company-specific** dimensions.

### 2.6 The performance warning

[OFFICIAL] (comparison table): "the more dimensions that are created and used in a dimension set,
the slower transaction entry, import, and processes become."

Dimensions are cheap to declare and expensive to use. The design below treats the axis count as a
budget, not a free parameter.

---

## 3. Where this codebase actually starts

[REPO] verified 2026-08-17.

| Fact | Evidence | Consequence |
|---|---|---|
| `JournalLine` has account, debit, credit, description — **and nothing else** | [schema.prisma:1391-1403](../../backend/prisma/schema.prisma#L1391-L1403) | no axis of any kind reaches the ledger |
| **16 `journalEntry.create` call sites across 8 files**, each hand-building its `lines: { create: [...] }` array | `hr.routes.ts` 1 · `sales.service.ts` 1 · `finance.routes.ts` 1 · `sales.routes.ts` 5 · `pos.routes.ts` 4 · `productReceipt.service.ts` 2 · `purchase.routes.ts` 1 · `vendorInvoice.service.ts` 1 | **this is the blocking finding — see §4** |
| Debits = credits is asserted **only** for the manual journal route | [finance.routes.ts:231-234](../../backend/src/modules/finance/finance.routes.ts#L231-L234), [schemas/index.ts:95-99](../../backend/src/shared/schemas/index.ts#L95-L99) | the 15 machine-generated writers post unvalidated |
| `journal_entries.entry_number` carries a bare `@unique` | [schema.prisma:1374](../../backend/prisma/schema.prisma#L1374) | cross-tenant collision, same class as `order_number` / `po_number` |
| `Employee.department` is a **free-text string** | [schema.prisma:1237](../../backend/prisma/schema.prisma#L1237) | there is no department master. The second axis Kubi wants does not exist as data yet |
| `Site` / `Warehouse` are real, and `Warehouse.site_id` is NOT NULL | [schema.prisma:77-128](../../backend/prisma/schema.prisma#L77-L128) | the store axis can be entity-backed on day one at zero cost |
| Documents already resolve site/warehouse through one service | `shared/services/inventoryDimension.service.ts` (migration 011) | **the defaulting spine already exists** — it stops at the document |

The last two rows are the good news: the store axis is not a greenfield problem. Migration 011 built
the precedence chain (explicit → register → parameter → sole warehouse → none) and enforced *never
invent a value*. What is missing is the last hop, document → journal line.

---

## 4. The blocking prerequisite: one journal writer

**There is no `postJournal()`.** Sixteen places build journal lines by hand.

Adding dimensions to that shape means editing sixteen literal arrays and hoping none is missed. A
missed one is **invisible**: the entry still posts, still balances, and is simply uncoded — it lands
in the "(unassigned)" bucket of every report and looks like a data-entry gap rather than a bug. That
is precisely the D-2 / D-4 failure mode this project has already paid for twice.

[REC] **Step zero is a single writer**, before any dimension work:

```ts
postJournal(tx, {
  tenantId, date, description,
  source: { module: 'SALES_INVOICE', id: order.id },
  dimensionContext: { siteId, warehouseId, customerId, productIds… },
  lines: [{ accountId, debit, credit, description, dimensions? }],
})
```

It earns its place three times over independently of dimensions:

1. **Balance assertion for all 16 writers**, not just the manual one.
2. Voucher-number allocation in one place instead of eight.
3. `entry_number` becomes tenant-scoped in one edit rather than sixteen.

Then dimension defaulting is applied in **exactly one function**, and a new axis is a configuration
row rather than a code change. Without this step the dimension work is not worth starting.

---

## 5. What we take and what we cut

Per CLAUDE.md §3 — behaviour cuts, never schema cuts.

| D365 concept | Decision | Hook |
|---|---|---|
| Financial dimension (custom) | **TAKE** | — |
| Financial dimension (entity-backed) | **TAKE** — Site backs the store axis immediately | — |
| Dimension values as their own table | **TAKE** — one value table for all axes | — |
| Dimensions on the accounting entry | **TAKE** — the whole point | — |
| Default dimensions on master data | **TAKE**, reduced to customer / supplier / product / employee | — |
| Required-vs-optional per account | **TAKE, reduced**: a requirement rule keyed on **account category**, not a per-main-account structure tree | rule table keyed `(attribute, account_category, account_id?)` — a real structure later is more rows |
| Account structure trees + advanced rules | **CUT.** Five configuration screens before a shoe shop can tag revenue with a store is the enterprise weight this product exists to avoid | the requirement rule above is the degenerate case of a structure; widening it is additive |
| Segmented entry control (`5101-STORE1-DEPT2`) | **CUT.** We have no delimiter, so §2.1's delimiter trap simply does not apply to us | none needed — a UI concern, not a data one |
| Derived dimensions | **DEFER** | additive table; `(driving_value_id, derived_attribute_id, derived_value_id)`. No hook needed today |
| Fixed dimensions on a main account | **DEFER** | one nullable `fixed_value_id` on the requirement rule row |
| Legal entity overrides / suspension | **DEFER** | `DimensionValue.is_active` + `legal_entity_id` nullable, consistent with every other table since migration 001 |
| Dimension sets (pre-aggregated balances) | **DEFER — and probably forever.** Three stores × four axes does not need materialised balance rows; a `GROUP BY` over an indexed column is faster than maintaining them | none needed |
| **Financial tags** | **CUT, and no hook needed** — and this is a deliberate claim, not an omission. `JournalEntry.source_module` + `source_id` [REPO: schema.prisma:1377-1378] already carries document traceability to the entry, which is the tag use case. If per-**line** tagging is ever wanted, it is a nullable JSON column | none |

---

## 6. Proposed design

### 6.1 Shape — fixed slots, not EAV

Three candidates were considered.

| | Query for P&L by store | Adding an axis | Verdict |
|---|---|---|---|
| **(a) Two hardcoded FKs** (`site_id`, `dimension_2_id`) — the earlier §8b recommendation | trivial | code change, and `dimension_2_id` points at *what* table? | **rejected** — it answers today's question and blocks Kubi's actual one |
| **(b) EAV join table** `journal_line_dimension_values` | join + pivot per axis, per report | free | **rejected** — this is the shape CLAUDE.md §3 names as the thing not to copy |
| **(c) N fixed slots + a registry** | `GROUP BY dimension_1_id`, one index | one nullable column, additive | **[REC] chosen** |

```prisma
model DimensionAttribute {
  id              String  @id @default(uuid()) @db.Uuid
  tenant_id       String  @db.Uuid
  legal_entity_id String? @db.Uuid          // forward hook, as since migration 001
  code            String                     // STORE, DEPT — the §2.1 name rules apply
  name            String
  slot            Int                        // 1..N — which journal_lines column holds it
  value_source    String                     // CUSTOM | SITE | WAREHOUSE | EMPLOYEE | PRODUCT_CATEGORY
  is_active       Boolean @default(true)

  @@unique([tenant_id, code])
  @@unique([tenant_id, slot])                // one axis per slot, NULLS NOT DISTINCT on legal_entity_id
}

model DimensionValue {
  id            String  @id @default(uuid()) @db.Uuid
  tenant_id     String  @db.Uuid
  attribute_id  String  @db.Uuid
  code          String                       // max 30 chars, per §2.1
  name          String
  source_id     String? @db.Uuid             // the backing row, for entity-backed axes
  is_active     Boolean @default(true)

  @@unique([tenant_id, attribute_id, code])
  @@index([tenant_id, attribute_id, source_id])
}

model JournalLine {
  // …existing…
  dimension_1_id String? @db.Uuid            // FK → DimensionValue
  dimension_2_id String? @db.Uuid
  dimension_3_id String? @db.Uuid
  dimension_4_id String? @db.Uuid
}
```

**One value table for every axis**, exactly as D365 keeps one `DimensionAttributeValue` regardless of
backing table. It is what lets `JournalLine` hold a real foreign key without knowing whether the axis
is a Site, an Employee or a hand-typed cost centre.

**Why four slots.** Store (1) is needed now; department (2) is the stated next; cost centre and
channel are the plausible third and fourth. Four is an allocation, not a ceiling — slot 5 is
`ALTER TABLE ADD COLUMN … NULL`, which in PostgreSQL 11+ rewrites nothing. The §2.6 performance
warning argues against pre-allocating twenty.

**[ASSUMPTION] needing validation:** that four axes covers the target market. A 50-employee business
with more than four *reusable* accounting axes is outside our segment. Worth checking against the
next two prospects rather than guessing wider.

### 6.2 Entity-backed values, and the trap in them

For `value_source = SITE`, `DimensionValue.source_id` points at `sites.id`. Per §2.1 the value list
is **not** a mirror of the site table — a value row is created when a site is first used for coding.
Renaming a store renames the site; the dimension value's `name` is refreshed from the source, never
edited independently.

The trap this avoids: if the value list were a copy, deleting a site would orphan posted ledger
lines. With a real FK the database refuses, which is the correct answer.

### 6.3 Defaulting — our order, mapped to D365's

We have no journal names and no offset-account concept, so §2.5's four-step order collapses to
three. Precedence, most specific first:

1. **Explicit** — the posting caller passed a value. Rare; used by corrections and adjustments.
2. **Document** — the source document's own dimensions. For the store axis this is *already solved*:
   `inventoryDimension.service.ts` resolves site from warehouse with an explicit precedence chain.
   **Reuse it. Do not write a second resolver** — two resolvers that disagree is how `site_id` came
   to be accepted from callers *and* derived, which migration 011 had to undo.
3. **Master data** — `DefaultDimensionAssignment (entity_type, entity_id, attribute_id, value_id)`
   over customer / supplier / product / employee. Polymorphic on purpose: the alternative is four
   near-identical tables.
4. **Nothing → NULL.**

Derivation (§2.5) would run after step 3. Deferred.

### 6.4 The rule that is not negotiable: never invent a value

Microsoft's own guidance concedes it cannot distinguish "deliberately blank" from "defaulting did not
run", and suggests inventing a dimension value called `Blank`. **We do not.** NULL means *not coded*,
and every report shows it as an explicit **"(unassigned)"** bucket with its amount.

This is the same rule already enforced three times in this codebase and it has been right each time:
the map never invents a position; the 41 warehouse-less sales orders stayed NULL rather than
inheriting a site; `provisionSalesDimensions.ts` refuses to guess a default warehouse. A P&L that
silently attributes unattributed revenue to the busiest store is worse than one that admits the gap —
it is wrong *and* it looks right.

### 6.5 Requirement rules, kept small

One table, `DimensionRule (attribute_id, account_category?, account_id?, requirement)` where
requirement ∈ `OPTIONAL | REQUIRED`.

Keying primarily on **`Account.category`** — the country-independent classification added in
migration 003 — rather than on account codes, so the rule "every revenue and expense line must carry
a store" survives a change of chart of accounts and a change of country. That is the same reasoning
that took account numbers out of `provisionConfiguration.ts`.

Enforcement lives in `postJournal()`. A required-but-unresolved dimension follows the existing
`require_balanced_posting` convention exactly: throw when strict, log at ERROR and continue when not.
No third behaviour, and never silence.

### 6.6 The payoff, built in the same phase

Configuration nothing reads is worse than none — it looks like it works. That was the migration
008/009 lesson and it is not repeating here. The phase that adds the columns also ships:

- `GET /reports/pnl?by=dimension_1` — revenue and expense grouped by store, `(unassigned)` shown.
- The CEO dashboard's per-store card reading real ledger figures rather than document totals.

Query shape, for the record:

```sql
SELECT dv.code, a.category, SUM(jl.credit_amount - jl.debit_amount)
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.journal_entry_id
JOIN accounts a         ON a.id = jl.account_id
LEFT JOIN dimension_values dv ON dv.id = jl.dimension_1_id
WHERE je.tenant_id = $1 AND je.entry_date BETWEEN $2 AND $3
  AND a.category IN ('REVENUE','COGS','OPERATING_EXPENSE')
GROUP BY dv.code, a.category;
```

One index on `journal_lines (dimension_1_id)`. No pivot, no EAV join, no materialised set.

### 6.7 History

Existing journal lines have no dimension and honestly cannot get one in general. A backfill *can*
derive the store axis where the source document has a site: `source_module` + `source_id` →
sales order / purchase order → `site_id`. [REPO] that is 10 of 51 sales orders and 18 of 18 purchase
orders. Everything else stays NULL and appears as `(unassigned)`.

**[REC]** run it as a reported, reversible script with a dry run, on the same pattern as
`provisionSalesDimensions.ts` — and do not smooth over the fact that most sales history will remain
uncoded. It will make the first P&L-by-store look thin. That is an accurate picture of the data.

---

## 7. Sequencing

| Step | Content | Gate |
|---|---|---|
| **0** | `postJournal()` — single writer, balance assertion, tenant-scoped `entry_number`. No dimensions yet, no behaviour change | mechanical; needs approval only because it touches all 8 posting files |
| **1** | Migration: `DimensionAttribute`, `DimensionValue`, 4 slots on `JournalLine`, `DimensionRule`, `DefaultDimensionAssignment`. Additive | approval |
| **2** | Resolver + wiring into `postJournal()`; STORE axis provisioned entity-backed on `Site` | — |
| **3** | P&L by store + dashboard card + setup screen | — |
| **4** | Backfill script, dry run first | Finance co-founder |
| **later** | Department axis — **blocked on there being a department master; `Employee.department` is free text today** | Kubi |
| **later** | Derived dimensions, fixed dimensions, legal-entity overrides | — |

---

## 8. Open questions

1. **[Finance co-founder]** Which axes are real for this business beyond store? "Department inside a
   big store" is a stated future need — is it a *sales* department (footwear / accessories, which is
   arguably `ProductCategory` and already exists) or an *organisational* one (sales / warehouse /
   admin, which is `Employee.department` and is free text)? These are different tables and the answer
   changes step "later".
2. **[Finance co-founder]** Should the store dimension be **REQUIRED** on revenue and COGS accounts
   from day one? Required means a POS sale from a register whose session has no warehouse **fails to
   post**. That is the correct accounting answer and an operational risk on a shop floor.
3. **[Kubi]** Four slots — agree, or is there a known fifth axis?
4. **[ASSUMPTION]** That no Bolivian filing requires dimension-level detail. IVA and IT are declared
   at entity level, so dimensions are management reporting only. Not verified against SIN guidance.

---

## 9. What this design deliberately does not do

Recorded per the standing rule that future scope must stay visible.

- No account structures, no advanced rules, no segmented entry, no ledger-account-combination table.
- No dimension sets or maintained balances — reports aggregate from journal lines.
- No financial tags (§5 — and no hook, deliberately).
- No dimensions on the **document** beyond what migration 011 already derives; the axes land on the
  journal line, not on sales order lines.
- No budgeting, allocation or intercompany dimension behaviour.
