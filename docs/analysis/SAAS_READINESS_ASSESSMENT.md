# MVP → Subscription SaaS: Readiness Assessment

**Date:** 2026-09-05
**Scope:** What must be true before Quberty ERP can be sold to third parties on a monthly
subscription. Assessment only — no code was changed to produce this document.

**Evidence labels used throughout:**
`[VERIFIED]` observed in this repo or against the running server (file:line or HTTP response)
`[RECOMMENDATION]` my architectural judgement
`[ASSUMPTION]` needs your confirmation — not verified

---

## 0. The framing correction

The request was "make sure my data is safe." For a single-tenant custom build that is the
right question. For a multi-tenant subscription product it is the wrong one, in three ways:

1. **The asset at risk is not your data — it is your customers' data, and the liability is
   yours.** A leak between tenant A and tenant B is not an outage you apologise for; it is a
   contractual and regulatory event that ends a young company.
2. **Security is not the binding constraint on charging money.** The binding constraint is
   that there is no billing, no subscription lifecycle, and no plan enforcement anywhere in
   the codebase. `Tenant.plan` and `Tenant.modules` exist in the schema but **nothing reads
   them** `[VERIFIED — grep across backend/src returns zero enforcement sites]`. Today you
   could not charge differently for `starter` vs `professional` even if you wanted to.
3. **An accounting system carries obligations a normal SaaS does not.** See §5.

So this document covers security, but does not stop there.

---

## 1. P0 — Blocking. Do not onboard a second paying tenant until these are closed.

### 1.1 The `/api/v1/tenants` router has no authentication at all

`[VERIFIED — backend/src/app.ts:159 mounts tenantRoutes outside the authenticated v1 group;
confirmed live against the running server]`

```
$ curl http://localhost:3001/api/v1/tenants/<tenant-uuid>/config
HTTP 200
{"id":"f33222a5-…","name":"Skarpine Shoes","plan":"professional","modules":{…},"language":"tr"}
```

No token. No `X-Tenant-ID`. Just the UUID. Four routes sit on this unauthenticated mount
(`backend/src/modules/tenants/tenant.routes.ts`):

| Route | What an anonymous caller can do |
|---|---|
| `POST /api/v1/tenants` | Create tenants freely — unbounded database growth, no gate |
| `GET /:id/config` | Read any tenant's name, plan, enabled modules, branding |
| `PUT /:id/config` | **Rewrite any tenant's enabled modules and branding** |
| `PUT /:id/setup` | **Rewrite any tenant's `currency_code` and `tax_config`** |

The last row is the serious one. `tax_config` feeds IVA/IT computation. An unauthenticated
party who learns a tenant UUID can alter the tax configuration of a live company that issues
legally-sequential facturas. That is not a data-leak class problem; it is a
falsified-accounting-records class problem.

Tenant UUIDs are not secret — the frontend sends one in `X-Tenant-ID` on every request, so it
is visible in any browser devtools session, any proxy log, and the POS app bundle.

**Fix direction `[RECOMMENDATION]`:** split this router. Tenant *creation* belongs to a
platform-admin surface authenticated separately from tenant users (it is your control plane,
not theirs). Tenant *config read/write* belongs inside the `v1` authenticated group, scoped to
the caller's own tenant, gated behind an admin role.

### 1.2 Tenant isolation is 319 acts of developer discipline, with no backstop

`[VERIFIED — backend/src/infrastructure/database/client.ts is a bare new PrismaClient();
no $extends, no $use, no query middleware. 319 tenant-scoped query call sites across
backend/src/modules.]`

Isolation today depends entirely on each developer remembering `tenant_id` in each `where`
clause. I sampled the call sites that appear to omit it; **most are false positives** — the
filter is present on a `where` object built a few lines earlier (e.g. `crm.routes.ts:72`,
`sales.routes.ts:56`). The pattern is currently being followed.

That is not reassurance. It is an observation that the discipline has held **so far, with one
developer, on one tenant's data**. The failure mode is a single forgotten clause in a future
PR, and the blast radius is cross-customer data disclosure. There is no test, no lint rule,
and no runtime guard that would catch it.

One real instance found: `sales.routes.ts:65`

```ts
const product = await db.product.findFirst({ where: { id: line.product_id }, select: { name: true } });
```

No `tenant_id`. Reachable on the storefront out-of-stock path, and it returns a product name
into an error message. Low impact on its own — it is exactly the shape of the bug that
matters at scale.

**Fix direction `[RECOMMENDATION]`, two layers:**

- **Postgres Row-Level Security** on every `tenant_id` table, with the tenant set per
  transaction. Supabase supports this natively. This makes isolation a property the database
  enforces, not a property the code remembers. It is the single highest-leverage change in
  this document.
- A **Prisma client extension** that injects `tenant_id` from request context, so the
  application layer stops depending on memory too.

Note the interaction with your connection pooler: RLS via `SET LOCAL` requires transaction
scoping, and you are on the Supabase pooler. `[ASSUMPTION — needs a spike before committing
to the approach]`

### 1.3 Rate limiting is currently switched off, and bypassable when on

`[VERIFIED — backend/src/app.ts:88-118]`

Three separate problems:

- **It fails open.** `catch { /* fail open */ }` — when Redis is unreachable, every request
  passes. Redis is unreachable right now: the server logs `Redis unavailable — rate limiting
  disabled`. So login brute-force protection is presently **absent, in a system where the
  seeded admin password is published in `docs/SMOKE_TEST.md`**.
- **The key is client-controlled.** `rl:${c.req.header('x-forwarded-for') ?? 'local'}` — an
  attacker sets a fresh `X-Forwarded-For` per request and the counter never accumulates. XFF
  is only trustworthy when it comes from a proxy you control and you read a fixed position in
  the chain.
- **Coverage is two routes.** Only `/auth/login` and `/auth/register`. Nothing protects
  report endpoints, the import module, or the PDF generators — the expensive ones.

### 1.4 Tokens cannot be revoked, and live for 7 days

`[VERIFIED — backend/.env sets JWT_EXPIRES_IN=7d, overriding the 15m default in
config/env.ts:11. No logout or revocation route exists in auth.routes.ts.]`

There is a `RefreshToken` model in the schema, but the access token is a bare stateless JWT
with a 7-day life and no denylist. Consequences: firing an employee, changing a role, or
responding to a stolen laptop has **no effect for up to seven days**. For a subscription
product this also means suspending a non-paying tenant does not actually suspend them.

**Fix direction `[RECOMMENDATION]`:** short access token (15m — the default the code already
intends), refresh rotation against the existing `RefreshToken` table, and a revocation check.
Suspension then becomes a real capability rather than a billing-page checkbox.

### 1.5 Login picks a tenant arbitrarily when the email exists in more than one

`[VERIFIED — auth.routes.ts:38; schema.prisma User has @@unique([tenant_id, email]),
i.e. email is unique per tenant, NOT globally.]`

```ts
const user = await db.user.findFirst({ where: { email, is_active: true } });
```

When the client sends neither `tenant_id` nor `tenant_slug`, this searches **all tenants** and
takes whichever row comes back first. The schema explicitly permits the same email in two
tenants. So the first time an accountant, a franchise owner, or you yourself hold accounts in
two customer tenants, login becomes non-deterministic — and the account it lands in is decided
by database ordering.

This is currently invisible because there is one real tenant. It becomes a support nightmare,
and arguably a disclosure incident, on the day there are twenty.

---

## 2. P1 — Required before general availability

| # | Item | Status |
|---|---|---|
| 2.1 | **Password policy, lockout, and reset flow.** No complexity rule, no lockout, no self-service reset. bcrypt cost 12 is correct `[VERIFIED seed.ts:36]` | Missing |
| 2.2 | **MFA for admin roles.** An ERP admin can alter tax config and post journals | Missing |
| 2.3 | **Swagger UI is public.** `/api/docs` unauthenticated `[VERIFIED app.ts:154]` — hands an attacker the full API surface. Gate it in production | Open |
| 2.4 | **Dependency vulnerabilities.** `npm audit`: 2 high, 1 moderate. `hono` has fixes available; `xlsx` has **no fix available** (prototype pollution + ReDoS) and is used by the import module — that one needs a decision, not an upgrade | Open |
| 2.5 | **No CI is actually running.** `alm/pipelines/ci.yml` is written in GitHub Actions format but `.github/workflows/` does not exist `[VERIFIED]`. Nothing runs the 10 Jest suites or the Playwright specs on push | Open |
| 2.6 | **Audit log covers HTTP writes, not domain events.** Good that it exists `[VERIFIED app.ts:165]`. For an accounting system you also want immutable, append-only records of postings and config changes | Partial |
| 2.7 | **Secrets management.** `.env` is correctly gitignored and was never committed `[VERIFIED — git log across all refs is empty for it]`. But the live Supabase service key and JWT secrets sit in a developer-machine plaintext file. Move to a managed secret store before anyone else joins | Open |
| 2.8 | **Tenant enumeration oracle.** `tenantMiddleware` returns 404 for unknown vs 400 for missing `[VERIFIED tenantMiddleware.ts:14,24]` — minor, but free to fix | Open |
| 2.9 | **No error tracking / APM.** Pino logs to stdout with request IDs, which is a good foundation, but nothing aggregates or alerts | Missing |
| 2.10 | **Backup and restore has never been rehearsed.** `[ASSUMPTION — not verifiable from the repo]` A backup you have not restored is not a backup. For an accounting system, define RPO/RTO and test a real restore | Unknown |

---

## 3. Commercial machinery — the actual blocker on "monthly payments"

None of this exists today `[VERIFIED — zero matches for billing/subscription/stripe in
backend/src]`.

1. **Subscription lifecycle:** trial → active → past-due → suspended → cancelled → deleted.
   Each state needs a defined system behaviour. "Past due" for an ERP cannot mean "delete" —
   see §5.
2. **Plan enforcement.** `Tenant.plan` and `Tenant.modules` are the schema hooks and they are
   already in place — this is a behaviour gap, not a schema gap. Decide what a plan actually
   limits: modules, users, documents/month, stores?
3. **Payment provider.** Bolivia is the complication. Stripe does not support Bolivian
   entities as sellers `[ASSUMPTION — verify current status directly with Stripe]`. If your
   buyers are Bolivian SMEs paying in BOB, the payment rail is a real research task, not a
   library choice. This may be the single most underestimated item on this list.
4. **Self-service tenant provisioning.** `provisionConfiguration.ts` exists, so the seed path
   is partly there. Signup → tenant + chart of accounts + number sequences + tax config →
   first login must become one reliable transaction.
5. **Metering** if you ever price on usage.
6. **Your own invoicing.** You will be issuing facturas for the subscription itself.

---

## 4. Operational readiness

- **Environments.** One Supabase instance, used as test `[VERIFIED CLAUDE.md §1]`. Selling to
  third parties requires at minimum a separate production instance with no developer laptop
  holding its credentials.
- **Migrations.** No `prisma/migrations/` directory; 23 hand-numbered SQL files in
  `prisma/sql/` and `db:push` in package.json `[VERIFIED]`. There is no record of which SQL
  has been applied to which database. With one database this is merely uncomfortable. With
  N customer databases it is unworkable — you will not know what state a customer is in.
  **This is the highest-priority non-security engineering item.**
- **Deployment.** `alm/pipelines/deploy-prod.yml` exists but no active pipeline.
- **Support.** No status page, no incident process, no defined support hours. A monthly
  subscription is a promise of availability.
- **Onboarding cost.** ERP data migration (products, customers, opening balances) is the
  hidden per-customer cost that kills SME ERP margins. The `import` module is the right hook —
  it needs to become genuinely self-service, or you must price onboarding separately.

---

## 5. Obligations specific to selling an *accounting* system in Bolivia

These are the ones normally discovered too late.

1. **Data export must be unconditional.** A customer's ledger is their legal record. Export
   must work even for a customer who has stopped paying and even while suspended. Build it
   before you need it.
2. **Retention outlives the subscription.** Bolivian commercial and tax record retention
   obligations mean you cannot delete a cancelled tenant's data on your own schedule. Decide
   the retention period, write it into the contract, and enforce it in code.
   `[ASSUMPTION — confirm the statutory period with your co-founder or a Bolivian accountant.
   Do not take my word for the number.]`
3. **Suspension must not break factura sequentiality.** Cutting access mid-month and restoring
   later must not create gaps or reuse in the legal sequence. The numbering work already
   landed (`023_factura_numbering_via_number_sequence.sql`) — test suspension against it
   explicitly.
4. **Sub-processor disclosure.** You will be telling customers their accounting data lives on
   Supabase in `eu-west-1`. Bolivian data hosted in Ireland is a question a serious buyer will
   ask. Have the answer ready. `[ASSUMPTION — no Bolivian data-residency requirement verified;
   this needs legal input, not engineering input.]`
5. **Contractual liability cap.** If a bug misstates a customer's tax position, who pays the
   fine? Answer this in the contract before the first signature.

---

## 6. Recommended sequence

**Do not do these in parallel.** Ordered by (risk eliminated) ÷ (effort).

| Stage | Items | Rationale |
|---|---|---|
| **1. Stop the bleeding** | 1.1 tenant routes, 1.3 rate limiting, 2.3 swagger gating | Days, not weeks. 1.1 is an unauthenticated write path to tax configuration |
| **2. Make isolation structural** | 1.2 RLS + Prisma extension, 1.5 login tenant resolution | The thing that must be true before a second customer's data exists |
| **3. Make identity real** | 1.4 token lifecycle, 2.1 password policy, 2.2 MFA | Also unlocks suspension, which billing depends on |
| **4. Make change safe** | Migration strategy, then CI (2.5) | Everything after this is faster and safer |
| **5. Make money possible** | §3, starting with the Bolivian payment rail research | Research-first: the answer may constrain the design |
| **6. Make operations real** | Prod environment, backups tested, error tracking | |

**Deliberately excluded** — do not build these now: SOC 2 / ISO 27001 (no SME buyer at this
price point will ask; revisit when an enterprise deal is on the table), SSO/SAML, field-level
encryption, a public API programme, schema-per-tenant isolation (contradicts the row-level
decision in CLAUDE.md §7 and is not warranted at this scale).

---

## 7. The honest summary

The architecture is stronger than the security posture. The D365-derived data model, the
single journal writer, the document chain, and the tenant-per-row design are all sound
foundations that will survive the transition to a product.

What is missing is the surrounding machinery that turns a working system into a system you can
sell to strangers: an authenticated control plane, isolation the database enforces rather than
the developer remembers, a token lifecycle that permits suspension, a migration strategy that
survives more than one database, and any billing at all.

The single most urgent item is §1.1 — an unauthenticated write path to tenant tax
configuration. It exists in the code right now, and I confirmed it responds on the running
server.
