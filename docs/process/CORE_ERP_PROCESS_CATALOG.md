# Core ERP process catalog framework

**Decision date:** 2026-09-07

**Source snapshot:** `Business Process Catalog JUL 2026.xlsx`

**Decision:** use the Microsoft Dynamics 365 Business Process Catalog as Skarpine's canonical
process taxonomy, but never as an automatic feature backlog or a promise of D365 feature parity.

This document defines how the catalog becomes the backbone of product scope, gap analysis,
configuration design, implementation evidence, and regression coverage.

---

## 1. Evidence and decision labels

- **[OFFICIAL]** Microsoft says the catalog is an Excel export of its internal process-definition
  tool, intended to support filtering, onboarding, implementation projects, and process workshops.
  Microsoft also says it is updated at least four times per year.
  ([About the Business Process Catalog](https://learn.microsoft.com/dynamics365/guidance/business-processes/about))
- **[OFFICIAL]** The July 2026 catalog has six levels: end-to-end process, business process area,
  business process, scenario, system process, and test case.
  ([About the Business Process Catalog](https://learn.microsoft.com/dynamics365/guidance/business-processes/about))
- **[WORKBOOK-VERIFIED]** The supplied July 2026 workbook contains 6,834 catalog entries:
  15 end-to-end processes, 94 process areas, 677 business processes, 3,592 scenarios,
  827 system processes, and 1,628 test cases.
- **[ARCHITECTURAL RECOMMENDATION]** Skarpine should use those IDs and parent-child relationships
  as the stable navigation spine for product decisions. Skarpine-specific scope, status,
  parameters, schema hooks, localization, and evidence remain a separate overlay.

---

## 2. What "the backbone" means

The catalog answers **where a capability belongs** and **which end-to-end outcome it supports**.
It does not answer whether Skarpine should build the capability, whether existing code implements
it correctly, or whether Microsoft's D365 implementation is appropriate for an SME product.

| Catalog level | Skarpine use |
|---|---|
| End-to-end process | Product capability map and commercial packaging boundary |
| Business process area | Ownership and roadmap grouping |
| Business process | Unit of fit/gap analysis and product-scope decisions |
| Scenario | Configurable business pattern; never assume every pattern is required |
| System process | Candidate mapping to forms, routes, services, jobs, and permissions |
| Test case | Seed for acceptance coverage; not proof that Skarpine is tested |

This preserves the project's process-first rule. Modules remain technical and commercial
packaging units, but completion is judged through end-to-end processes.

---

## 3. Scope and implementation are separate axes

Every mapped catalog entry must have one **product scope status**:

| Scope status | Meaning |
|---|---|
| `CORE_NOW` | Required for the first sellable Core ERP golden flows |
| `CORE_LATER` | Belongs in Core ERP, but is not required for the first release |
| `ADD_ON` | Reusable optional package such as POS, e-commerce, advanced warehouse, or service |
| `CUSTOMER_EXTENSION` | A client-specific need that has not justified a reusable package |
| `OUT_OF_SCOPE` | Deliberately excluded; rationale and schema-hook decision required |
| `NEEDS_VALIDATION` | Product decision has not yet been made |

It must independently have one **implementation status**:

| Implementation status | Meaning |
|---|---|
| `NOT_ASSESSED` | No repo comparison has been performed |
| `ABSENT` | No implementation evidence found |
| `PARTIAL` | Some steps exist, but the business outcome is incomplete |
| `IMPLEMENTED_UNVERIFIED` | Code exists, but no acceptable execution evidence exists |
| `VERIFIED` | The mapped acceptance evidence proves the supported scenario |
| `REGRESSION` | Previously verified behaviour is currently failing |

`OUT_OF_SCOPE` is not the same as `ABSENT`, and `IMPLEMENTED_UNVERIFIED` is not the same as
`VERIFIED`. This distinction is mandatory in future status documents and Claude prompts.

---

## 4. Initial Core ERP backbone

The following is an initial product classification, not a line-by-line fit/gap result.

| ID | End-to-end process | Initial classification | Reason |
|---:|---|---|---|
| 40 | Design to retire | Core foundation | Product and released-product anatomy underpin both buying and selling |
| 60 | Inventory to deliver | Core now | Inventory, inbound, outbound, and warehouse execution connect S2P and O2C |
| 65 | Order to cash | Core now | Primary revenue golden flow |
| 75 | Source to pay | Core now | Primary procurement golden flow |
| 90 | Record to report | Core now | Financial consequences and period controls prove transaction integrity |
| 99 | Administer to operate | Core platform | Setup, numbering, security, data, jobs, and operations make the product usable |
| 85 | Prospect to quote | Core later | Upstream commercial flow; useful but not required to prove transaction posting |
| 50 | Forecast to plan | Core later | Planning remains deferred; preserve only justified low-cost hooks |
| 10 | Acquire to dispose | Core later | Fixed assets are not required for the anchor retail golden flows |
| 55 | Hire to retire | Add-on / later | Existing HR breadth does not determine Core ERP completion |
| 20 | Case to resolution | Add-on | Candidate after-sales/service package |
| 30 | Concept to market | Later | Product ideation is outside the initial retailer transaction core |
| 70 | Plan to produce | Out of scope | Anchor market is retail, not manufacturing; do not let production distort the schema |
| 80 | Project to profit | Out of scope / later | Project accounting is not part of the initial product promise |
| 95 | Service to deliver | Add-on | Candidate service-management package, separate from the transaction core |

The tiebreaker remains: would a business of roughly 50 employees or fewer, such as a three-store
shoe retailer, use this to professionalize operations? D365 presence alone is never sufficient.

### Core process areas from the July 2026 snapshot

| ID | Process area |
|---|---|
| 40.10 | Develop product strategy |
| 40.20 | Introduce products |
| 40.50 | Manage active products |
| 40.60 | Retire products |
| 40.90 | Analyze product performance |
| 60.10 | Manage warehouse operations |
| 60.20 | Maintain inventory levels |
| 60.30 | Process inbound goods |
| 60.40 | Process outbound goods |
| 60.50 | Manage inventory quality |
| 60.60 | Manage freight and transportation |
| 60.80 | Analyze warehouse operations |
| 65.05 | Develop sales policies |
| 65.20 | Manage sales orders |
| 65.30 | Manage accounts receivable |
| 65.50 | Manage credit and collections |
| 65.60 | Analyze sales performance |
| 75.10 | Develop procurement and sourcing strategy |
| 75.30 | Manage supplier relationships |
| 75.35 | Source and contract goods and services |
| 75.40 | Procure goods and services |
| 75.50 | Manage accounts payable |
| 75.80 | Analyze procurement and sourcing |
| 90.10 | Define accounting policies |
| 90.25 | Manage cash |
| 90.30 | Manage budgets |
| 90.50 | Record financial transactions |
| 90.60 | Close financial periods |
| 90.70 | Analyze financial performance |
| 99.20 | Administer system features |
| 99.25 | Manage system access and security |
| 99.35 | Monitor systems, environments, and capacity |
| 99.40 | Manage background jobs |
| 99.45 | Manage notifications alerts |
| 99.55 | Manage data |
| 99.60 | Manage system compliance |
| 99.65 | Support systems |

The remaining Administer to operate areas are retained in the taxonomy but are not automatically
Core ERP implementation scope.

---

## 5. Required mapping record

The future **Core ERP Completion Matrix** must contain one row per selected catalog item and at
least these fields:

| Field | Purpose |
|---|---|
| `catalog_version` | Prevent silent drift when Microsoft republishes the workbook |
| `catalog_id` | Hierarchical process sequence ID |
| `microsoft_id` | Opaque Microsoft identity retained for change matching |
| `level` and `parent_id` | Preserve the six-level hierarchy |
| `title` | Microsoft title from the frozen snapshot |
| `product_tags` | Source metadata only; never the sole scope filter |
| `scope_status` and `scope_rationale` | Skarpine product decision |
| `implementation_status` | Repo-verified state using the controlled vocabulary above |
| `repo_evidence` | Files, routes, schema models, and exact line references |
| `parameter_owner` | Owning module Setup area and parameters record |
| `hard_coding_debt` | Configuration still embedded in code |
| `schema_hook` | Specific hook for deferred capability, or explicit `NONE_REQUIRED` |
| `localization_effect` | Bolivia regression constraint and future jurisdiction behaviour |
| `acceptance_evidence` | Automated test, browser flow, database assertion, or named gap |
| `last_verified_at` | Date evidence was last rechecked |

The matrix is a governed derivative. The source workbook remains read-only and outside the repo
until a separate decision establishes licensing, storage, and update mechanics.

---

## 6. Guardrails discovered in the workbook

1. **Do not filter scope by `Products` alone.** The workbook has 4,370 rows tagged Finance or
   Supply Chain Management, far beyond the SME product boundary, and some parent tags are incomplete
   or surprising. Product tags are discovery metadata, not product decisions.
2. **Do not treat every scenario as a requirement.** The workbook contains 3,592 scenarios because
   it spans multiple industries, organization types, and implementation patterns.
3. **Do not treat catalog test cases as sufficient coverage.** Lower-level coverage is uneven. In
   the supplied snapshot, Source to pay and Order to cash have substantial system-process/test-case
   detail, while Inventory to deliver has only 7 system processes and 26 test cases.
4. **Do not copy descriptions or references without validation.** The workbook contains text
   encoding artifacts, transitional naming, and references that may lag the July 2026 hierarchy.
5. **Do not overwrite local decisions when the catalog changes.** Microsoft updates the catalog at
   least quarterly. A new source version requires a diff and an explicit adoption decision.

---

## 7. Versioning and update protocol

1. Freeze the current source as `JUL-2026` in every derived row.
2. Match future releases first by `Microsoft ID`, then by process sequence ID and parent lineage.
3. Produce an added/removed/renamed/reparented diff before adopting a new release.
4. Never silently renumber Skarpine mappings or erase a retired Microsoft entry.
5. Record product-scope decisions separately from Microsoft catalog content.
6. Validate every selected process against the current Microsoft Learn page before design or
   implementation; label missing or conflicting guidance as unverified.
7. Carry the selected catalog IDs, parameterization obligation, schema-hook decision, and required
   acceptance evidence into every implementation work item.

---

## 8. Next bounded deliverable

Build the **Core ERP Completion Matrix** for the first golden-flow slice, not for all 6,834 rows:

1. `75.40 Procure goods and services`
2. `75.50 Manage accounts payable`
3. `60.30 Process inbound goods`
4. `65.20 Manage sales orders`
5. `60.40 Process outbound goods`
6. `65.30 Manage accounts receivable`
7. `90.50 Record financial transactions`
8. Relevant `99.20 Administer system features` entries for setup and number sequences

Start at business-process level, descend only into scenarios needed for the supported SME flow,
then map system processes and tests where the workbook provides them. This is analysis work and
does not authorize schema, route, UI, migration, or data changes.
