# MVP → Product: Executive Briefing

**Date:** 2026-09-05
**Audience:** Founders
**Full detail:** [SAAS_READINESS_ASSESSMENT.md](./SAAS_READINESS_ASSESSMENT.md)

This is the condensed version. Every finding below was verified against this repository or
against the running server — none of it is inferred from memory.

---

## First, a correction to the framing

The question asked was "how do I make sure my data is safe." For a single-tenant custom build
that is the right question. For a multi-tenant product it is not, because the asset at risk is
**not our data — it is our customers' data, and the liability is ours.** One customer seeing
another customer's data is not an outage we apologise for. It is a contractual and regulatory
event that ends a young company.

Second, and more important: **security is not what is blocking us from charging money.** There
is no billing, no subscription lifecycle, and no plan enforcement anywhere in the codebase.
`Tenant.plan` and `Tenant.modules` exist in the schema, but no code reads them. As things
stand we could not charge differently for `starter` and `professional` even if we wanted to.

---

## The most urgent finding

The `/api/v1/tenants` router is mounted **outside** the authenticated `v1` group
(`backend/src/app.ts:159`). Confirmed live against the running server:

```
$ curl http://localhost:3001/api/v1/tenants/f33222a5-.../config
HTTP 200
{"name":"Skarpine Shoes","plan":"professional","modules":{...},"language":"tr"}
```

No token. No `X-Tenant-ID`. Just the UUID. Four routes sit on that unauthenticated mount
(`backend/src/modules/tenants/tenant.routes.ts`):

| Route | What an anonymous caller can do |
|---|---|
| `POST /tenants` | Create unlimited tenants |
| `GET /:id/config` | Read any tenant's plan and enabled modules |
| `PUT /:id/config` | **Change any tenant's modules and branding** |
| `PUT /:id/setup` | **Change any tenant's `currency_code` and `tax_config`** |

The last row is the critical one. `tax_config` feeds IVA/IT computation. An unauthenticated
party can therefore alter the tax configuration of a live company that issues legally
sequential facturas. This is not a data-leak class problem. It is a falsified-accounting-
records class problem.

Tenant UUIDs are not secret. The frontend sends one in the `X-Tenant-ID` header on every
request, so it is visible in any devtools session, any proxy log, and the POS bundle.

---

## The other P0 items

**Tenant isolation is 319 acts of developer discipline.**
`backend/src/infrastructure/database/client.ts` is a bare `new PrismaClient()` — no
`$extends`, no `$use`. I scanned the suspicious call sites and **most are false positives**:
the filter is present on a `where` object built a few lines earlier. The discipline has held.

That is not reassurance. It only shows the discipline has held with one developer, on one
tenant's data. A single forgotten `where` clause means cross-customer data disclosure, and
there is no test, no lint rule and no runtime guard that would catch it. One genuine instance
exists at `backend/src/modules/sales/sales.routes.ts:65`, which reads a product name with no
tenant filter.

The fix is **Postgres Row-Level Security**, which Supabase supports natively. It turns
isolation from something the code remembers into something the database enforces. This is the
highest-leverage change available to us.

**Rate limiting is currently switched off, and bypassable when on.** When Redis is
unreachable the `catch` block fails open, and Redis is not running. So there is no
brute-force protection at all right now — in a system whose seeded admin password is published
in `docs/SMOKE_TEST.md`. Even when Redis is up, the key is `x-forwarded-for`, which the caller
controls: a fresh value per request and the counter never accumulates.

**Tokens cannot be revoked and live for seven days.** `.env` sets `JWT_EXPIRES_IN=7d`,
overriding the 15-minute default the code itself intends, and there is no logout or revocation
route. Firing an employee, changing a role, or responding to a stolen laptop therefore has no
effect for up to a week. For a subscription product this also means suspending a non-paying
tenant is not actually possible.

**Login picks a tenant arbitrarily when an email exists in more than one.** The schema is
`@@unique([tenant_id, email])` — email is unique per tenant, not globally. When no tenant is
supplied, `auth.routes.ts:38` searches across all tenants and takes the first row returned. The
first time an accountant, a franchise owner, or one of us holds accounts in two customer
tenants, login becomes non-deterministic.

---

## Beyond security — the real bottleneck

**Migration strategy.** There is no `prisma/migrations/` directory. Instead there are 23
hand-numbered SQL files in `prisma/sql/` plus `db:push`. Nothing records which SQL has been
applied to which database. With one database this is merely uncomfortable. With N customer
databases it is unworkable — we would not know what state a given customer is in. This is the
highest-priority non-security engineering item.

**CI is not actually running.** `alm/pipelines/ci.yml` is written in GitHub Actions format,
but `.github/workflows/` does not exist. The 10 Jest suites and the Playwright specs run on
no push.

**The payment rail is the most underestimated item on the list.** Bolivia is the complication.
Stripe does not support Bolivian entities as sellers — I have not verified this and it should
be confirmed directly with Stripe. If our buyers are Bolivian SMEs paying in BOB, this is a
genuine research task rather than a library choice, and it must be answered before any design
work, because the answer may constrain the design.

---

## Obligations specific to selling an accounting system

These are the ones normally discovered too late.

- **Data export must be unconditional.** A customer's ledger is their legal record. Export has
  to work for a customer who has stopped paying, and while suspended.
- **Retention outlives the subscription.** We cannot delete a cancelled tenant's data on our
  own schedule. The statutory period should be confirmed with a Bolivian accountant — do not
  rely on a number I supply.
- **Suspension must not break factura sequentiality.** Cutting access mid-month and restoring
  later must not create gaps or reuse in the legal sequence. The numbering work landed
  recently (`023_factura_numbering_via_number_sequence.sql`); suspension should be tested
  against it explicitly.

---

## Recommended sequence

Not in parallel:

1. **Stop the bleeding** — tenant routes, rate limiting, gate Swagger. Days, not weeks.
2. **Make isolation structural** — RLS plus a Prisma extension, and fix login tenant
   resolution. This must be true before a second customer's data exists.
3. **Make identity real** — token lifecycle, password policy, MFA. This also unlocks
   suspension, which billing depends on.
4. **Make change safe** — migration strategy, then CI.
5. **Make money possible** — start with the Bolivian payment rail research.
6. **Make operations real** — production environment, a tested restore, error tracking.

**Do not build now:** SOC 2 / ISO 27001 (no SME buyer at this price point will ask),
SSO/SAML, field-level encryption, schema-per-tenant isolation (it contradicts the row-level
decision already recorded in CLAUDE.md §7).

---

## Honest summary

**The architecture is stronger than the security posture.** The D365-derived data model, the
single journal writer, the document chain and the tenant-per-row design are sound foundations
that will survive the transition to a product.

What is missing is the surrounding machinery that turns a working system into one we can sell
to strangers: an authenticated control plane, isolation the database enforces rather than the
developer remembers, a token lifecycle that permits suspension, a migration strategy that
survives more than one database, and any billing at all.
