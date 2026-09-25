# WORK-030 — O2C, inventory and finance permission registry and route conversion

- **Status:** DESIGNED, AWAITING KUBI DECISIONS. Nothing is approved for implementation.
- **Design:** Claude solution-architect agent (Opus), 2026-09-13, read-only (no edits, no git changes, no database access).
- **Basis:** branch `codex/rebuild-2026-09-07`, HEAD `cc365eb`, clean tree.
- **Accounts for WORK-025b:** `GET /tenant/currency` is authentication-only; `setup.tenant.read` was removed from cashier and employee.
  - *Note added by the main session:* the WORK-025b review follow-up `f9b30e0` turned the `TENANT_CURRENCY_ROUTE_IS_UNPERMISSIONED` export into a comment. §5.1 item 3 and §16.2 should record explicitly unpermissioned routes as an exported list (only `GET /tenant/currency`) rather than relying on that constant.
- **Mirrors:** WORK-016 (purchase registry), WORK-022 (`TENANT_ROUTE_PERMISSIONS`), WORK-024a (`CURRENCY_ROUTE_PERMISSIONS`).

---

## 0. Headline findings (read first)

1. **[REPO-VERIFIED] The queue entry understates the exposure.**
   - **80 of the 187 routes** in scope have no guard. Any authenticated identity can call them, including a `customer`.
   - A customer identity can be created by **anyone on the internet**: `POST /auth/register` is public (`auth.routes.ts:79`), attaches a tenant-less registrant to "the first active tenant" (`auth.routes.ts:86`) and signs a token (`:117`).
   - An anonymous visitor can therefore register and then:
     - read the whole general ledger: `GET /finance/journal-entries` (`finance.routes.ts:185`), `/trial-balance` (`:483`), `/profit-loss` (`:645`), `/balance-sheet` (`:690`);
     - read every factura, including customer NIT data (`:293`);
     - read and change CRM leads and opportunities (`crm.routes.ts:71–274`);
     - mark warehouse work COMPLETED without executing any line (`warehouse.routes.ts:379`);
     - create units of measure (`uom.routes.ts:19`, `:55`);
     - upload or delete product images (`product.routes.ts:578`, `:626`);
     - start paid FAL.ai video jobs (`product.routes.ts:651`).
   - This fails the P0-Security exit gate "customer/storefront identities cannot access ERP entry points" (`docs/analysis/SECURITY_AUTHORIZATION_GAP_ANALYSIS.md:233`).
2. **[REPO-VERIFIED] The first registrant in a tenant with zero users becomes `admin`** (`auth.routes.ts:96-97`), and `POST /auth/make-admin` (`:198`) lets a tenant's only user promote themselves.
   - Both contradict the 2026-09-11 decision that tenants and admins are created only by the operator.
   - `createTenant.ts` creates the admin in the same transaction, so a zero-user tenant should not arise, but the code path is live.
3. **[REPO-VERIFIED] Premise correction: the store manager cannot post manual journals.**
   - `POST /journal-entries` (`finance.routes.ts:205`) lets admin and store manager create a **DRAFT** only (`:223`).
   - `POST /journal-entries/:id/post` (`:249`) is admin-only, so create-versus-post segregation already exists.
   - **The real defect:** the post route flips DRAFT to POSTED **without re-checking the closed period**. `assertPeriodPostable` runs only at draft creation (`journal.service.ts:482`), so a draft created before a period close can later be posted into the closed period.
4. **[REPO-VERIFIED] The legacy colon codes are not the enforced policy.**
   - `ROLE_PERMISSIONS` gives cashier `reports:read` and `sales:create` (`permissions.ts:113-123`).
   - Yet every `/reports/*` route is `requireRole('admin','store_manager')` (`report.routes.ts:18-78`), and `POST /sales/orders` has no guard at all (`sales.routes.ts:39`).
   - **"Behaviour-preserving" therefore means preserving what the route guards enforce today, not what the legacy map says.**
5. **[REPO-VERIFIED] No client consumes permission codes.**
   - The JWT carries only `role` (`auth.routes.ts:49-50`), and `/auth/me` returns only the role (`:162-167`).
   - `frontend/src` contains no permission strings, and the navigation does not filter by role (`components/erp/Sidebar.tsx`).
   - Renaming codes is server-internal. The only thing a client can observe is which requests now return 403.
6. **[REPO-VERIFIED] Two defects on the customer surface go beyond authorization.**
   - **Client-supplied storefront prices:** `lines[].unit_price` is passed through (`sales.routes.ts:95` → `sales.service.ts:63,111`). A shopper can set any price, and the order is confirmed with stock deducted (`sales.routes.ts:149-152`).
   - **Cost and unpublished products exposed:** `GET /products` returns `cost_price` and unpublished products to any caller (`product.routes.ts:12-77`); `published` is only a client-supplied filter (`:17`).
7. **[REPO-VERIFIED] Tenant-isolation residuals on inventory writes.**
   - `POST /inventory/adjust` upserts stock with unvalidated `product_id` and `location_id` (`inventory.routes.ts:84-110`).
   - `transferStock` writes `to_location_id` without validating it (`inventory.service.ts:366-373`).
   - `assertTenantReferences` does not check locations at all (`tenantReference.service.ts:7-10`).

---

## 1. Catalog IDs

| Level | ID | Name | Evidence |
|---|---|---|---|
| L3 | 99.25.050.000 | Manage data security | Workbook-listed (`CORE_ERP_COMPLETION_MATRIX.md:70`) |
| L3 | 99.25.060.000 | Configure segregation of duties | Workbook-listed (`:71`) |
| L3 | 99.25.070.000 | Authentication (the `/auth/register` part) | Matrix row, `:290` |
| L3 | 99.25.110.000 | Role assignment (HR role routes, 030c) | Matrix row, `:292` |
| L2 | 65.20, 65.30, 60.20, 60.30/60.40, 90.50, 90.60 | Sales orders; AR; inventory levels; inbound/outbound; financial transactions; period close | `CORE_ERP_PROCESS_CATALOG.md:117-138` |
| L2 | Prospect to quote (CRM, quotations) | UNVERIFIED-85 | Not in the core area list |

L4 scenarios, system processes and test cases stay UNVERIFIED until the JUL-2026 workbook rows are mapped.

---

## 2. Official process (Microsoft Learn)

| # | Claim | Source |
|---|---|---|
| O-1 | Access is granted to roles; a user with no role has no privileges. Duties group privileges, and privileges group permissions on entry points. | [Role-based security](https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/sysadmin/role-based-security) |
| O-2 | Related duties can be assigned to separate roles ("segregated") to reduce fraud risk and detect errors. | same page, *Duties* |
| O-3 | Segregation-of-duties rules pair duties with a severity and a mitigation. Conflicting role assignments are logged, then allowed with a reason or denied. Example: the same person should not both receive goods and process vendor payment. | [Set up SoD](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/sysadmin/set-up-segregation-duties), [Resolve SoD conflicts](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/sysadmin/identify-resolve-conflicts-segregation-duties) |
| O-4 | Small legal entities cannot always enforce declarative SoD with few staff. Microsoft's guidance: modular roles, several roles per user, and **documented overrides**. | [Implementation guide — security from day one](https://learn.microsoft.com/dynamics365/guidance/implementation-guide/security-strategy-day-one-priority#how-security-affects-rollout) |
| O-5 | Journal entry and journal posting are separable controls: workflow approval per journal name, and posting restrictions by user group. | [General journal processing](https://learn.microsoft.com/dynamics365/finance/general-ledger/general-journal-processing), [Advanced rules for journals](https://learn.microsoft.com/dynamics365/finance/general-ledger/tasks/create-advanced-rules-journals) |
| O-6 | Store operations are POS permission groups, assigned through jobs and positions, separate from headquarters roles. | [Create POS permission groups](https://learn.microsoft.com/dynamics365/commerce/tasks/create-pos-permission-groups) |
| O-7 | E-commerce customers sign in through a **separate** B2C identity tenant per channel, linked to a customer record; the customer API surface is distinct from back office. | [Multiple B2C tenants](https://learn.microsoft.com/dynamics365/commerce/configure-multi-b2c-tenants), [Identity record linking](https://learn.microsoft.com/dynamics365/commerce/dev-itpro/identity-record-linking), [Commerce auth flows](https://learn.microsoft.com/dynamics365/commerce/dev-itpro/arch-auth-flow) |
| O-8 | Business Central (the SME analogue) uses small permission sets (read, edit, post); effective access is their union. | [BC access controls](https://learn.microsoft.com/azure/azure-sovereign-clouds/public/access-controls-d365-business-central#role-based-access-control-rbac), [Assign permissions](https://learn.microsoft.com/dynamics365/business-central/ui-define-granular-permissions) |

**[REC]** Learn defines no SME retail role templates. The role contents in §5.4 are architectural recommendations, not Microsoft defaults.

---

## 3. Repo-verified current state

### 3.1 Mechanics

- **Middleware order:** `v1.use('*', tenantMiddleware)`, then `authMiddleware, auditLog` (`app.ts:165-168`). No authorization runs at router level.
- **Guards:**
  - `requireRole(...roles)` is an exact string match (`authMiddleware.ts:52-60`).
  - `requirePermission(...)` requires all listed permissions, with an `admin:all` override (`permissions.ts:174-188`).
  - There is no any-of guard.
- **Manifests to mirror:**
  - `PURCHASE_ROUTE_PERMISSIONS` plus a local `guard()` (`purchase.routes.ts:26-64`), pinned by `purchaseRoutePermissions.test.ts`;
  - `TENANT_ROUTE_PERMISSIONS` (`tenant.routes.ts`);
  - `CURRENCY_ROUTE_PERMISSIONS` (`currency.routes.ts:42-61`).
- **Clients:**
  - ERP web: `frontend/src/app/(erp)/**`;
  - web POS: `app/pos/**`, `components/pos/**`, `stores/posCartStore.ts`;
  - storefront: `app/(store)/**`, `stores/cartStore.ts`;
  - Expo POS, read from the preservation snapshot `skarpine/skarpine-pos/src/api/*`. **Assumption:** the snapshot matches the POS remote HEAD. The Expo POS calls only `/auth/login`, `GET/POST /customers`, `GET /products`, `/products/:id`, `/products/barcode/:code`, `/products/categories` and `/pos/*`.

**Legend.** Guard codes: `—` = no guard; `R(a,sm)` = `requireRole('admin','store_manager')`; `R(a)` = admin only; `L(x)` = legacy colon permission; `P(x)` = dotted permission. Callers are file:line under `frontend/src/app` unless noted; `n/f` means no frontend caller was found.

### 3.2 Route inventory

**`sales/sales.routes.ts`** (mounted at `/sales/orders`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET / | 34 | — | (erp)/sales/orders/page.tsx:806 |
| POST / | 39 | — | sales/orders/page.tsx:817; components/erp/sales/CreateOrderModal.tsx:45 |
| POST /storefront | 44 | — (the comment at :92 wrongly calls it unauthenticated) | stores/cartStore.ts:94 (customer) |
| GET /:id | 156 | — | sales/orders/[id]/page.tsx:44 |
| POST /:id/invoice | 179 | R(a,sm) | [id]:52; page:178 (draws a FACTURA number) |
| POST /:id/pay | 393 | R(a,sm) | page:728 |
| PUT /:id | 454 | R(a,sm) | page:823 |
| POST /:id/confirm | 511 | R(a,sm) | [id]:71; page:833 |
| POST /:id/ship | 516 | R(a,sm) | [id]:76; page:839 |
| POST /:id/complete | 524 | R(a,sm) | [id]:81; page:845 |
| POST /:id/cancel | 541 | R(a) | [id]:86; page:851 |
| POST /:id/return | 547 | R(a,sm) | [id]:134; page:88 (credit note from the FACTURA series) |

**`sales/quotation.routes.ts`** (`/sales/quotations`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET / | 22 | — | sales/quotations/page.tsx:27 |
| POST / | 54 | — | crm/opportunities/[id]:102; crm/leads/[id]:62 |
| GET /:id | 59 | — | quotations/[id]:34 |
| PUT /:id/lines | 81 | R(a,sm) | [id]:187 |
| POST /:id/send | 92 | R(a,sm) | [id]:44 |
| POST /:id/revise | 96 | R(a,sm) | [id]:46 |
| POST /:id/confirm | 101 | R(a,sm) | [id]:51 (creates a sales order) |
| POST /:id/lose | 106 | R(a,sm) | [id]:56 |
| POST /:id/cancel | 111 | R(a,sm) | [id]:61 |

**`crm/crm.routes.ts`** (`/crm`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET /stages | 31 | — | crm/opportunities/[id]:27 |
| POST /stages; PUT /stages/:id | 39; 54 | R(a) | n/f |
| GET /leads; GET /leads/:id | 71; 107 | — | crm/leads/page.tsx:37; leads/[id]:25 |
| POST /leads | 102 | — | leads/page:218 |
| PUT /leads/:id | 143 | — | leads/[id]:57 |
| POST /leads/:id/qualify | 161 | — | leads/page:49 (can create a customer, `crm.service.ts:210`, and an opportunity, `:239`) |
| POST /leads/:id/disqualify; /reopen | 171; 177 | — | leads/page:55; :60 |
| POST /leads/:id/convert-to-customer | 183 | — | leads/[id]:119 (creates a customer, `crm.service.ts:119`) |
| GET /opportunities; /pipeline; /:id | 190; 216; 225 | — | opportunities/page:32; :26; [id]:23 |
| POST /opportunities; PUT /:id; POST /:id/stage | 220; 242; 262 | — | opportunities/page:114; [id]:38; :96 |
| POST /opportunities/:id/close | 274 | — | [id]:44 |

**`customers/customer.routes.ts`** (`/customers`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET / | 17 | L(customers:read) | sales/customers:20; sales/orders:310; components/pos/CustomerSearch.tsx:13; Expo customers.ts:4 |
| POST / | 37 | L(customers:create) | CustomerSearch:19; Expo customers.ts:16 |
| GET /segments | 54 | R(a,sm) | n/f |
| GET /:id | 64 | L(customers:read) | n/f |
| PUT /:id | 69 | L(customers:update) | n/f |
| GET /:id/orders | 80 | L(customers:read) | n/f |

**`pos/pos.routes.ts`** (`/pos`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| POST /sessions/open | 33 | L(pos:session) | pos/open-register:52; Expo pos.ts:6 |
| GET /sessions/current | 61 | L(pos:session) | pos/page:19; pos/login:29; Expo pos.ts:11 |
| GET /sessions | 74 | L(pos:session) | n/f |
| POST /sessions/:id/close | 84 | L(pos:session) | pos/z-report:28; Expo pos.ts:16 |
| POST /sale | 127 | L(pos:sale) | pos/main:89; Expo pos.ts:40 |
| POST /sales/:orderId/void | 408 | L(pos:void) | pos/receipt:30; Expo pos.ts:48 |

**`inventory/inventory.routes.ts`** (`/inventory`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET /stock | 13 | — | inventory/stock:44 |
| GET /transactions | 34 | — | inventory/transactions:46; TransactionsModal:29 |
| GET /low-stock | 41 | — | inventory/low-stock:11 |
| POST /transfers | 76 | R(a,sm) | inventory/transfers:16 |
| POST /adjust | 83 | R(a,sm) | inventory/stock:48 |

**`inventory/inventory-count.routes.ts`** (`/inventory-counts`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET /; GET /:id | 15; 25 | — | inventory/counting:17; counting/[id]:42 |
| POST / | 43 | R(a,sm) | counting:21 |
| PUT /:id/lines/:lineId | 82 | L(inventory:count) | counting/[id]:62 |
| POST /:id/finalize | 103 | R(a,sm) | counting/[id]:73 |

**`warehouse/warehouse.routes.ts`** (`/warehouse`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET /sites | 16 | — | warehouse/locations:48; setup/organisation:32 |
| POST /sites | 21 | R(a) | setup/organisation:190 (site country drives the chart of accounts) |
| GET /warehouses | 46 | — | **pos/open-register:35 (cashier)**; sales/orders:314; requisitions:131; purchase/orders:376; setup/organisation:36 |
| GET /overview | 81 | — | warehouse/locations:43 |
| POST /warehouses | 133 | R(a,sm) | locations:86; organisation:239 |
| GET /zones; GET /locations | 194; 217 | — | locations:53, :59; inventory/transfers:13; purchase/orders:145; purchase/returns:41 |
| POST /zones; /locations; /locations/bulk | 206; 231; 267 | R(a,sm) | locations:97, :103, :110 |
| GET /work | 335 | — | warehouse/work:23 |
| POST /work/:id/start; /lines/:lineId/complete; /complete | 359; 367; 379 | — | work:28, :33 (`/complete` sets COMPLETED without executing lines, `:380-383`) |
| GET /waves | 389 | — | warehouse/waves:15 |
| POST /waves/:id/release | 398 | R(a,sm) | waves:19 |
| GET /arrival-journals | 405 | — | warehouse/arrival:23 |
| POST /arrival-journals; /:id/post | 414; 428 | R(a,sm) | n/f |
| POST /setup | 437 | R(a,sm) | setup/wizard:172 |
| GET /location-directives; POST /location-directives | 492; 501 | R(a) | setup/warehouse:208 |
| GET /parameters; PUT /parameters/:warehouseId | 518; 572 | R(a,sm) | setup/warehouse:31, :41 |
| POST /location-directives/:id/lines; DELETE /location-directives/:id | 635; 663 | R(a,sm) | setup/warehouse:215, :220 |

**`inventory/uom.routes.ts`** (`/uom`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET / | 10 | — | products/uom:13; ProductForm:90 |
| POST /; PUT /:id | 19; 40 | — | products/uom:27 |
| POST /seed-defaults | 55 | — | products/uom:17; setup/wizard:167 |

**`inventory/variant-types.routes.ts`** (`/variant-types`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET / | 10 | — | products/variants:22; ProductForm:79 |
| POST; PUT /:id; DELETE /:id | 15; 22; 31 | R(a,sm) | products/variants:67, :66, :73 |

**`inventory/product.routes.ts`** (`/products`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET / | 12 | — | **(store)/shop:19 (customer)**; pos/main:17; Expo products.ts:4; products:39; sales/orders:318; purchase/orders:380; requisitions:135 |
| GET /barcode/:code | 80 | — | pos/main:24; Expo products.ts:16 |
| GET /categories | 128 | — | **(store)/shop:25**; ProductForm:84; products/categories:16; Expo products.ts:21 |
| POST /categories | 136 | R(a,sm) | products/categories:20 |
| GET /:id | 145 | — | **(store)/shop/[id]:29**; products/[id]:14; ProductForm:150; Expo products.ts:11 |
| POST / | 177 | R(a,sm) | ProductForm:328 |
| PUT /:id | 210 | R(a,sm) | ProductForm:326; products:46; products/setup:62 |
| GET /setup/item-groups; /setup/item-model-groups; /setup/coverage | 310; 319; 461 | — | products/setup:41, :45, :37 |
| POST /setup/item-groups; POST /setup/item-model-groups; PUT /setup/item-model-groups/:id; PUT /setup/item-groups/:id | 328; 372; 387; 443 | R(a) | ItemModelGroupDialog:133-134 |
| DELETE /:id | 481 | R(a) | n/f |
| POST /bulk | 491 | R(a,sm) | products:52 |
| POST /:id/variants; PUT /:id/variants/:variantId; DELETE /:id/variants/:variantId | 517; 553; 568 | R(a,sm) | ProductForm:338, :346, :336 |
| POST /:id/image; DELETE /:id/image | 578; 626 | — | ProductForm:60, :256 |
| POST /:id/generate-video; GET /:id/video-jobs/:requestId | 651; 692 | — | ProductForm:165, :144 (paid external API) |
| DELETE /:id/video | 739 | — | ProductForm:183 |
| GET /:id/stock | 757 | — | n/f |

**`import/import.routes.ts`** (`/import`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| POST /upload; /jobs/:id/mapping; /jobs/:id/validate | 12; 30; 36 | R(a,sm) | (erp)/import:44, :54, :59 |
| POST /jobs/:id/execute | 41 | R(a) | import:67 |
| GET /jobs; /jobs/:id | 46; 55 | R(a,sm) | import:36 |

**`finance/finance.routes.ts`** (`/finance`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET /accounts | 23 | — | finance/accounts:29; finance/journal:25; **purchase/setup/payment-methods:26 (buyer)** |
| POST /accounts; PUT /accounts/:id | 31; 45 | R(a) | finance/accounts:37, :36 |
| POST /accounts/seed-default | 72 | R(a) | finance/accounts:43 |
| GET /coa-templates | 102 | — | finance/coa-templates:14 |
| POST /seed-coa | 108 | P(finance.setup.maintain) | coa-templates:21; setup/wizard:163 |
| GET /journal-entries | 185 | — | finance/journal:30 |
| POST /journal-entries | 205 | R(a,sm), DRAFT only | finance/journal:45 |
| POST /journal-entries/:id/post | 249 | R(a); no closed-period re-check | finance/journal:59 |
| GET /facturas; GET /facturas/:id | 293; 307 | — | finance/facturas:38; sales/orders/[id]:375 |
| POST /facturas | 314 | R(a,sm) | facturas:44 (manual factura, FACTURA series) |
| GET /tax/preview | 425 | — | lib/useTaxPreview.ts:182 (sales screens, **posCartStore (cashier)**) |
| POST /facturas/:id/cancel | 449 | R(a) | facturas:56 |
| GET /iva-report; /iva-net-report | 459; 509 | — | finance/iva-report:21, :31 |
| GET /trial-balance; /profit-loss; /balance-sheet | 483; 645; 690 | — | iva-report:26; p-and-l:23; balance-sheet:15 |
| GET /ap-aging; /ar-aging | 598; 622 | — | finance/aging:24, :30 |
| GET /periods; /periods/:year/:month/status | 750; 796 | — | finance/periods:16 |
| POST /periods/:y/:m/close; /reopen | 768; 784 | R(a) | periods:21, :28 |
| GET /bank-reconciliation | 805 | — | finance/bank-reconciliation |

`finance/currency.routes.ts` (13 routes) already uses a permission manifest. It is out of scope and unchanged.

**`reporting/report.routes.ts`** (`/reports`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET /sales/monthly; /sales/by-city; /products/top-selling; /daily-revenue; /dashboard; /ceo-dashboard | 18; 23; 28; 57; 65; 78 | R(a,sm) | dashboard:119-136; reports:46-56; ceo-dashboard:86 |
| GET /purchases/monthly | 37 | R(a,sm) | n/f |
| GET /inventory/turnover; /inventory/valuation | 42; 47 | R(a,sm) | reports:66 |
| GET /trends/growth | 52 | R(a) | reports:61 |

**`setup/setup.routes.ts`** (`/setup`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET /operating-units; /operating-units/types | 54; 71 | — | setup/organisation:40 |
| POST /operating-units; PUT /operating-units/:id | 79; 115 | R(a,sm) | organisation:295 |
| GET /dimensions; /dimensions/meta; /dimensions/:id/impact | 160; 178; 338 | — | setup/finance:34, :38, :174 |
| POST /dimensions; PUT /dimensions/:id; POST /dimensions/:id/values; PUT /dimensions/:id/rules | 189; 224; 255; 293 | R(a) | setup/finance:201, :257, :49 |
| GET /number-sequences | 411 | — | setup/numbering:63; lib/facturaNumbering.ts:97 (**PaymentModal (cashier)**, sales orders, facturas) |
| PUT /number-sequences/:id | 472 | R(a) | numbering:68 |
| GET /readiness | 579 | — | (erp)/setup:28 |

**`hr/hr.routes.ts`** (`/hr`)

| Route | Line | Guard | Callers |
|---|---|---|---|
| GET /users | 16 | R(a,sm) | n/f |
| PUT /users/:id/role; PUT /users/:id/deactivate | 25; 33 | R(a) | n/f |
| GET /employees | 40 | R(a,sm) | hr:36; hr/payroll:23 |
| POST /employees | 53 | R(a,sm), with admin-escalation check (`:59`) | hr:40 |
| PUT /employees/:id; POST /employees/:id/pos-pin; DELETE /employees/:id/pos-credentials | 86; 97; 109 | R(a) | n/f |
| GET /payroll; POST /payroll | 119; 128 | R(a) | hr/payroll:40, :54 |

**`audit/audit.routes.ts`**: `GET /` (line 11), R(a). Caller: (erp)/audit:29.

**`auth/auth.routes.ts`** (public, mounted outside v1)

| Route | Line | Guard | Callers |
|---|---|---|---|
| POST /login | 29 | public | stores/authStore.ts:48; Expo auth.ts:5 |
| POST /register | 79 | public; tenant fallback (`:86`); first user becomes admin (`:96-97`) | (store)/store/register:25 (sends no tenant) |
| POST /refresh | 141 | public; no stored-token check | authStore:70 |
| GET /me; GET /account; PUT /account | 162; 170; 181 | authentication only | authStore:73; (store)/account:22, :41 |
| POST /make-admin | 198 | authentication only; a sole user can promote themselves | (erp)/settings:18 |

`tenants/tenant.routes.ts` was handled by WORK-022 and WORK-025b. `GET /currency` is authentication-only by design.

### 3.3 Totals (excluding purchase, currency and tenant routes)

| Guard | Routes |
|---|---|
| None | **80** |
| `requireRole` | 94 |
| Legacy colon permission | 12 |
| Dotted permission | 1 |
| **Total** | **187** |

For scale, WORK-016 converted 66 routes.

---

## 4. SME scope decision

**What a three-store shoe retailer needs.** The staff are an owner, an outsourced contador, store managers, cashiers and stock staff. The business needs:
- the books closed to customers;
- cashiers confined to the till;
- stock staff able to execute warehouse work;
- one person who posts journals, separate from the person who drafts them.

**What it does not need now:**
- a database-backed Role/Duty/Privilege/Permission administration UI;
- enforced SoD conflict rules with an override log;
- site- or warehouse-scoped role assignments;
- journal names with posting restrictions and account control.

**Recommendation:** extend the code-owned registry (the WORK-016 pattern). The codes are stable dotted business actions, so a later database catalog can reference the same strings. Do not build D365 security governance (O-3) now.

---

## 5. Registry design

### 5.1 Mechanics

1. **Workforce gate** (new and permanent; closes finding 1 in one step).
   - New file `shared/middleware/workforceGate.ts`, wired in `app.ts` after `authMiddleware`.
   - A caller whose role is `customer`, or whose role is not a key of `ROLE_PERMISSIONS`, gets 403, unless `(method, path)` exactly matches one of the `STOREFRONT_SURFACE` entries:
     - `GET /api/v1/products`
     - `GET /api/v1/products/categories`
     - `GET /api/v1/products/<uuid>`
     - `POST /api/v1/sales/orders/storefront`
     - `GET /api/v1/tenant/currency`
   - The allow-list is exported data, pinned by a test. Basis: O-7 and O-1.
   - Workforce roles pass through to the per-route guards.
2. **One manifest per route file.**
   - Each file exports `<MODULE>_ROUTE_PERMISSIONS` as `Object.freeze({...} satisfies RouteGuards)`.
   - `RouteGuards = Record<string, readonly [Permission, ...Permission[]] | { readonly anyOf: readonly [Permission, ...Permission[]] }>`.
   - A shared `routeGuard(manifest)` in `permissions.ts` returns `guard(key)`. Arrays mean all-of; the new `requireAnyPermission` implements `anyOf`, with the same 401/403 semantics.
   - The guard is the **first** middleware on every route, before `validate()`, so a denial comes before any 400 and before any database access.
   - The existing purchase files are not refactored.
3. **Explicitly unpermissioned routes are recorded as data, not left as omissions.** Keep them in an exported list; today the only entry is `GET /tenant/currency`.

### 5.2 Permission catalog (new codes)

| Namespace | Codes |
|---|---|
| sales | `sales.order.read/.create/.update/.confirm/.ship/.complete/.cancel`; `sales.invoice.post`; `sales.customer_payment.post`; `sales.return.post`; `sales.quotation.read/.create/.update/.send/.confirm/.close` |
| crm | `crm.lead.read`, `crm.lead.maintain`, `crm.opportunity.read`, `crm.opportunity.maintain`, `crm.opportunity.close`, `crm.setup.maintain` |
| customer | `customer.read`, `customer.create`, `customer.update` |
| storefront | `storefront.catalog.read`, `storefront.order.place` |
| pos | `pos.session.operate`, `pos.sale.post`, `pos.sale.void` |
| product | `product.read`, `product.maintain`, `product.delete`, `product.media.generate`, `product.setup.read`, `product.setup.maintain` |
| inventory | `inventory.stock.read`, `inventory.transaction.read`, `inventory.transfer.post`, `inventory.adjustment.post`, `inventory.count.read/.create/.record/.post` |
| warehouse | `warehouse.structure.read/.maintain`, `warehouse.site.maintain`, `warehouse.work.read/.execute`, `warehouse.wave.read/.release`, `warehouse.arrival.read/.create/.post`, `warehouse.setup.read/.maintain` |
| import | `import.job.read/.prepare/.execute` |
| finance (added) | `finance.account.read/.maintain`, `finance.journal.read/.create/.post`, `finance.factura.read/.create/.cancel`, `finance.tax.preview`, `finance.tax_report.read`, `finance.statement.read`, `finance.aging.read`, `finance.period.read/.close/.reopen`, `finance.bank_reconciliation.read`, `finance.dimension.read` |
| setup (added) | `setup.operating_unit.read/.maintain`, `setup.number_sequence.read/.maintain` |
| report | `report.sales.read`, `report.purchase.read`, `report.inventory.read` |
| hr / security / audit | `hr.employee.read/.create/.update`, `hr.employee.pos_credential.maintain`, `hr.payroll.read/.post`, `security.user.read`, `security.user.role.assign`, `security.user.deactivate`, `audit.log.read` |

**Rule [REC]:** no code without a route that enforces it.

### 5.3 Route → permission maps

#### 030a

**`SALES_ORDER_ROUTE_PERMISSIONS`**

| Route | Permission |
|---|---|
| GET /; GET /:id | `sales.order.read` |
| POST / | `sales.order.create` |
| POST /storefront | `storefront.order.place` |
| POST /:id/invoice | `sales.invoice.post` |
| POST /:id/pay | `sales.customer_payment.post` |
| PUT /:id | `sales.order.update` |
| POST /:id/confirm | `sales.order.confirm` |
| POST /:id/ship | `sales.order.ship` |
| POST /:id/complete | `sales.order.complete` |
| POST /:id/cancel | `sales.order.cancel` |
| POST /:id/return | `sales.return.post` |

**`SALES_QUOTATION_ROUTE_PERMISSIONS`**

| Route | Permission |
|---|---|
| GET /; GET /:id | `sales.quotation.read` |
| POST / | `sales.quotation.create` |
| PUT /:id/lines; POST /:id/revise | `sales.quotation.update` |
| POST /:id/send | `sales.quotation.send` |
| POST /:id/confirm | all-of `sales.quotation.confirm` + `sales.order.create`, plus `customer.create` if confirming converts a lead |
| POST /:id/lose; POST /:id/cancel | `sales.quotation.close` |

**`CRM_ROUTE_PERMISSIONS`**

| Route | Permission |
|---|---|
| GET /stages | `crm.opportunity.read` |
| POST /stages; PUT /stages/:id | `crm.setup.maintain` |
| GET /leads; GET /leads/:id | `crm.lead.read` |
| POST /leads; PUT /leads/:id; POST /leads/:id/disqualify; POST /leads/:id/reopen | `crm.lead.maintain` |
| POST /leads/:id/qualify | all-of `crm.lead.maintain` + `crm.opportunity.maintain` + `customer.create` |
| POST /leads/:id/convert-to-customer | all-of `crm.lead.maintain` + `customer.create` |
| GET /opportunities; /pipeline; /:id | `crm.opportunity.read` |
| POST /opportunities; PUT /:id; POST /:id/stage | `crm.opportunity.maintain` |
| POST /opportunities/:id/close | `crm.opportunity.close` |

**`CUSTOMER_ROUTE_PERMISSIONS`**

| Route | Permission |
|---|---|
| GET /; GET /:id | `customer.read` |
| POST / | `customer.create` |
| PUT /:id | `customer.update` |
| GET /segments | `report.sales.read` |
| GET /:id/orders | all-of `customer.read` + `sales.order.read` |

**`POS_ROUTE_PERMISSIONS`**

| Route | Permission |
|---|---|
| All four session routes | `pos.session.operate` |
| POST /sale | `pos.sale.post` |
| POST /sales/:orderId/void | `pos.sale.void` |

**Product reads shared with the storefront** (`product.routes.ts`; 030a converts only these three):

| Route | Guard |
|---|---|
| GET / | `{anyOf: [product.read, storefront.catalog.read]}` |
| GET /categories | `{anyOf: [product.read, storefront.catalog.read]}` |
| GET /:id | `{anyOf: [product.read, storefront.catalog.read]}` |

A caller without `product.read` gets the storefront projection (D-4): `is_published = true` is forced, and `cost_price` and variant `additional_cost` are omitted.

#### 030b

**`PRODUCT_ROUTE_PERMISSIONS`** (the remaining 22 routes)

| Route | Permission |
|---|---|
| GET /barcode/:code | `product.read` |
| POST /categories, POST /, PUT /:id, POST /bulk, variant POST/PUT/DELETE, image POST/DELETE, DELETE /:id/video | `product.maintain` |
| DELETE /:id | `product.delete` |
| setup GETs | `product.setup.read` |
| setup POST/PUT | `product.setup.maintain` |
| generate-video; video-jobs | `product.media.generate` |
| GET /:id/stock | `inventory.stock.read` |

**Other 030b manifests**

| Manifest | Route | Permission |
|---|---|---|
| `UOM_ROUTE_PERMISSIONS` | GET / | `product.read` |
| | POST /; PUT /:id; POST /seed-defaults | `product.maintain` |
| `VARIANT_TYPE_ROUTE_PERMISSIONS` | GET / | `product.read` |
| | POST; PUT; DELETE | `product.maintain` |
| `INVENTORY_ROUTE_PERMISSIONS` | GET /stock; GET /low-stock | `inventory.stock.read` |
| | GET /transactions | `inventory.transaction.read` |
| | POST /transfers | `inventory.transfer.post` |
| | POST /adjust | `inventory.adjustment.post` |
| `INVENTORY_COUNT_ROUTE_PERMISSIONS` | GET /; GET /:id | `inventory.count.read` |
| | POST / | `inventory.count.create` |
| | PUT /:id/lines/:lineId | `inventory.count.record` |
| | POST /:id/finalize | `inventory.count.post` |
| `IMPORT_ROUTE_PERMISSIONS` | GET jobs | `import.job.read` |
| | upload; mapping; validate | `import.job.prepare` |
| | execute | `import.job.execute` |

**`WAREHOUSE_ROUTE_PERMISSIONS`**

| Route | Permission |
|---|---|
| GET sites, warehouses, overview, zones, locations | `warehouse.structure.read` |
| POST /sites | `warehouse.site.maintain` |
| POST warehouses, zones, locations, locations/bulk | `warehouse.structure.maintain` |
| GET /work | `warehouse.work.read` |
| work start, line complete, complete | `warehouse.work.execute` |
| GET /waves | `warehouse.wave.read` |
| POST /waves/:id/release | `warehouse.wave.release` |
| GET /arrival-journals | `warehouse.arrival.read` |
| POST /arrival-journals | `warehouse.arrival.create` |
| POST /arrival-journals/:id/post | `warehouse.arrival.post` |
| GET /parameters; GET /location-directives | `warehouse.setup.read` |
| POST /setup; PUT /parameters/:id; POST /location-directives; POST /location-directives/:id/lines; DELETE /location-directives/:id | `warehouse.setup.maintain` (D-11) |

#### 030c

**`FINANCE_ROUTE_PERMISSIONS`**

| Route | Permission |
|---|---|
| GET /accounts; GET /coa-templates | `finance.account.read` |
| POST /accounts; PUT /accounts/:id | `finance.account.maintain` |
| seed-default; seed-coa | `finance.setup.maintain` |
| GET /journal-entries | `finance.journal.read` |
| POST /journal-entries | `finance.journal.create` |
| POST /journal-entries/:id/post | `finance.journal.post` |
| GET facturas | `finance.factura.read` |
| POST /facturas | `finance.factura.create` |
| POST /facturas/:id/cancel | `finance.factura.cancel` |
| GET /tax/preview | `finance.tax.preview` |
| IVA reports | `finance.tax_report.read` |
| trial balance, P&L, balance sheet | `finance.statement.read` |
| agings | `finance.aging.read` |
| period GETs | `finance.period.read` |
| period close | `finance.period.close` |
| period reopen | `finance.period.reopen` |
| bank reconciliation | `finance.bank_reconciliation.read` |

**Other 030c manifests**

| Manifest | Route | Permission |
|---|---|---|
| `REPORT_ROUTE_PERMISSIONS` | sales/*, top-selling, daily-revenue, dashboard, ceo-dashboard, trends/growth (D-12) | `report.sales.read` |
| | purchases/monthly | `report.purchase.read` |
| | inventory/* | `report.inventory.read` |
| `SETUP_ROUTE_PERMISSIONS` | operating-unit GETs | `setup.operating_unit.read` |
| | operating-unit POST/PUT | `setup.operating_unit.maintain` |
| | dimension GETs | `finance.dimension.read` |
| | dimension writes | `finance.setup.maintain` |
| | GET /number-sequences | `setup.number_sequence.read` |
| | PUT /number-sequences/:id | `setup.number_sequence.maintain` |
| | GET /readiness | `setup.tenant.read` |
| `HR_ROUTE_PERMISSIONS` | GET /users | `security.user.read` |
| | role | `security.user.role.assign` |
| | deactivate | `security.user.deactivate` |
| | GET /employees | `hr.employee.read` |
| | POST /employees | `hr.employee.create` (keeps the admin-escalation check) |
| | PUT /employees/:id | `hr.employee.update` |
| | pos-pin; pos-credentials | `hr.employee.pos_credential.maintain` |
| | GET /payroll | `hr.payroll.read` |
| | POST /payroll | `hr.payroll.post` |
| `AUDIT_ROUTE_PERMISSIONS` | GET / | `audit.log.read` |

### 5.4 Role grants

These are added to the existing purchase, setup and currency grants.

| Role | New grants |
|---|---|
| admin | `admin:all` (unchanged) |
| store_manager | **Sales and CRM:** all `sales.order.*` except `.cancel`; `sales.invoice.post`; `sales.customer_payment.post`; `sales.return.post`; all `sales.quotation.*`; `crm.lead.*`; `crm.opportunity.*` (not `crm.setup.maintain`); `customer.*`; all `pos.*`.<br>**Product and stock:** `product.read`, `product.maintain`, `product.media.generate`, `product.setup.read`; all `inventory.*`; all `warehouse.*` except `warehouse.site.maintain`; `import.job.read`, `import.job.prepare`.<br>**Finance:** `finance.account.read`; `finance.journal.read`; `finance.journal.create` (D-5); `finance.factura.read`, `finance.factura.create`; `finance.tax.preview`; `finance.tax_report.read`; `finance.statement.read`; `finance.aging.read`; `finance.period.read`; `finance.bank_reconciliation.read`; `finance.dimension.read`.<br>**Setup, reports, HR:** `setup.operating_unit.*`; `setup.number_sequence.read`; `report.*`; `hr.employee.read`, `hr.employee.create`; `security.user.read` |
| cashier (D-7) | `pos.session.operate`, `pos.sale.post`, `product.read`, `customer.read`, `customer.create`, `inventory.stock.read`, `warehouse.structure.read`, `setup.number_sequence.read`, `finance.tax.preview` |
| employee (D-7) | `product.read`, `inventory.stock.read`, `warehouse.structure.read`, `sales.order.read`, `sales.quotation.read`, `customer.read`, `crm.lead.read`, `crm.opportunity.read`, plus the existing requester codes |
| warehouse_worker (D-8) | `product.read`, `inventory.stock.read`, `warehouse.structure.read`, `warehouse.work.read`, `warehouse.work.execute`, `warehouse.wave.read`, `warehouse.arrival.read`, `inventory.count.read`, `inventory.count.record` |
| customer | `storefront.catalog.read`, `storefront.order.place` |
| purchasing_requester | `product.read`, `warehouse.structure.read` |
| buyer | `product.read`, `inventory.stock.read`, `warehouse.structure.read`, `finance.account.read` |
| receiver (D-9) | `product.read`, `inventory.stock.read`, `warehouse.structure.read`, `warehouse.work.read`, `warehouse.work.execute`, `warehouse.arrival.read` |
| ap_clerk | `product.read`, `warehouse.structure.read`, `finance.aging.read` |
| finance_approver (D-6) | `finance.account.read`, `finance.journal.read`, `finance.journal.post`, `finance.factura.read`, `finance.tax_report.read`, `finance.statement.read`, `finance.aging.read`, `finance.period.read`, `finance.bank_reconciliation.read`, `finance.dimension.read` |
| auditor (D-10) | Every `.read` code except `storefront.*`, plus `audit.log.read`. Derived in code and pinned by a snapshot test |

### 5.5 Segregation-of-duties matrix (documented; not enforced by rules — O-3 is deferred)

| # | Duty A | Duty B | Holders | Treatment |
|---|---|---|---|---|
| S-1 | `finance.journal.create` | `finance.journal.post` | Store manager creates; admin and finance_approver post | Enforced; admin is the documented small-entity override (O-4, O-5) |
| S-2 | `inventory.count.record` | `inventory.count.post` | warehouse_worker records; store manager posts | Enforced |
| S-3 | `purchase.receipt.post` | `purchase.vendor_payment.post` | Unchanged (WORK-016) | Enforced (O-3 example) |
| S-4 | `sales.return.post` / `pos.sale.void` | `sales.customer_payment.post` | Store manager holds all | **Residual**; mitigated by the audit log (O-6) |
| S-5 | `inventory.adjustment.post` | `inventory.count.post` | Store manager holds both | Residual |
| S-6 | `customer.update` (tax id, tax group) | `sales.invoice.post` | Store manager holds both | Residual |
| S-7 | `security.user.role.assign` | any operational code | Admin only; a store manager cannot mint an admin | Enforced |
| S-8 | `warehouse.site.maintain` / `finance.setup.maintain` | posting | Admin only | Enforced |
| S-9 | `finance.period.close` / `.reopen` | `finance.journal.post` | Admin holds all; finance_approver posts only | Enforced; admin override |

---

## 6. Migration from legacy colon codes

- **Server-internal only** (finding 5). No frontend, storefront or Expo POS contract changes.
- **Delete legacy codes per slice**, so no dead code outlives its routes:
  - **030a:** `customers:*`, `pos:*`.
  - **030b:** `inventory:count`, `products:*`, `inventory:*`, `warehouse:*`, `import:run`.
  - **030c:** `sales:*`, `finance:*`, `reports:read`, `hr:*`, the unused `purchase:*`, and the `LegacyPermission` type itself. `admin:all` stays.
- **The baseline is the guard enforced today** (§3.2), not the legacy map (finding 4). Where the two disagree, §7 lists the change.
- **Tests to change:**
  - `permissions.test.ts`, which asserts legacy codes (including `warehouse_worker` lacking `inventory:read`);
  - `o2cContainment.test.ts`;
  - `taxPreviewRoute.test.ts` (030c).

---

## 7. Access changes (every change is listed; everything else is preserved)

### 7.1 Tightened

| Role | Loses | Slice | Decision |
|---|---|---|---|
| customer | Every unguarded route except the 5 storefront-surface entries, immediately, through the gate | 030a | D-2 |
| customer | Unpublished products, `cost_price` and variant `additional_cost` on the three shared product reads | 030a | D-4 |
| unknown role | Everything in v1 except the storefront surface | 030a | D-2 |
| anyone | `/auth/register` without an explicit tenant; admin through registration; `/auth/make-admin` | 030a | D-3 |
| cashier | Sales order reads and create, quotation reads and create, all CRM, the storefront order route | 030a | D-7 |
| cashier | Inventory transactions, counts, warehouse work, waves, arrival, uom and variant-type writes, image and video routes, uom seed | 030b | D-7 |
| cashier | Every finance read except tax preview; setup reads except number sequences; dimensions | 030c | D-7 |
| employee | Order create, quotation create, CRM writes; plus the same 030b and 030c losses as cashier | per slice | D-7 |
| purchase-specialised roles (requester, buyer, receiver, ap_clerk, finance_approver) | Every unguarded route their §5.4 row does not grant (e.g. a buyer reading the ledger) | per slice | D-7 |
| workforce roles other than admin, store manager and D-16 holders | Video generation and video jobs | 030b | D-16 |

### 7.2 Widened

| Role | Gains | Decision |
|---|---|---|
| store_manager | Location-directive header create and read (today admin-only, although the store manager can already add lines and delete) | D-11 |
| store_manager | `GET /reports/trends/growth` | D-12 |
| auditor | `GET /audit` and every read | D-10 |
| finance_approver | Journal post and finance reads | D-6 |

**Preserved by explicit grant:** warehouse_worker and receiver keep warehouse work execution. Today they reach it only because those routes are unguarded (D-8, D-9).

### 7.3 Fail-closed behaviour changes (not access changes)

| Change | Slice | Decision |
|---|---|---|
| Journal post re-checks the closed period | 030c | D-14 |
| Inventory adjust and transfer refuse foreign product, variant or location ids (422 `FOREIGN_REFERENCE`) | 030b | D-18 |

---

## 8. `/auth/register` — in scope (030a)

**Why it is in scope:** it is the bridge from anonymous to authenticated behind finding 1, and it depends on the gate. With a second tenant (Turkey), `findFirst` without `orderBy` would attach customers to an arbitrary tenant.

**Changes (no schema change):**
1. `RegisterSchema` becomes strict and requires exactly one of `tenant_id` (uuid) or `tenant_slug`. Otherwise it returns 400 `TENANT_REQUIRED` and creates no user.
2. The role is always `customer`. The zero-user admin branch is deleted.
3. `POST /auth/make-admin`, and the self-promote block on `(erp)/settings/page.tsx`, are deleted. Tenants and admins come only from `createTenant.ts`.
4. The customer code uses the same MAX-suffix allocator as CRM (`crm.service.ts:83-90`) instead of `count()+1`.
5. The storefront register page sends `tenant_slug` from `NEXT_PUBLIC_STOREFRONT_TENANT_SLUG` and shows an error when that variable is unset. [REC] Resolving the tenant from the host name is the proper SaaS form later (D-3).

**Deferred:** a tenant self-registration policy (`DISABLED | OPEN | APPROVAL`), owned by Sales (e-commerce channel).
- **Hook:** none needed now. It will be an additive enum column on `SalesParameters` whose default preserves current behaviour, so no backfill.

---

## 9. In scope, and what is explicitly not built

**In scope:**
- the §5 registry, gate, manifests and role map;
- the registration fix;
- the storefront projection;
- the §7.3 fail-closed changes;
- tests, the harness, and the OpenAPI and `docs/API_SPEC.md` notes.

**Not built:**

| Not built | Schema hook |
|---|---|
| DB-backed Role/Duty/Privilege tables and administration UI | None now; codes are the stable catalog. The first assignment table will carry a nullable `legal_entity_id` |
| Enforced SoD rules and an override log (O-3) | None now; an additive `security_sod_rule` / `security_sod_override` later |
| Site- or warehouse-scoped assignments | None now |
| `/auth/me` effective permissions and frontend button gating | None; API addition |
| Journal names, posting restrictions, account control (O-5) | None; additive table |
| Journal "poster ≠ creator" rule | None now; `posted_by` is an additive nullable column, and `audit_logs` has the history |
| Denial auditing; refresh-token revocation | None; queued P0-Security |
| Storefront price integrity (finding 6) | Not authorization; **separate item before any external storefront user** (D-15) |
| `/warehouse/work/:id/complete` without executing lines | Behaviour defect; WORK-036 |

**Schema decision:** no `schema.prisma` change and no migration. `git diff -- backend/prisma` must be empty.

---

## 10. Parameter owner

**Owners:**

| Setting | Owner | Treatment |
|---|---|---|
| Permission catalog and role map | Security | Code-owned registry, not tenant configuration, as in WORK-016. The deferred admin UI is recorded in §9 |
| Storefront tenant binding | Deployment configuration | [REC], D-3 |
| Self-registration policy | Sales (future) | Deferred, §8 |

**Hard-coding:**
- **Remediated now:** the customer code `count()+1` in `auth.routes.ts`.
- **Recorded, not remediated:** the bank reconciliation account literal `'1101'` (`finance.routes.ts:812`, 90.60).

---

## 11. Invariants

1. **Tenant isolation:**
   - No handler's tenant filter changes, and neither the gate nor the guards ever widen data reach.
   - Cross-tenant token and header refusal stays.
   - 030b adds refusal of foreign locations.
2. **Bolivia:**
   - Every guard on invoice, return, manual factura and POS sale runs before `nextFacturaNumber`, and tests assert the allocator is never called on a denial.
   - IVA 13% inclusive and IT 3% sales-only are untouched.
   - No successful POS sale on TEST.
3. **Posting:** balance and reversal behaviour is unchanged. The journal-post period re-check reuses `assertPeriodPostable`, including `allow_posting_to_closed_period`.
4. **Authorization:**
   - Every one of the 187 routes appears in exactly one manifest, with its guard as the first middleware.
   - `admin:all` is the only override.
   - No code exists without a route that enforces it.
5. **Audit:** `auditLog` stays on every v1 write.

---

## 12. Risks and fail-closed boundaries

| Risk | Boundary |
|---|---|
| A hidden client call the role now loses | Refused with 403, never falls back to allow; browser pass per role |
| The path allow-list drifts | Default deny for customers; the allow-list is exported and pinned |
| The Expo POS diverges from the snapshot | Cashier grants cover every endpoint in the snapshot; any new endpoint gets 403 until registered |
| Derived auditor grants widen silently | Snapshot test of the auditor code list |
| `NEXT_PUBLIC_STOREFRONT_TENANT_SLUG` is unset | Registration refused (400), never attached to a guessed tenant |
| A journal is posted into a closed period | `PERIOD_CLOSED` through the existing assertion (D-14) |
| Storefront price tampering remains after 030a | Explicitly open under D-15; must close before external users |

---

## 13. Acceptance criteria

1. **Unit — maps.**
   - `o2cRoutePermissions.test.ts` (030a), `inventoryRoutePermissions.test.ts` (030b) and `financeRoutePermissions.test.ts` (030c) pin each manifest with `toEqual`, plus key counts:
     - 030a: 12 + 9 + 18 + 6 + 6 + 3;
     - 030b: 22 + 4 + 4 + 5 + 5 + 26 + 6;
     - 030c: 26 + 10 + 14 + 10 + 1.
   - `permissions.test.ts` pins every role's exact grant list, including the auditor snapshot and the customer's two codes.
2. **Unit — coverage.** For each router, the `(method, path)` set from Hono `router.routes` equals the manifest keys plus the explicit unpermissioned list, so a new unguarded route fails CI.
3. **Unit — deny before the database.**
   - Mount each router with the db client mocked as a Proxy that records any access.
   - For every manifest key, a role lacking the permission gets 403 with zero db access; a holder gets a status other than 403.
   - The FACTURA allocator mock is never called on a denied invoice, return, manual factura or POS sale.
4. **Unit — gate.**
   - `customer` and unknown roles get 403 on samples from every module, and pass exactly the 5 storefront-surface entries.
   - `/products/categories` is correctly distinguished from `/products/<uuid>`.
   - Workforce roles pass through.
5. **Unit — register.**
   - No tenant gives 400 with no user write.
   - The role is always `customer`, even in a zero-user tenant.
   - `make-admin` returns 404.
   - Customer codes come from the MAX-suffix allocator.
6. **Unit — projection.** A customer receives no `cost_price` or `additional_cost`, and unpublished products are excluded even when `published=false` is requested.
7. **030c.** A journal post into a CLOSED period is refused; with `allow_posting_to_closed_period` it is allowed and logged.
8. **030b.** Adjust and transfer with a foreign location, product or variant return 422 before any write.
9. **Local checks.** Backend build, `typecheck:scripts`, frontend `tsc --noEmit` and `next build`, full Jest, `git diff --check`, empty `git diff -- backend/prisma`.
10. **TEST harness `verify:o2c-permissions`** (guard `ALLOW_TEST_DATABASE_WRITE=WORK030_ACCEPTANCE`; writes nothing).
    - Runs in-process `app.request` against real `app.ts` and TEST, with synthetic tokens per role.
    - Allow probes (GET):
      - store manager → `/finance/trial-balance`;
      - cashier → `/products`, `/warehouse/warehouses`, `/setup/number-sequences`, `/tenant/currency`;
      - warehouse_worker → `/warehouse/work`;
      - auditor → `/audit`;
      - customer → `/products`, with no `cost_price` in the response.
    - Deny probes:
      - customer → `/finance/journal-entries`, `/crm/leads`, `POST /warehouse/work/<uuid>/complete`, `POST /uom/seed-defaults`;
      - cashier → `POST /sales/orders/<uuid>/invoice`;
      - `POST /auth/register` without a tenant → 400;
      - `POST /auth/make-admin` → 404.
    - Before/after checks: FACTURA `next_number` and `updated_at` unchanged, user count unchanged, uom count unchanged. No data rows printed.
11. **No migration**, so no isolated rebuild; say so in the report.
12. **Browser pass.**
    - admin and store manager: sales, finance, warehouse;
    - cashier: web POS open register, sale screen and receipt, without submitting a sale on TEST;
    - customer: shop and register on a local build.
13. **Worklog entry** with an "Access changes" table matching §7 exactly.

---

## 14. Sizing and split

187 routes in one item would be L, so it is split three ways. WORK-016 converted 66.

| Item | Contents | Size | Order |
|---|---|---|---|
| **030a** | Workforce gate; sales orders, quotations, CRM, customers, POS rename; storefront projection on 3 product reads; register and make-admin; shared `routeGuard`/`anyOf`; coverage helper | M | First (closes finding 1) |
| **030b** | Product (22 routes), uom, variant types, inventory, counts, warehouse, import; foreign-location refusal | M | Second |
| **030c** | Finance, reports, setup, HR/security, audit; journal-post period re-check; delete `LegacyPermission` | M | Third; WORK-034 depends on it |

**Separate item — D-15, storefront price integrity:** size S, immediately after 030a and before any external user.

---

## 15. Decisions for Kubi

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Split into 030a → 030b → 030c | **Yes** |
| D-2 | Permanent workforce gate: `customer` and unknown roles reach only the 5-route storefront surface | **Yes** |
| D-3 | `/auth/register` in scope: explicit tenant, never admin; delete `/auth/make-admin` and the settings self-promote UI; storefront tenant from `NEXT_PUBLIC_STOREFRONT_TENANT_SLUG` for now | **Yes** |
| D-4 | Storefront projection: published products only, no cost fields | **Yes** |
| D-5 | Store manager keeps `finance.journal.create` (DRAFT only); posting stays separate | **Keep.** Alternative: remove it if the contador enters all journals. Step 0 counts drafts created by store managers |
| D-6 | finance_approver gains journal post and finance reads; period close and reopen stay admin-only | **Yes** |
| D-7 | Cashier and employee confined to their §5.4 lists; purchase-specialised roles lose unrelated unguarded reach | **Yes** |
| D-8 | warehouse_worker gains warehouse work execution, structure/stock/product reads, count read and record (not post) | **Yes** |
| D-9 | receiver gains warehouse work read and execute (put-away) and arrival read | **Yes** |
| D-10 | auditor gains all reads, including `audit.log.read` | **Yes** |
| D-11 | Location directives unified under `warehouse.setup.maintain` (admin and store manager) | **Yes** |
| D-12 | `trends/growth` joins `report.sales.read` | **Yes** |
| D-13 | HR, security and audit routes included in 030c | **Yes** |
| D-14 | Journal post re-checks the closed period | **Yes** |
| D-15 | Storefront price integrity as its own item right after 030a | **Yes** |
| D-16 | `product.media.generate` (paid FAL.ai) for admin and store manager only | **Yes** |
| D-17 | Read-only TEST harness `verify:o2c-permissions` | **Yes** |
| D-18 | 030b refuses foreign product, variant or location ids on adjust and transfer | **Yes** |

---

## 16. Implementation prompt — WORK-030a (issue only after Kubi decides D-1 to D-18)

```text
WORK-030a — O2C permission registry, workforce gate, and customer registration containment.

Catalog: 99.25.050.000 Manage data security; 99.25.060.000 Configure segregation of duties;
99.25.070.000 (registration); L2 65.20, 65.30; UNVERIFIED-85 (CRM/quotations).
Design: docs/process/WORK-030_O2C_PERMISSION_REGISTRY.md (§3.2, §5, §7, §8, §13). Apply Kubi's
decisions as recorded in the worklog; where a decision differs from the design recommendation, the
decision wins.

PERMANENT RULE (worklog §4.1), binding: every value a customer could want to differ lives in data
owned by one module's Setup area; no global settings page; deferred capability ships a named schema
hook or an explicit "none needed"; hard-coding on a touched path is remediated now; user-managed
configuration needs its UI. For this item: no schema change, no migration; the registry is
code-owned security infrastructure; remediate the customer-code count()+1 in auth.routes.ts.

Hard limits: no prisma/schema.prisma or migration change (git diff -- backend/prisma must be empty);
no TEST writes; no successful POS sale on TEST; FACTURA next_number unchanged; do not touch purchase
route files, currency.routes.ts or tenant.routes.ts; do not edit skarpine-pos; do not commit until
the solution-architect review returns ACCEPTED.

Step 0 (read-only, TEST, report counts only, print no rows):
  - users by role in the TEST tenant, including customers;
  - tenant count;
  - DRAFT and POSTED journal_entries with source_module='MANUAL', grouped by creator role;
  - FACTURA next_number and updated_at.

Order of work:
1. backend/src/shared/middleware/permissions.ts:
   - add the §5.2 codes for sales, crm, customer, storefront and pos as `as const` arrays and extend
     `Permission`;
   - add `requireAnyPermission` (401 without a user, 403 otherwise; `admin:all` honoured);
   - add `type RouteGuards` and `routeGuard(manifest)` supporting all-of arrays and `{anyOf}`;
   - update ROLE_PERMISSIONS for these namespaces exactly per §5.4 (030a codes only);
   - delete `customers:*` and `pos:*` from LegacyPermission and from every role.
2. backend/src/shared/middleware/workforceGate.ts (new):
   - export STOREFRONT_SURFACE (the 5 entries in §5.1) and `workforceGate`;
   - wire it in backend/src/app.ts immediately after `v1.use('*', authMiddleware, auditLog)`.
3. Route files — export frozen manifests exactly per §5.3/030a and put guard(key) FIRST on every
   route:
   - sales/sales.routes.ts: remove the requireRole import; fix the comment at :92 that calls
     /storefront unauthenticated;
   - sales/quotation.routes.ts: read quotation.service confirmQuotation; if it can create a customer,
     add `customer.create` to the confirm all-of and record it;
   - crm/crm.routes.ts;
   - customers/customer.routes.ts;
   - pos/pos.routes.ts.
4. inventory/product.routes.ts:
   - guard only GET /, GET /categories and GET /:id with {anyOf:[product.read,
     storefront.catalog.read]};
   - for callers without product.read, force is_published=true and omit cost_price and variant
     additional_cost;
   - leave every other product route unchanged (030b).
5. auth/auth.routes.ts + shared/schemas RegisterSchema (§8):
   - strict schema; exactly one of tenant_id|tenant_slug, else 400 TENANT_REQUIRED;
   - role always 'customer';
   - delete /make-admin;
   - customer code via a shared MAX-suffix allocator (extract it from crm.service.ts:83 into a shared
     service, and make CRM use the extracted function).
   Frontend:
   - (store)/store/register/page.tsx sends tenant_slug from NEXT_PUBLIC_STOREFRONT_TENANT_SLUG and
     shows a clear error when it is unset;
   - remove the self-promote block from (erp)/settings/page.tsx;
   - add the variable to the frontend env example without any value.
6. Tests (Jest, no DB):
   - new __tests__/helpers/routeGuardHarness.ts: mount a router with a given role; db client mocked as
     a recording Proxy; iterate manifest keys, replacing :params with UUIDs.
   - new __tests__/o2cRoutePermissions.test.ts:
     - exact toEqual of the five manifests and the product anyOf entries, with key counts
       (12, 9, 18, 6, 6);
     - Hono router.routes (method, path) set equals the manifest keys;
     - for every key, a role lacking the permission gets 403 with zero db access, and holders get a
       status other than 403;
     - the FACTURA allocator mock is not called on denied /:id/invoice, /:id/return and /pos/sale.
   - gate tests per §13.4; register tests per §13.5; projection test per §13.6.
   - update permissions.test.ts: exact grant lists for every role for the 030a namespaces, and
     customer = exactly the two storefront codes.
   - update o2cContainment.test.ts: new codes; denial still happens before db access.
7. backend/scripts/verifyO2cPermissions.ts + package.json "verify:o2c-permissions":
   - per §13.10, with guard ALLOW_TEST_DATABASE_WRITE=WORK030_ACCEPTANCE;
   - must write nothing and print no data rows.
8. Docs:
   - backend/src/docs/openapi.ts and docs/API_SPEC.md: the permission per converted route, and the
     removal of /auth/make-admin;
   - CORE_ERP_COMPLETION_MATRIX.md rows 99.25.050.000 (§3 and §8.7) and 99.25.070.000 updated with
     evidence.
9. Verification:
   - backend build, typecheck:scripts, frontend tsc --noEmit and next build, full Jest,
     git diff --check, empty prisma diff;
   - run verify:o2c-permissions on TEST (read-only);
   - browser pass: admin/store manager through sales and CRM; cashier through web POS open register
     and sale screen WITHOUT submitting a sale; customer through shop and register on a local build.
10. Worklog entry "WORK-030a — … — implemented, unreviewed", containing:
   - an "Access changes" table matching the design §7 rows for 030a;
   - the Step 0 counts;
   - every command run and its result;
   - residuals: D-15 price integrity still open; 030b/030c routes still on requireRole or unguarded
     for workforce roles, but contained for customers by the gate.
```

### 16.1 WORK-030b delta (after 030a is ACCEPTED)

Uses the same header, rules and limits. Step 0 adds a read-only count of `inventory_stock` rows whose location's warehouse belongs to a different tenant than the row.

**Route conversions** (per §5.3/030b, guard first on every route):
- `product.routes.ts` (the remaining 22 routes)
- `uom.routes.ts`
- `variant-types.routes.ts`
- `inventory.routes.ts`
- `inventory-count.routes.ts`
- `warehouse.routes.ts`
- `import.routes.ts`

**Role grants and legacy cleanup:**
- Update grants per §5.4 (D-8, D-9, D-11, D-16).
- Delete the legacy codes `products:*`, `inventory:*`, `warehouse:*` and `import:run`.

**Foreign-reference refusal (D-18):**
- Extend `assertTenantReferences` with `locationIds`.
- Apply it to `POST /inventory/adjust` (product, variant, location) and to `transferStock` (from and to locations), returning 422 `FOREIGN_REFERENCE` before any write.

**Tests and verification:**
- Add `inventoryRoutePermissions.test.ts`.
- Extend the `verify:o2c-permissions` probes.
- Run the `verify:putaway` regression on TEST under its own guard.

### 16.2 WORK-030c delta (after 030b is ACCEPTED)

Uses the same header, plus catalog IDs 90.50, 90.60 and 99.25.110.000.

**Route conversions** (per §5.3/030c):
- `finance.routes.ts` (26 routes)
- `report.routes.ts`
- `setup.routes.ts`
- `hr.routes.ts` — keep the escalation checks
- `audit.routes.ts`

**Role grants and legacy cleanup:**
- Update grants per §5.4 (D-5, D-6, D-10, D-12, D-13).
- Delete the `LegacyPermission` type and every remaining colon code except `admin:all`.

**Journal-post period re-check (D-14):**
- `POST /journal-entries/:id/post` loads the draft within the tenant.
- It then re-runs the closed-period check (export it from `journal.service.ts`) before the status-guarded update.

**Tests and verification:**
- Add a repository-wide coverage test: every v1 router's route set equals its manifest keys plus the explicit unpermissioned list (only `GET /tenant/currency`).
- Update `taxPreviewRoute.test.ts`.
- Run on TEST:
  - `verify:currency-foundation` (not yet re-run after WORK-025b);
  - `verify:o2c-containment`;
  - an extended `verify:o2c-permissions`.
- FACTURA unchanged before and after.
