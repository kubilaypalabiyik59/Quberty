# Core ERP readiness gates — migration control and purchasing authorization

**Assessment date:** 2026-09-09
**Status:** Analysis and design only; no runtime, schema, migration, database, CI, or security change
is authorized by this document.
**Catalog scope:** `99.25.050.000 Manage data security`, `99.25.060.000 Configure segregation of
duties`; implementation dependency for `75.50.090.000 Issue and settle supplier payments`.

## 1. Decision

**[ARCHITECTURAL RECOMMENDATION]** Treat readiness as two serial, independently reviewable gates:

1. **Migration integrity gate:** establish a reproducible pre-`001` baseline, immutable checksums for
   `001`–`023`, a database ledger, a single-run lock, an empty-database rebuild, and schema-drift CI.
2. **Purchasing authorization gate:** inventory every purchasing entry point, assign one stable
   business-action permission or an explicit public classification, convert the purchasing slice to
   server-side permission enforcement, and record the first segregation-of-duties decisions.

The migration gate must land first because the authorization foundation will require schema changes.
The full security administration UI and full-product route conversion do not have to precede the
first AP payment slice. The purchasing slice does need enforceable permission codes and deny tests
before a payment-posting route is added.

## 2. Gate A — migration integrity

### 2.1 Current evidence

- **[REPO-VERIFIED]** The repository has 23 ordered hand-written SQL files in
  `backend/prisma/sql/`, but no `backend/prisma/migrations/` directory and no applied-migration
  ledger. The backlog already requires baselining `001`–`023`, checksums, a lock, empty-database
  rebuild, drift checks, and parallel-developer rules
  ([CODEX_CLAUDE_WORKLOG.md:94](../collaboration/CODEX_CLAUDE_WORKLOG.md#L94)).
- **[REPO-VERIFIED]** The custom runner accepts one caller-supplied filename, resolves it with
  `path.join`, splits SQL on semicolons, and executes the resulting statements in one Prisma
  transaction. It does not validate ordering, containment, filename shape, prior application, or
  checksum, and it has no cross-process migration lock
  ([applyMigration.ts:15](../../backend/scripts/applyMigration.ts#L15),
  [applyMigration.ts:27](../../backend/scripts/applyMigration.ts#L27),
  [applyMigration.ts:38](../../backend/scripts/applyMigration.ts#L38),
  [applyMigration.ts:50](../../backend/scripts/applyMigration.ts#L50)).
- **[REPO-VERIFIED]** The CI service starts an empty PostgreSQL database but calls
  `prisma migrate deploy`, even though the Prisma migration directory is absent. It therefore does
  not exercise the repository's actual SQL chain
  ([ci.yml:14](../../alm/pipelines/ci.yml#L14), [ci.yml:64](../../alm/pipelines/ci.yml#L64)).
- **[REPO-VERIFIED]** CI listens to `main` and `develop`, while the governed stable branch is
  `master` and current work uses short-lived `codex/*` branches
  ([ci.yml:3](../../alm/pipelines/ci.yml#L3),
  [CODEX_MEMORY.md:79](../collaboration/CODEX_MEMORY.md#L79)).
- **[REPO-VERIFIED]** `database/schema.sql` describes schema-per-tenant and has a globally unique
  user email. Both conflict with the current row-level tenant model, so this file cannot be accepted
  as the fresh-database baseline
  ([schema.sql:3](../../database/schema.sql#L3), [schema.sql:46](../../database/schema.sql#L46),
  [AGENTS.md:157](../../AGENTS.md#L157)).
- **[REPO-VERIFIED]** Migrations `001`–`004` first appeared in commit `b1be3591` and were designed
  against its parent `8ff69688`. Migration `001` already references the pre-existing `accounts`
  table, proving the numbered chain is not self-bootstrapping
  ([001_configuration_foundation.sql:1](../../backend/prisma/sql/001_configuration_foundation.sql#L1),
  [001_configuration_foundation.sql:155](../../backend/prisma/sql/001_configuration_foundation.sql#L155)).

### 2.2 Required design

**[ARCHITECTURAL RECOMMENDATION]** Use the current custom SQL family as the migration source of
truth. Introducing a second live Prisma-migration history beside it would create two authorities.
Replace the CI command that currently assumes Prisma migrations; continue using Prisma only as the
schema model and drift-comparison tool.

**[ARCHITECTURAL RECOMMENDATION]** Build a reviewed `000` baseline from the Prisma schema at
`8ff696884b841bc92da6e77ee75553c094b86ac2`, the parent immediately before migrations `001`–`004`.
Do not derive it from the stale `database/schema.sql`. The baseline is accepted only when:

1. applying `000` and then `001`–`023` to an empty ephemeral PostgreSQL database succeeds;
2. a database-to-current-Prisma diff is empty after ignoring only explicitly documented
   database-owned or unsupported objects;
3. required extensions, indexes, constraints, defaults, and partial indexes are verified rather
   than silently lost by schema generation; and
4. a second run refuses already-applied files without executing their SQL.

**[ARCHITECTURAL RECOMMENDATION]** Add one database-wide ledger, outside tenant business data, with
at least `migration_name`, `sha256`, `applied_at`, `applied_by`, `duration_ms`, and
`application_version`. Migration names and checksums are immutable. A checksum mismatch, a sequence
gap, an unknown ledger row, or an older unapplied migration fails closed.

**[ARCHITECTURAL RECOMMENDATION]** Acquire a PostgreSQL transaction-scoped advisory lock before
reading the ledger or applying SQL. The lock, ledger insert, and migration statements share the same
transaction. A transaction protects atomicity; the advisory lock additionally serializes two
deployers targeting the same database.

**[ARCHITECTURAL RECOMMENDATION]** The runner accepts only a discovered ordered set matching
`NNN_name.sql`. It resolves and verifies every path remains inside `backend/prisma/sql`, reads files
as bytes for SHA-256, and never accepts an arbitrary relative or absolute caller path. Replace the
semicolon splitter with whole-file execution through a driver path that preserves PostgreSQL SQL
syntax, or first prove the supported migration grammar and reject unsupported constructs.

### 2.3 Existing test database baseline

**[REPO-VERIFIED]** The test database was previously verified as containing migration `023` effects,
but it has no ledger history. That state is evidence for a future baseline operation, not permission
to write ledger rows ([CODEX_MEMORY.md:73](../collaboration/CODEX_MEMORY.md#L73)).

**[ARCHITECTURAL RECOMMENDATION]** After the empty-database chain is accepted, perform a separate
read-only catalog comparison against the test database. Only a later manual database gate may insert
baseline ledger rows for `001`–`023`. The gate must name the database, exact hashes, mismatch policy,
rollback/recovery, and post-write verification. Never infer application solely from a table's
existence when a migration also transforms data or constraints.

### 2.4 CI and parallel-development contract

**[ARCHITECTURAL RECOMMENDATION]** CI must:

1. trigger for pull requests to `master` and the repository's actual protected integration policy;
2. provision a new ephemeral PostgreSQL database;
3. apply `000` plus every numbered SQL file through the production runner;
4. verify ledger count, order, and checksums;
5. run schema drift comparison against `backend/prisma/schema.prisma`;
6. run the same chain a second time and prove that no SQL is re-executed; and
7. fail on a changed historical checksum, missing number, duplicate number, or untracked schema
   change.

**[ARCHITECTURAL RECOMMENDATION]** Each worktree uses its own disposable database for migration and
integration work. Developers do not share one mutable database. Only an explicitly designated
operator may migrate the shared test database, and the migration lock remains mandatory even there.
No worktree may run a migration file that is absent from its own checked-out commit.

### 2.5 Gate A acceptance

| Check | Required evidence |
|---|---|
| Baseline provenance | `000` generation source and review tie back to `8ff69688` |
| Deterministic rebuild | Empty PostgreSQL -> `000` -> `001`–`023` succeeds in CI |
| Immutable history | Edited historical SQL produces checksum failure before DDL |
| Ordering | Gap, duplicate number, out-of-order request, and unknown ledger row fail closed |
| Concurrency | Two runners against one database serialize; only one applies a pending file |
| Atomicity | Failed SQL leaves neither partial DDL nor ledger row |
| Drift | Database-to-Prisma comparison is empty or contains only an explicit reviewed allowlist |
| Repeatability | Second run executes no migration SQL and returns success |
| Existing database | Baseline is a separately approved DB operation after read-only comparison |

## 3. Gate B — purchasing authorization and segregation

### 3.1 Official evidence

- **[OFFICIAL DOCUMENTATION]** Finance and Operations composes permissions into privileges,
  privileges into duties, and duties into roles. Duties represent parts of business processes;
  privileges represent tasks. Microsoft recommends assigning duties to roles for maintainability:
  <https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/sysadmin/role-based-security>.
- **[OFFICIAL DOCUMENTATION]** Roles can be assigned for all legal entities or specific legal
  entities:
  <https://learn.microsoft.com/dynamics365/guidance/implementation-guide/security-strategy-product-oa#role-based-security>.
- **[OFFICIAL DOCUMENTATION]** Segregation rules define incompatible duty pairs. Conflicts are
  checked when roles are changed and when roles are assigned to users; an override requires a reason
  and remains reportable:
  <https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/sysadmin/set-up-segregation-duties>,
  <https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/sysadmin/identify-resolve-conflicts-segregation-duties>.
- **[OFFICIAL DOCUMENTATION]** Microsoft uses supplier maintenance, receipt of goods, and
  supplier-payment processing as an explicit example of responsibilities an organization may
  separate:
  <https://learn.microsoft.com/dynamics365/guidance/implementation-guide/security-strategy-product-oa#segregation-of-duties>.
- **[OFFICIAL DOCUMENTATION]** Role-based authorization and row/data security are separate layers;
  XDS can further restrict records available through an authorized function:
  <https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/sysadmin/extensible-data-security-policies>.
- **[OFFICIAL DOCUMENTATION]** D365 exposes role assignment history and security-configuration
  history through security reports:
  <https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/sysadmin/security-reports>.

The official hierarchy is architectural evidence. It does not require Skarpine to reproduce X++
entry-point metadata, every standard D365 role, XDS internals, or the full security administration
surface.

### 3.2 Current route evidence

**[REPO-VERIFIED]** The two purchasing route files expose 45 entry points: 25 in
`purchase.routes.ts` and 20 in `procurement.routes.ts`. Twenty-nine use fixed `requireRole` checks;
16 rely only on the globally mounted authenticated tenant context. No production route calls the
existing `requirePermission` middleware. That middleware appears only in its own tests
([purchase.routes.ts:42](../../backend/src/modules/purchase/purchase.routes.ts#L42),
[procurement.routes.ts:50](../../backend/src/modules/purchase/procurement.routes.ts#L50),
[permissions.ts:74](../../backend/src/shared/middleware/permissions.ts#L74)).

**[REPO-VERIFIED]** Three authenticated-only purchasing mutations require no business permission:
create requisition, submit requisition, and cancel requisition
([procurement.routes.ts:73](../../backend/src/modules/purchase/procurement.routes.ts#L73),
[procurement.routes.ts:127](../../backend/src/modules/purchase/procurement.routes.ts#L127),
[procurement.routes.ts:157](../../backend/src/modules/purchase/procurement.routes.ts#L157)).

**[REPO-VERIFIED]** The current static permission catalog has broad purchase actions, but production
routes do not enforce them. `store_manager` simultaneously receives purchase confirmation, receipt,
payment, cancellation, journal, warehouse, and supplier/customer maintenance powers
([permissions.ts:4](../../backend/src/shared/middleware/permissions.ts#L4),
[permissions.ts:37](../../backend/src/shared/middleware/permissions.ts#L37)).

**[REPO-VERIFIED]** Current route guards collapse materially different transitions: requisition
approval/rejection, RFQ award, purchase-order confirmation, goods receipt, invoice creation/matching,
invoice posting, and legacy purchase-order payment are all available to `store_manager`
([procurement.routes.ts:131](../../backend/src/modules/purchase/procurement.routes.ts#L131),
[procurement.routes.ts:238](../../backend/src/modules/purchase/procurement.routes.ts#L238),
[purchase.routes.ts:311](../../backend/src/modules/purchase/purchase.routes.ts#L311),
[purchase.routes.ts:329](../../backend/src/modules/purchase/purchase.routes.ts#L329),
[purchase.routes.ts:395](../../backend/src/modules/purchase/purchase.routes.ts#L395),
[purchase.routes.ts:504](../../backend/src/modules/purchase/purchase.routes.ts#L504),
[purchase.routes.ts:537](../../backend/src/modules/purchase/purchase.routes.ts#L537)).

### 3.3 Minimum purchasing permission spine

**[ARCHITECTURAL RECOMMENDATION]** Register permissions as stable business actions. The first slice
needs at least:

| Duty family | Permission codes |
|---|---|
| Supplier master | `purchase.supplier.read`, `purchase.supplier.maintain` |
| Requisition | `purchase.requisition.read`, `.create`, `.submit`, `.approve`, `.cancel` |
| Sourcing | `purchase.rfq.read`, `.maintain`, `.send`, `.response.manage`, `.award`, `.cancel` |
| Purchase order | `purchase.order.read`, `.create`, `.update`, `.confirm`, `.cancel` |
| Receipt | `purchase.receipt.read`, `.post` |
| Supplier invoice | `purchase.vendor_invoice.read`, `.create`, `.match`, `.approve_discrepancy`, `.post`, `.cancel` |
| AP payment | `purchase.vendor_payment.read`, `.create`, `.post`, `.settle`, `.reverse` |
| Setup | `purchase.setup.read`, `purchase.setup.maintain` |

These codes are application-owned entry points. Tenant administrators may compose registered codes
into roles later, but may not invent unenforced permission strings.

#### Route-to-permission audit

**[ARCHITECTURAL RECOMMENDATION]** This is the required conversion map. `AUTH_ONLY` means the route
currently inherits only the globally mounted authentication/tenant middleware. `ROLE` means a fixed
`requireRole` guard. A list in the target column means the route must require every listed action.

| Route | Current | Target permission |
|---|---|---|
| `GET /purchase/suppliers` | AUTH_ONLY | `purchase.supplier.read` |
| `POST /purchase/suppliers` | ROLE | `purchase.supplier.maintain` |
| `PUT /purchase/suppliers/:id` | ROLE | `purchase.supplier.maintain` |
| `GET /purchase/orders` | AUTH_ONLY | `purchase.order.read` |
| `GET /purchase/orders/received-not-invoiced` | AUTH_ONLY | `purchase.order.read` |
| `GET /purchase/orders/:id` | AUTH_ONLY | `purchase.order.read` |
| `PUT /purchase/orders/:id` | ROLE | `purchase.order.update` |
| `POST /purchase/orders` | ROLE | `purchase.order.create` |
| `POST /purchase/orders/:id/confirm` | ROLE | `purchase.order.confirm` |
| `POST /purchase/orders/:id/receive` | ROLE | `purchase.receipt.post` |
| `GET /purchase/orders/:id/receipts` | AUTH_ONLY | `purchase.receipt.read` |
| `GET /purchase/receipts` | AUTH_ONLY | `purchase.receipt.read` |
| `POST /purchase/orders/:id/cancel` | ROLE | `purchase.order.cancel` |
| `POST /purchase/orders/:id/pay` | ROLE | `purchase.vendor_payment.post` during compatibility; retire with the PO-payment shortcut |
| `GET /purchase/invoices` | AUTH_ONLY | `purchase.vendor_invoice.read` |
| `GET /purchase/invoices/:id` | AUTH_ONLY | `purchase.vendor_invoice.read` |
| `POST /purchase/invoices` | ROLE | `purchase.vendor_invoice.create` |
| `POST /purchase/invoices/:id/match` | ROLE | `purchase.vendor_invoice.match` |
| `POST /purchase/invoices/:id/approve-discrepancies` | ROLE | `purchase.vendor_invoice.approve_discrepancy` |
| `POST /purchase/invoices/:id/post` | ROLE | `purchase.vendor_invoice.post` |
| `POST /purchase/invoices/:id/cancel` | ROLE | `purchase.vendor_invoice.cancel` |
| `POST /purchase/orders/:id/receive-and-invoice` | ROLE | `purchase.receipt.post`, `purchase.vendor_invoice.create`, `.match`, `.post` |
| `GET /purchase/setup/trade-agreements` | ROLE | `purchase.setup.read` |
| `POST /purchase/setup/trade-agreements` | ROLE | `purchase.setup.maintain` |
| `POST /purchase/setup/trade-agreements/:id/close` | ROLE | `purchase.setup.maintain` |
| `GET /procurement/requisitions` | AUTH_ONLY | `purchase.requisition.read` |
| `POST /procurement/requisitions` | AUTH_ONLY | `purchase.requisition.create` |
| `GET /procurement/requisitions/:id` | AUTH_ONLY | `purchase.requisition.read` |
| `POST /procurement/requisitions/:id/submit` | AUTH_ONLY | `purchase.requisition.submit` |
| `POST /procurement/requisitions/:id/approve` | ROLE | `purchase.requisition.approve` |
| `POST /procurement/requisitions/:id/reject` | ROLE | `purchase.requisition.approve` |
| `POST /procurement/requisitions/:id/cancel` | AUTH_ONLY | `purchase.requisition.cancel` |
| `POST /procurement/requisitions/:id/purchase-order` | ROLE | `purchase.order.create` |
| `POST /procurement/requisitions/:id/rfq` | ROLE | `purchase.rfq.maintain` |
| `GET /procurement/rfq` | AUTH_ONLY | `purchase.rfq.read` |
| `POST /procurement/rfq` | ROLE | `purchase.rfq.maintain` |
| `GET /procurement/rfq/:id` | AUTH_ONLY | `purchase.rfq.read` |
| `GET /procurement/rfq/:id/compare` | AUTH_ONLY | `purchase.rfq.read` |
| `POST /procurement/rfq/:id/vendors` | ROLE | `purchase.rfq.maintain` |
| `POST /procurement/rfq/:id/send` | ROLE | `purchase.rfq.send` |
| `POST /procurement/rfq/:id/award` | ROLE | `purchase.rfq.award` |
| `POST /procurement/rfq/:id/cancel` | ROLE | `purchase.rfq.cancel` |
| `POST /procurement/rfq/bids/:requestId` | ROLE | `purchase.rfq.response.manage` |
| `POST /procurement/rfq/bids/:requestId/decline` | ROLE | `purchase.rfq.response.manage` |
| `POST /procurement/rfq/bids/:requestId/reject` | ROLE | `purchase.rfq.response.manage` |

**[ARCHITECTURAL RECOMMENDATION]** The first implementation may map legacy roles to these codes as a
versioned compatibility policy, but routes must call the permission layer and deny unknown roles by
default. This containment step does not claim that the future Role/Duty/Privilege schema is already
implemented. Role assignments need a nullable legal-entity scope hook from their first schema.

### 3.4 Initial segregation decisions

| Duty pair | Proposed CORE_NOW treatment | Evidence status |
|---|---|---|
| Maintain supplier / post supplier payment | Hard conflict unless a documented owner override exists | **[OFFICIAL DOCUMENTATION]** Microsoft names this separation; product treatment is a recommendation |
| Post goods receipt / post supplier payment | Hard conflict unless a documented owner override exists | **[OFFICIAL DOCUMENTATION]** Microsoft names this separation; product treatment is a recommendation |
| Create payment / post same payment | Separate permissions; same-user block is configurable, not assumed | **[ASSUMPTION NEEDING VALIDATION]** |
| Create supplier invoice / approve discrepancy | Separate permissions; require different users only when policy says so | **[ARCHITECTURAL RECOMMENDATION]** |
| Create requisition / approve same requisition | Keep separate permissions; self-approval policy remains configurable | **[ASSUMPTION NEEDING VALIDATION]** |
| Maintain purchasing setup / execute purchasing | Audit both; no blanket conflict in CORE_NOW | **[ARCHITECTURAL RECOMMENDATION]** |

For a three-store retailer, full enterprise SOD workflow would be disproportionate. The minimum
honest model is a small conflict catalog, severity, active flag, override policy, mandatory reason,
approver, and immutable resolution history. A tenant with too few staff may use a named owner
override; silent role collapse is not an override.

### 3.5 Gate B acceptance

1. Every one of the 45 purchasing routes has an explicit stable permission code; no route inherits
   business access merely because the caller is authenticated.
2. Direct API tests prove positive and negative access for requester, buyer, receiver, AP clerk,
   finance approver, auditor/read-only, customer, and unknown-role identities.
3. Customer identities cannot read purchasing documents or invoke purchasing mutations.
4. Read permissions remain distinct from create, approve, post, settle, reverse, cancel, and setup.
5. Tenant isolation remains server-derived and is tested independently of permissions.
6. Effective access can be scoped to a legal entity without redesigning role assignment tables.
7. Permission and role-assignment changes, denials, SOD conflicts, and overrides have durable audit
   evidence; fire-and-forget success-only request logging is insufficient.
8. A new vendor-payment route cannot reuse `requireRole('admin', 'store_manager')` or the legacy
   `purchase:pay` shortcut as its final authorization contract.

## 4. Sequence and stop line

**[ARCHITECTURAL RECOMMENDATION]** Prepare future implementation as separate items:

1. `WORK-014`: migration runner/ledger/lock plus offline unit tests; no shared-database write.
2. `WORK-015`: ephemeral empty-database rebuild and drift CI; no test-database mutation.
3. `WORK-016`: purchasing permission registry, route conversion, and deny tests using a temporary
   legacy-role compatibility map; no full security UI.
4. Later manual DB gate: read-only compare, then separately approved baseline ledger insertion for
   the shared test database.
5. Only then: vendor payment and settlement implementation from
   `VENDOR_PAYMENT_SETTLEMENT.md`.

No step above is implementation authorization. Before `WORK-014` begins, its exact paths, migration
format, test boundary, and commit policy must be approved. Before `WORK-016`, Kubi must validate the
CORE_NOW SOD treatment and the minimum real-life test roles.
