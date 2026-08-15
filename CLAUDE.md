# CLAUDE.md — Skarpine / Quberty ERP

Project-specific instructions. Complements the global `~/.claude/CLAUDE.md`; does not replace it.
Read `HANDOVER.md` for current status before starting work.

---

## 1. What This Product Is

**Quberty ERP** (codebase name: Skarpine) is a working ERP + e-commerce + POS platform.
It was built for a three-store retail shoe business in Bolivia that was running on paper.
It is a real product build, not a prototype.

**Environment, corrected 2026-08-15:** the Supabase database in `backend/.env` is Kubi's **test
data environment**. Earlier docs called it production; that was wrong. Test data can be migrated and
reprovisioned freely. Where — or whether — a production instance runs is not recorded in this repo;
confirm before treating any figure as a filed accounting number.

It is now being repositioned from a one-client custom build into a **packaged, AI-augmented
ERP product**.

Stack: Node.js + Express + Prisma + PostgreSQL (`backend/`), Next.js 14 App Router
(`frontend/`), Expo/React Native POS (`skarpine-pos/`, a separate nested git repo — not a
submodule despite what older docs claim; commit from inside that directory).

---

## 2. Target Market — This Drives Every Scope Decision

**Not** enterprises running SAP or D365 F&O. We do not compete for that budget and we do not
try to match that feature surface.

Target: businesses up to roughly 50 employees. Too small for a €10–15k ERP, too big for
spreadsheets. Businesses that want to professionalise and cannot afford enterprise ERP.

The product must **feel simple to them, while being architecturally serious underneath.**

When a scope question arises, the tiebreaker is: *would a three-store shoe retailer in
Bolivia actually use this?* Not: *does D365 have it?*

---

## 3. The Core Tension — Read This Before Any Design Work

> We will **not** implement all of D365.
> We **will** adopt D365's data model anatomy.
> Feature scope is deliberately reduced. **Data model depth is not.**

**Every scope cut must be a behaviour cut, never a schema cut.**

Concretely: there is no demand forecasting, no master planning, no production today. That is
fine. But when those arrive in two years, we must not have to rewrite the schema, backfill
data, or run destructive migrations.

We are at step 3 heading to step 4. The foundation must already be drawn for step 10.

**Operational rule:** anything deferred must ship with a documented *schema hook* — the
specific nullable FK, enum value, discriminator column, or join table that has to exist today
so the deferred capability can attach later without a data migration. If a deferred item
genuinely needs no hook, say so explicitly rather than inventing one for symmetry.

**Honest counterweight:** maximum generality is not free. A fully generic EAV-style dimension
framework carries real query-performance and developer-ergonomics cost — D365's own financial
dimension implementation is notoriously painful to report against. For a product whose
*selling point* is that reporting is easy, copying that verbatim would be a mistake. Aim for
the foundation that survives growth, not the one with the most indirection.

---

## 4. Process-First, Not Module-First

Design in complete end-to-end business processes, not isolated features.

Processes do not start where the current code starts. A sales order does not appear from
nowhere — there is Lead → Opportunity → Quotation → Order in front of it. A purchase order
does not either — there is Requisition → RFQ → Purchase Order.

### Scope

| Process | Status |
|---|---|
| Source to Pay (P2P) | **In scope** |
| Order to Cash (O2C) | **In scope** |
| Order to Make / Plan to Produce | **Explicitly out of scope.** The anchor customer is a retailer, not a manufacturer. Do not design for it; do not let it distort the schema. Leave hooks only where they cost nothing. |

The shared core both in-scope processes write to — product dimensions, inventory, costing,
financial dimensions, posting profiles, document numbering, tax — is where the real
architectural risk lives. That core deserves more care than either process on its own.

---

## 5. Research Rules

- **Microsoft Learn MCP is the primary source** for anything D365. Do not answer from memory
  when a Learn page can verify it.
- Anchor on the official **Dynamics 365 business process catalog** (the end-to-end taxonomy:
  Source to pay, Order to cash, etc.). If it cannot be located via Learn MCP, say so and ask
  for the link — do not invent structure.
- Cite the Learn URL for each major claim.
- **Always label statements as one of:**
  - *official documentation* (with URL)
  - *repo-verified* (with file:line)
  - *architectural recommendation* (mine)
  - *assumption needing validation*

  Never blur these. If something cannot be verified, mark it **unverified** rather than
  filling the gap with plausible-sounding detail.
- For this workstream: **Learn MCP + repo only.** No other research tooling.

---

## 6. Bolivia Is a First-Class Constraint, Not a Localisation Afterthought

- **Factura numbering has legal sequentiality requirements.** Do not break it. Any change to
  document numbering must preserve this.
- IVA 13% (inclusive) and IT 3% are correct today and must keep working **exactly as they do
  now** through any generalisation. Bolivia stays the default.
- Generalising the tax engine means Bolivia becomes *a configured jurisdiction*, not that
  Bolivia becomes *one of several equals with regressions*.
- Note that IVA and IT behave differently: IVA is recoverable input/output VAT; IT is a
  turnover tax on sales only. A tax model derived from the purchase side alone will not
  represent IT.

---

## 7. Engineering Principles

Priority order: **quality → scalability → maintainability → speed.**

- Schema changes are the expensive, irreversible ones. Treat `prisma/schema.prisma` as the
  highest-stakes file in the repo.
- Configuration belongs in data, not in service code. GL accounts, tax rates, and pricing
  resolved by `if` statements are architectural debt.
- Multi-tenancy is **row-level (`tenant_id`), not schema-per-tenant**, whatever older docs
  say. Every tenant-scoped uniqueness constraint must include `tenant_id`. A bare `@unique`
  on a document number is a cross-tenant collision waiting to happen.
- Prefer extending existing architecture over replacing it. The D365-derived warehouse
  patterns (waves, work templates, location directives) and journal-based finance are
  deliberate and are the product's differentiator — do not "simplify" them away.

---

## 8. How to Behave on This Project

- **Challenge, don't comply.** If a premise is wrong, say so and argue it *before*
  proceeding — not silently, and not after the work is done.
- If a D365 approach is genuinely too heavy for an SME product, say that. The goal is not
  maximum D365 fidelity; it is a foundation that does not collapse under growth.
- **Flag anything that contradicts Kubi's stated understanding of the process or the
  codebase. That contradiction is the most valuable output.**
- Write at consultant level. Kubi is a D365 F&O Supply Chain consultant (~8 years); his
  co-founder is a Finance consultant. Do not over-explain D365 concepts.
- **Do not begin implementation on your own initiative.** Analysis and design tasks produce
  documents only — no migrations, no schema edits, no routes — until implementation is
  explicitly approved.

---

## 9. Working Language

Conversation, explanations, and analysis in **Turkish**. Code, identifiers, commit messages,
and repo documentation in **English**.
