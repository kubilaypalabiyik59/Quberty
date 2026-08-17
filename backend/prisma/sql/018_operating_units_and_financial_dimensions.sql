-- 018 — Operating units (the department master) + financial dimensions
--
-- Design: docs/architecture/FINANCIAL_DIMENSIONS.md. This migration implements
-- step 1 of its §7 sequencing table, plus the master data that step "later" was
-- blocked on.
--
-- Step 0 (`postJournal()`, the single journal writer) shipped in commit def8122 and
-- is the reason this migration is safe: dimensions are applied in ONE function
-- rather than in sixteen hand-built line arrays.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PART A — OPERATING UNITS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Kubi's requirement: "bırak mağazayı, kocaman bir mağazanın içerisindeki
-- departmanlar bazında bile finansal takip isteyebilirler." The second axis is the
-- ORGANISATIONAL department, and `employees.department` is free text today, so the
-- master did not exist.
--
-- ── Why this is not a `departments` table ───────────────────────────────────
-- **[OFFICIAL]** D365 has no department table. A department is an OPERATING UNIT
-- with the type *Department*:
--
--   "Department — An operating unit that represents a category or functional part
--    of an organization that performs a specific task, such as sales or accounting.
--    Used to report on functional areas. A department might have profit and loss
--    responsibility, and might consist of a group of cost centers."
--
--   The full type list is: Cost center, Business unit, Value stream, Department,
--   Retail channel.
--   learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/organization-administration/organizations-organizational-hierarchies#organizations
--
-- **[OFFICIAL]** and operating units are precisely what feeds this migration's
-- Part B: "The types of operating units include cost centers, business units, value
-- streams, departments, and commerce channels. Although operating units are
-- optional in finance and operations apps, they're commonly used as FINANCIAL
-- DIMENSIONS."
--   learn.microsoft.com/dynamics365/guidance/organizational-strategy/define-organizational-strategy#organizational-structure-components
--
-- So one table with a type discriminator gives us the department Kubi asked for
-- AND the cost centre that FINANCIAL_DIMENSIONS.md §6.1 could only guess at when it
-- allocated slots 3 and 4. The cost of the generality is one TEXT column.
--
-- **[OFFICIAL]** the columns below are the *Department* form's own fields — Name,
-- Department number, Search name, Memo, Manager.
--   learn.microsoft.com/dynamics365/human-resources/hr-personnel-add-department-hierarchy
--
-- **[OFFICIAL]** the number is unique across ALL operating units, not per type:
-- "This number is a unique identifier for the corresponding Party record and can't
-- be the same as any other operating unit."
--   learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/organization-administration/tasks/create-operating-unit
-- Hence `(tenant_id, code)` and not `(tenant_id, unit_type, code)`.
--
-- ── What is deliberately CUT, and the hook that survives ────────────────────
-- D365 models the tree as a separate *organization hierarchy* with an assigned
-- PURPOSE, draft/publish versioning and effective dates. Five screens before a shoe
-- shop can tag a payroll line with "Sales" — the enterprise weight CLAUDE.md §3
-- exists to avoid. CUT.
--
-- The hook kept is `parent_id`: a department hierarchy is a tree, and a tree needs
-- one nullable self-FK. Multiple hierarchies over the same units, purposes and
-- published versions are additive later (a `hierarchy_id` on an edge table) and
-- need no change here.
--
-- Also CUT: Jobs and Positions. **[OFFICIAL]** D365 assigns positions to
-- departments and a worker reaches a department THROUGH the position
-- ("A position exists in a department"). We attach the employee to the department
-- directly. For a ≤50-employee business a position master is bookkeeping nobody
-- maintains. If it arrives, `employees.department_id` becomes derived and the
-- column stays — no data migration.

CREATE TABLE IF NOT EXISTS "operating_units" (
    "id"              UUID PRIMARY KEY,
    "tenant_id"       UUID NOT NULL,
    -- Forward hook, as on every table since migration 001.
    "legal_entity_id" UUID,

    -- D365's "Department number".
    "code"            TEXT NOT NULL,
    "name"            TEXT NOT NULL,
    -- D365's "Search name" — an acronym to find it by.
    "search_name"     TEXT,
    -- D365's "Memo".
    "memo"            TEXT,

    -- The discriminator. **[OFFICIAL]** the five operating unit types.
    "unit_type"       TEXT NOT NULL,

    -- The tree. NULL = a root unit.
    "parent_id"       UUID REFERENCES "operating_units"("id"),

    -- D365's "Manager". Nullable: a department can exist before it has one.
    "manager_employee_id" UUID REFERENCES "employees"("id"),

    "is_active"       BOOLEAN NOT NULL DEFAULT true,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "operating_units"
    DROP CONSTRAINT IF EXISTS "operating_units_unit_type_check";
ALTER TABLE "operating_units"
    ADD CONSTRAINT "operating_units_unit_type_check"
    CHECK ("unit_type" IN (
        'DEPARTMENT', 'COST_CENTER', 'BUSINESS_UNIT', 'VALUE_STREAM', 'RETAIL_CHANNEL'
    ));

-- Unique across all types, per the Party-number rule quoted above.
CREATE UNIQUE INDEX IF NOT EXISTS "operating_units_tenant_code_key"
    ON "operating_units" ("tenant_id", "code");
CREATE INDEX IF NOT EXISTS "operating_units_tenant_type_idx"
    ON "operating_units" ("tenant_id", "unit_type");
CREATE INDEX IF NOT EXISTS "operating_units_parent_idx"
    ON "operating_units" ("parent_id");

-- ── employees.department: free text → FK ────────────────────────────────────
-- The old column is KEPT and marked deprecated, exactly as migration 014 kept
-- `product_variants.size`. Nothing is lost, and the two representations can be
-- compared. Dropping it is a separate decision.
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "department_id" UUID
    REFERENCES "operating_units"("id");
CREATE INDEX IF NOT EXISTS "employees_department_idx"
    ON "employees" ("department_id");


-- ═══════════════════════════════════════════════════════════════════════════
-- PART B — FINANCIAL DIMENSIONS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Shape: 4 fixed slots + a registry (FINANCIAL_DIMENSIONS.md §6.1). Not two
-- hardcoded FKs (answers today's question, blocks Kubi's actual one) and not EAV
-- (the shape CLAUDE.md §3 names as the thing not to copy).
--
-- **[OFFICIAL]** two dimension types exist — *custom* (values maintained by hand)
-- and *entity-backed* (values come from an existing table chosen in "Use values
-- from"). `value_source` is that choice.
--   learn.microsoft.com/dynamics365/finance/general-ledger/financial-dimensions#financial-dimension-types

CREATE TABLE IF NOT EXISTS "dimension_attributes" (
    "id"              UUID PRIMARY KEY,
    "tenant_id"       UUID NOT NULL,
    "legal_entity_id" UUID,

    "code"            TEXT NOT NULL,   -- STORE, DEPT
    "name"            TEXT NOT NULL,

    -- Which journal_lines.dimension_N_id column carries this axis.
    "slot"            INT NOT NULL,

    -- CUSTOM = hand-maintained values. Anything else names the backing table.
    "value_source"    TEXT NOT NULL DEFAULT 'CUSTOM',

    "is_active"       BOOLEAN NOT NULL DEFAULT true,
    "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "dimension_attributes"
    DROP CONSTRAINT IF EXISTS "dimension_attributes_slot_check";
ALTER TABLE "dimension_attributes"
    ADD CONSTRAINT "dimension_attributes_slot_check" CHECK ("slot" BETWEEN 1 AND 4);

ALTER TABLE "dimension_attributes"
    DROP CONSTRAINT IF EXISTS "dimension_attributes_value_source_check";
ALTER TABLE "dimension_attributes"
    ADD CONSTRAINT "dimension_attributes_value_source_check"
    CHECK ("value_source" IN (
        'CUSTOM', 'SITE', 'WAREHOUSE', 'OPERATING_UNIT', 'EMPLOYEE', 'PRODUCT_CATEGORY'
    ));

-- NULLS NOT DISTINCT on legal_entity_id, for the same reason migration 001 needed
-- it hand-added: without it two tenant-default rows both pass a plain unique index.
CREATE UNIQUE INDEX IF NOT EXISTS "dimension_attributes_tenant_code_key"
    ON "dimension_attributes" ("tenant_id", "legal_entity_id", "code") NULLS NOT DISTINCT;
-- One axis per slot. This is what makes `GROUP BY dimension_1_id` mean one thing.
CREATE UNIQUE INDEX IF NOT EXISTS "dimension_attributes_tenant_slot_key"
    ON "dimension_attributes" ("tenant_id", "legal_entity_id", "slot") NULLS NOT DISTINCT;


CREATE TABLE IF NOT EXISTS "dimension_values" (
    "id"           UUID PRIMARY KEY,
    "tenant_id"    UUID NOT NULL,
    "attribute_id" UUID NOT NULL REFERENCES "dimension_attributes"("id") ON DELETE CASCADE,

    "code"         TEXT NOT NULL,
    "name"         TEXT NOT NULL,

    -- The backing row, for entity-backed axes. NULL for CUSTOM.
    -- Deliberately NOT a foreign key: the target table varies by `value_source`,
    -- and a polymorphic FK is not expressible. Referential integrity is enforced by
    -- the resolver, which only ever writes an id it has just read.
    "source_id"    UUID,

    "is_active"    BOOLEAN NOT NULL DEFAULT true,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- **[OFFICIAL]** "Dimension values can have a maximum of 30 characters."
--   learn.microsoft.com/dynamics365/finance/general-ledger/tasks/define-financial-dimensions#naming-requirements
--
-- The SAME page also requires values to contain only letters, digits and
-- underscores, because a value containing the chart-of-accounts delimiter makes the
-- segmented-entry parser read it as a segment break. We do NOT enforce that half,
-- and this is a deliberate deviation rather than an oversight: FINANCIAL_DIMENSIONS
-- §5 CUT segmented entry, so there is no delimiter to collide with — and this
-- tenant's own site codes (SITE-WH-001) contain hyphens, so enforcing it would mean
-- inventing new codes for existing master data.
--
-- What IS enforced is length and the absence of whitespace, which keeps the values
-- usable as report column headings. **If segmented entry is ever added, its
-- delimiter must not be `-`.**
ALTER TABLE "dimension_values"
    DROP CONSTRAINT IF EXISTS "dimension_values_code_check";
ALTER TABLE "dimension_values"
    ADD CONSTRAINT "dimension_values_code_check"
    CHECK (char_length("code") BETWEEN 1 AND 30 AND "code" !~ '\s');

CREATE UNIQUE INDEX IF NOT EXISTS "dimension_values_attr_code_key"
    ON "dimension_values" ("tenant_id", "attribute_id", "code");
CREATE INDEX IF NOT EXISTS "dimension_values_source_idx"
    ON "dimension_values" ("tenant_id", "attribute_id", "source_id");


-- ── Requirement rules ───────────────────────────────────────────────────────
-- D365's account structures decide which dimensions are required for which main
-- accounts. FINANCIAL_DIMENSIONS §5 cut the structure tree and kept its degenerate
-- case: a rule keyed on `accounts.category` — the country-independent
-- classification from migration 003 — so "every revenue and COGS line must carry a
-- store" survives a change of chart of accounts and a change of country.
--
-- `account_id` is the narrower override: a rule for one specific account.
CREATE TABLE IF NOT EXISTS "dimension_rules" (
    "id"               UUID PRIMARY KEY,
    "tenant_id"        UUID NOT NULL,
    "legal_entity_id"  UUID,
    "attribute_id"     UUID NOT NULL REFERENCES "dimension_attributes"("id") ON DELETE CASCADE,

    -- Exactly one of these two is set. Category = the broad rule, account = the
    -- specific override.
    "account_category" TEXT,
    "account_id"       UUID REFERENCES "accounts"("id") ON DELETE CASCADE,

    "requirement"      TEXT NOT NULL DEFAULT 'OPTIONAL',

    -- **[OFFICIAL]** D365's *fixed dimension* on a main account: at posting the
    -- fixed value REPLACES whatever is on the line. Declared as the documented hook
    -- from FINANCIAL_DIMENSIONS §5; nothing reads it yet and the service says so.
    "fixed_value_id"   UUID REFERENCES "dimension_values"("id"),

    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "dimension_rules"
    DROP CONSTRAINT IF EXISTS "dimension_rules_requirement_check";
ALTER TABLE "dimension_rules"
    ADD CONSTRAINT "dimension_rules_requirement_check"
    CHECK ("requirement" IN ('OPTIONAL', 'REQUIRED'));

-- A rule that names neither a category nor an account applies to nothing and would
-- sit in the table looking configured. A rule that names both is ambiguous.
ALTER TABLE "dimension_rules"
    DROP CONSTRAINT IF EXISTS "dimension_rules_target_check";
ALTER TABLE "dimension_rules"
    ADD CONSTRAINT "dimension_rules_target_check"
    CHECK (num_nonnulls("account_category", "account_id") = 1);

CREATE UNIQUE INDEX IF NOT EXISTS "dimension_rules_category_key"
    ON "dimension_rules" ("tenant_id", "legal_entity_id", "attribute_id", "account_category")
    NULLS NOT DISTINCT;
CREATE UNIQUE INDEX IF NOT EXISTS "dimension_rules_account_key"
    ON "dimension_rules" ("tenant_id", "legal_entity_id", "attribute_id", "account_id")
    NULLS NOT DISTINCT;


-- ── Default dimensions on master data ───────────────────────────────────────
-- **[OFFICIAL]** step 2 of D365's defaulting order fills blanks from the customer /
-- vendor / bank / fixed asset / project / ledger defaults.
--   learn.microsoft.com/dynamics365/finance/general-ledger/dimensions-default-values
--
-- Polymorphic on purpose: the alternative is four near-identical tables. Unlike
-- `dimension_values.source_id` this one is genuinely a lookup key rather than a
-- reference the resolver just read, so `entity_type` is CHECK-constrained.
CREATE TABLE IF NOT EXISTS "default_dimension_assignments" (
    "id"           UUID PRIMARY KEY,
    "tenant_id"    UUID NOT NULL,
    "entity_type"  TEXT NOT NULL,
    "entity_id"    UUID NOT NULL,
    "attribute_id" UUID NOT NULL REFERENCES "dimension_attributes"("id") ON DELETE CASCADE,
    "value_id"     UUID NOT NULL REFERENCES "dimension_values"("id") ON DELETE CASCADE,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "default_dimension_assignments"
    DROP CONSTRAINT IF EXISTS "default_dimension_assignments_entity_type_check";
ALTER TABLE "default_dimension_assignments"
    ADD CONSTRAINT "default_dimension_assignments_entity_type_check"
    CHECK ("entity_type" IN ('CUSTOMER', 'SUPPLIER', 'PRODUCT', 'EMPLOYEE'));

CREATE UNIQUE INDEX IF NOT EXISTS "default_dimension_assignments_key"
    ON "default_dimension_assignments" ("tenant_id", "entity_type", "entity_id", "attribute_id");


-- ── The four slots ──────────────────────────────────────────────────────────
-- Four is an allocation, not a ceiling: slot 5 is `ADD COLUMN … NULL`, which in
-- PostgreSQL 11+ rewrites nothing. **[OFFICIAL]** argues against pre-allocating
-- twenty: "the more dimensions that are created and used in a dimension set, the
-- slower transaction entry, import, and processes become."
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "dimension_1_id" UUID
    REFERENCES "dimension_values"("id");
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "dimension_2_id" UUID
    REFERENCES "dimension_values"("id");
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "dimension_3_id" UUID
    REFERENCES "dimension_values"("id");
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "dimension_4_id" UUID
    REFERENCES "dimension_values"("id");

-- One index per slot that gets grouped on. Slot 1 (store) is the P&L-by-store
-- query; slot 2 (department) is the stated next. 3 and 4 get theirs when an axis
-- actually occupies them — an index on an all-NULL column is pure write cost.
CREATE INDEX IF NOT EXISTS "journal_lines_dimension_1_idx"
    ON "journal_lines" ("dimension_1_id");
CREATE INDEX IF NOT EXISTS "journal_lines_dimension_2_idx"
    ON "journal_lines" ("dimension_2_id");

-- Nothing is seeded here. Provisioning is `scripts/provisionFinancialDimensions.ts`,
-- which reports what it would do before it does it — the same refusal-to-guess
-- pattern as provisionSalesDimensions.ts. Applying this migration alone changes no
-- behaviour: every dimension column is NULL and `postJournal` finds no attributes.
