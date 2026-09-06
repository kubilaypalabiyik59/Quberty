# Security and Authorization Gap Analysis

**Date:** 2026-09-06  
**Status:** Analysis only; no implementation approved  
**Scope:** Authentication, authorization, role-based access control, data security, segregation of duties, and auditability  
**Research boundary:** Microsoft Learn and repository evidence only

## 1. Executive decision

- **Repo-verified:** Skarpine has a working but incomplete authentication layer: local password login, short-lived access JWTs, refresh-token cookies, active-user checks during login/refresh, and a token/header tenant match.
- **Repo-verified:** Skarpine does not have a D365-shaped authorization model. A user has one string `role`; route guards compare it with hard-coded names; there are no Role, Duty, Privilege, Permission, UserRoleAssignment, security-scope, or segregation-of-duties models.
- **Repo-verified:** the present model is not safe enough for a real multi-role user test. Several sensitive read and write operations require authentication but no business authorization.
- **Official documentation:** D365 Finance and Operations separates authentication, authorization, data security, and auditing. Its authorization hierarchy is Role -> Duty -> Privilege -> Permission/entry point. Duties represent business-process parts; privileges represent tasks; and permissions protect individual application objects and access levels.
- **Architectural recommendation:** adopt that anatomy, but not the X++ object implementation. Skarpine permissions should name stable business actions such as `purchase.order.receive` or `finance.journal.post`; they should not expose arbitrary database-table access to tenant admins.
- **Architectural recommendation:** treat this as P0 security foundation work after the repository and migration baseline is safe, and before external real-life testing. Do not build the security configuration UI first; server-side default-deny enforcement and route coverage come first.

## 2. Terminology correction

Authentication answers **who the user is**. Authorization answers **what that authenticated user is allowed to do**. Data security answers **which records or fields an otherwise authorized user may access**. Segregation of duties prevents one user or role from holding conflicting business powers.

The requested Role/Duty/Privilege model is primarily authorization, not authentication.

## 3. Official D365 model

### 3.1 Authentication and security layers

**Official documentation:** Microsoft Entra ID is the primary identity provider for finance and operations apps. After authentication, authorization controls application elements, while data security can restrict tables, fields, and rows. D365 also exposes sign-in audit information.

Source: [Security architecture](https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/sysadmin/security-architecture)

**Architectural recommendation:** Microsoft Entra ID is not an MVP requirement for Skarpine. Identity-provider choice must remain separate from the authorization model so local credentials can be retained now and Entra/OIDC added later without redesigning roles and permissions.

### 3.2 Role hierarchy

**Official documentation:** D365 uses this hierarchy:

```text
User
  -> Security role(s)
       -> Duty/Duties
            -> Privilege(s)
                 -> Permission(s) on entry points and securable objects
```

- A role represents organizational responsibilities and participation in business processes.
- A duty represents part of a business process.
- A privilege represents a task.
- A permission grants an access level to an entry point and its securable objects.
- D365 permits duties and privileges to be assigned to roles, but recommends granting through duties for maintainability.
- A user can hold multiple roles. Role access can be restricted by organization/legal entity.
- Sample roles are supplied and can be copied or replaced with custom roles.

Sources:

- [Role-based security](https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/sysadmin/role-based-security)
- [Secure finance and operations apps](https://learn.microsoft.com/dynamics365/guidance/implementation-guide/security-strategy-product-oa#role-based-security)
- [Manage users and security roles](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/sysadmin/assign-users-security-roles)

### 3.3 Data security

**Official documentation:** role permissions grant access; extensible data security policies further restrict records returned from tables. A role may therefore allow a function while a data policy restricts that function to a subset of organizations or records.

Source: [Extensible data security policies](https://learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/sysadmin/extensible-data-security-policies)

### 3.4 Segregation of duties

**Official documentation:** D365 can define incompatible duty pairs, validate roles and user-role assignments, block conflicts, or allow a documented override. Microsoft gives receiving goods and processing vendor payment as an example of duties that an organization might separate.

Sources:

- [Set up segregation of duties](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/sysadmin/tasks/set-up-segregation-duties)
- [Identify and resolve conflicts in segregation of duties](https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/sysadmin/identify-resolve-conflicts-segregation-duties)

## 4. Current Skarpine state

### 4.1 Authentication

| Capability | Evidence | Assessment |
|---|---|---|
| Password login | `backend/src/modules/auth/auth.routes.ts:29-76` | **Repo-verified: present** |
| Password hashing | `auth.routes.ts:46`, `auth.routes.ts:93` | **Repo-verified: bcrypt present** |
| Access JWT | `auth.routes.ts:49-52`; `backend/src/config/env.ts:10` | **Repo-verified: present, 15-minute default** |
| Refresh cookie | `auth.routes.ts:17-24` | **Repo-verified: HttpOnly, Secure in production, SameSite Strict** |
| Refresh-token persistence | `auth.routes.ts:60-66`, `128-134` | **Repo-verified: hashes are stored** |
| Persistence check during refresh | `auth.routes.ts:141-159` | **Repo-verified: missing; stored hash is not checked** |
| Server logout/revocation | `auth.routes.ts`; `frontend/src/stores/authStore.ts:33-37` | **Repo-verified: missing; frontend logout only clears local state** |
| Disabled-user enforcement | `auth.routes.ts:43`, `149` | **Repo-verified: checked at login/refresh, not every access request** |
| Tenant/token match | `backend/src/shared/middleware/authMiddleware.ts:24-32` | **Repo-verified: present** |

**Architectural risk:** the refresh-token table currently does not provide revocation because the refresh endpoint does not prove that the presented token is one of the stored, active hashes.

### 4.2 Authorization

| Capability | Evidence | Assessment |
|---|---|---|
| User authorization model | `backend/prisma/schema.prisma:40-58` | **Repo-verified: one string `User.role`** |
| Route authorization | `backend/src/shared/middleware/authMiddleware.ts:48-60` | **Repo-verified: hard-coded role-name guard** |
| Multiple roles per user | Schema | **Repo-verified: missing** |
| Duties, privileges, permissions | Schema and backend search | **Repo-verified: missing** |
| Legal-entity/site/warehouse role scope | Schema | **Repo-verified: missing** |
| Custom role configuration | Backend/frontend search | **Repo-verified: missing** |
| Frontend navigation security | `frontend/src/components/erp/Sidebar.tsx:14-137` | **Repo-verified: static menu; no permission metadata** |
| ERP shell access | `frontend/src/app/(erp)/layout.tsx:9-30` | **Repo-verified: authenticated-user check only** |

The API mounts tenant and authentication middleware globally for tenant-scoped routes (`backend/src/app.ts:161-190`). That provides authentication, not authorization. Examples of sensitive operations with no business-role guard include:

- `POST /finance/seed-coa` — `backend/src/modules/finance/finance.routes.ts:106`
- finance accounts, journals, facturas, tax reports and financial statements read routes — `finance.routes.ts:21`, `183`, `291`, `425`, `449`, `475`, `564`, `588`, `611`, `656`
- all listed POS session/sale/void routes — `backend/src/modules/pos/pos.routes.ts:31-409`
- customer creation and update — `backend/src/modules/customers/customer.routes.ts:27`, `51`
- unit-of-measure creation, update, and seed — `backend/src/modules/inventory/uom.routes.ts:19-55`

**Repo-verified conclusion:** an authenticated `customer` or `employee` is not consistently blocked from ERP information and actions. The existing role checks protect some high-risk operations, but the system is allow-by-omission rather than default-deny.

### 4.3 Data security and tenant isolation

- **Repo-verified:** the tenant middleware resolves an active tenant from `X-Tenant-ID` and the auth middleware verifies that it matches the token (`tenantMiddleware.ts:9-29` and `authMiddleware.ts:24-32`).
- **Repo-verified:** authorization has no role-assignment scope for legal entity, site, warehouse, department, or record ownership.
- **Repo-verified:** there is no generic data-policy enforcement layer comparable to XDS.
- **Architectural risk:** tenant isolation still depends on every service/query applying `tenant_id` correctly. Role-based authorization cannot substitute for database-enforced tenant isolation.

### 4.4 Audit

- **Repo-verified:** authenticated write requests are sent to `AuditLog` middleware (`backend/src/app.ts:165-166`).
- **Repo-verified:** the audit write is fire-and-forget and failures do not fail the business request (`backend/src/shared/middleware/auditLog.ts:38-52`).
- **Repo-verified:** if downstream processing throws before returning, the current middleware does not reach log creation. Denied and failed attempts therefore are not reliably security-audited.
- **Repo-verified:** the log stores the request-context role string, not the effective permission, duty, role assignment, or authorization decision.

## 5. Target architecture for Skarpine

### 5.1 Web-native D365 anatomy

**Architectural recommendation:** use D365's hierarchy but map it to stable web application actions. A permission must describe an entry point/action, not grant a tenant administrator arbitrary direct database-table access.

```text
purchase.order.read
purchase.order.create
purchase.order.confirm
purchase.order.receive
purchase.vendor_invoice.match
purchase.vendor_invoice.approve_discrepancy
purchase.vendor_invoice.post
finance.journal.read
finance.journal.create
finance.journal.post
finance.period.close
sales.order.ship
inventory.adjustment.post
security.role.manage
```

CRUD alone is insufficient because ERP risk lives in state transitions such as approve, receive, match, post, reverse, close, and settle.

### 5.2 Recommended hierarchy and schema hooks

```text
User
  -> UserRoleAssignment [tenant + optional legal entity/site/warehouse scope]
       -> SecurityRole
            -> RoleDuty
                 -> SecurityDuty
                      -> DutyPrivilege
                           -> SecurityPrivilege
                                -> PrivilegePermission
                                     -> SecurityPermission [registered application action]
```

All tenant-owned tables and uniqueness constraints must include `tenant_id`. Role assignments need date-effective and active-state hooks. `legal_entity_id` should be nullable from the first migration; site and warehouse restrictions should live in a separate scope-assignment structure rather than columns repeated on every role.

### 5.3 Standard templates plus safe customization

**Architectural recommendation:** ship versioned standard templates, then copy them into each tenant's configuration. Suggested starting roles are System Administrator, Security Administrator, Finance Manager, Accountant, Accounts Payable Clerk, Accounts Receivable Clerk, Procurement Manager, Buyer, Warehouse Manager, Warehouse Worker, Sales Manager, Sales Clerk, POS Cashier, and Auditor.

Tenant administrators may create roles, duties, and privileges by composing the registered catalog. They must not invent arbitrary permission codes that no server entry point enforces. Standard templates should be copyable; tenant changes should not mutate the source template definition.

### 5.4 One permission source for backend and frontend

- Backend `requirePermission(...)` middleware is authoritative.
- A central registry maps every protected API entry point to a stable permission code.
- The current-user endpoint returns effective permission codes and allowed scopes.
- Frontend navigation, pages, buttons, and form actions use the same codes for visibility and disabled states.
- Direct API calls must still return 403. Hiding a button is user experience, not security.
- CI must fail when a new ERP route has no explicit permission declaration or explicit public marker.

### 5.5 Admin, data policy, and segregation

System Administrator may resolve to all registered permissions, but the bypass must be explicit, server-side, tenant-scoped, and audited. Security administration should be distinct so an ordinary functional administrator cannot grant itself System Administrator access.

Permission checks answer whether an action is allowed. A second policy layer restricts which legal entity, site, warehouse, department, or owned records the action may reach.

Initial segregation candidates require Finance/Supply Chain validation: maintain vendor vs approve vendor payment; receive goods vs approve/pay invoice; create journal vs post journal; maintain bank setup vs reconcile; maintain roles vs approve own elevation. These are recommendations needing validation, not approved rules.

## 6. Prioritized implementation plan

### Security P0 — Immediate containment

1. Inventory every backend route and classify it as public or assign a permission code.
2. Add explicit authorization to unguarded sensitive routes, beginning with Finance, POS, customer maintenance, UOM setup, imports, and media mutations.
3. Separate storefront/customer APIs from ERP APIs; a `customer` identity must not inherit ERP access because it is authenticated.
4. Add server logout and real refresh-token verification/revocation.
5. Audit denied, failed, and successful security-sensitive actions.

**Dependency:** safe Git/migration baseline.  
**Required before:** external real-user testing.

### Security P1 — Additive RBAC foundation

1. Add Role, Duty, Privilege, Permission, join, UserRoleAssignment, and scope-hook models.
2. Create a registered, code-owned permission catalog.
3. Seed versioned standard role templates per tenant.
4. Translate the current one-role behavior into temporary compatibility assignments.
5. Add a central effective-permission resolver and default-deny middleware.
6. Add cache invalidation/security revision so changes take effect promptly.

### Security P2 — Convert vertical golden flows

Convert and test Source to Pay/AP first, then Inventory/Warehouse, Order to Cash/AR/POS, General Ledger/tax/reporting/setup, and the remaining modules. Retire legacy `requireRole` only after each slice is registered and tested.

### Security P3 — Security administration UI

Build effective-access inspection, scoped user-role assignments, copy-standard-role, role/duty/privilege composition, permission-catalog inspection, impact/conflict preview, and full change auditing. Do not allow unenforceable arbitrary permission codes.

### Security P4 — Data policy and segregation controls

Enforce organization scopes, add duty-conflict rules and documented overrides, add security reports, and evaluate PostgreSQL RLS as defense in depth separately from functional data scopes.

## 7. Acceptance gates

1. Every non-public backend entry point has an explicit permission and defaults to deny.
2. Direct API calls are denied even when the frontend is bypassed.
3. A user may hold multiple roles with tenant and optional organization scope.
4. Finance Manager, Buyer, Warehouse Worker, POS Cashier, and Auditor have allow-and-deny integration tests.
5. Customer/storefront identities cannot access ERP entry points.
6. Role changes, deactivation, logout, and token revocation take effect within an approved window.
7. Configuration changes and denied elevation attempts are auditable.
8. Cross-tenant tests prove permissions never widen tenant data access.
9. The UI derives from effective permissions but is never the enforcement boundary.
10. Approved Source to Pay segregation rules are enforced or explicitly deferred with schema hooks.

## 8. Decisions required

1. Must self-service customer registration coexist with ERP workforce login? Recommendation: yes, with separate access surfaces and permission baselines.
2. Is organization scope required at legal entity only for MVP, or also site/warehouse? Recommendation: preserve all hooks; enforce site/warehouse where operations require it.
3. Which standard roles are required for the real-life test?
4. Which Source to Pay and Finance duty pairs are forbidden, warning-only, or overrideable?
5. Who may create roles, publish role changes, assign roles, and approve an override?
6. Is external identity/OIDC required for the first test? Recommendation: no; stabilize authorization and session security first.

## 9. Explicitly deferred

- Full D365 security governance, automatic role assignment, licensing analysis, and privileged-session recording.
- Replacing the current authentication provider solely to build authorization.
- Arbitrary table/SQL permissions configurable by tenant administrators.
- Direct user permissions outside a future controlled emergency mechanism.

