# Quberty ERP: manual test cases for setup and master data

**What I checked:** I only read code. Nothing was edited, run, or started, and no `.env` values were opened. I read the page components, backend routes, zod schemas (`backend/src/shared/schemas/index.ts`), services, `permissions.ts`, `workforceGate.ts` and `auditLog.ts`, as of HEAD `905aeda`.

**Five things that change how you run these tests:**
1. **You cannot create or edit a customer in the UI.** The "New Customer" button has no click handler (`frontend/src/app/(erp)/sales/customers/page.tsx:61`). Customer cases MD-031 to MD-035 are run against the API.
2. **Data import does not import anything.** A job reaches COMPLETED and writes no rows (MD-044).
3. **Several things only exist as API calls, with no screen:** tenant language/country (`/tenant/config`), user role change and deactivation, product-level barcode.
4. **A duplicate code almost everywhere returns HTTP 500 "Internal server error", not 409.** The error handler never maps Prisma unique-constraint errors.
5. **The Audit log is admin-only.** The `auditor` role gets 403.

**How to run the API steps:**
- Use Swagger at `/api/docs` or any REST client, against base `/api/v1`.
- Send the headers `Authorization: Bearer <access_token>` and `X-Tenant-ID: <tenant uuid>`. Both come from the `POST /auth/login` response.
- Every error comes back as `{ success:false, error:{ message, code, details? } }`.
- A zod failure is `400`, code `VALIDATION_ERROR`, message `Validation failed`, with `details[{field,message}]`.
- `requirePermission` refuses with `403 "Permission denied: <code>"` (code `APP_ERROR`). Legacy `requireRole` refuses with `403 "Insufficient permissions"`.

**Test tenant baseline:** created by `scripts/createTenant.ts`. Ledger BOB/BOB, rate type BCB, country BO, language es, one admin user.

---

## A. Authentication

### MD-001 — Login with valid admin credentials
- **Priority:** P1  | **Role:** admin  | **Type:** happy
- **Preconditions:** Active tenant with an active admin user. Browser storage cleared.
- **Test data:** email `owner@<tenant>`, correct password
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /login → enter email and password → Sign in | Button stays in loading state. Welcome curtain shows the user's first name. Redirect to /dashboard. |
| 2 | DevTools → Application → Local Storage | `tenant_id` = tenant UUID. No access token in storage (it is held in memory only). |
| 3 | DevTools → Cookies | `refresh_token` is httpOnly, SameSite=Strict, Path `/api/v1/auth`, Max-Age 7 days. |
| 4 | DevTools → Network → `POST /auth/login` | 200 with `data.access_token`, `data.tenant_id`, `data.user{id,email,first_name,last_name,role}`. |
- **Post-conditions / data checks:** `users.last_login_at` is updated. A new `refresh_tokens` row exists with a hash and expiry 7 days out. Login is not written to the audit log (it runs before the audited router).

### MD-002 — Login refused: wrong password, unknown email, inactive user
- **Priority:** P1  | **Role:** any  | **Type:** negative
- **Preconditions:** User A is active. User B has been deactivated (MD-042).
- **Test data:** A with a wrong password; `nobody@x.com`; B with the correct password
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /login → A + wrong password | API 401 `Invalid credentials`. UI shows "Invalid email or password". Stays on /login. |
| 2 | /login → unknown email | Same 401 and same message. The response does not reveal whether the email exists. |
| 3 | /login → B + correct password | 401 `Invalid credentials`. |
| 4 | /login → A's email in different case (`OWNER@…`) | 401. Email matching is case-sensitive. Record the result. |
- **Post-conditions / data checks:** No refresh token row created. No `last_login_at` change.

### MD-003 — Login input validation and rate limit
- **Priority:** P2  | **Role:** any  | **Type:** boundary
- **Preconditions:** Redis running (otherwise the limiter lets every request through).
- **Test data:** `POST /auth/login` with `{ "email":"abc", "password":"" }`; then 11 login attempts within 15 minutes from the same IP
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | API → body `{email:"abc",password:""}` | 400 `VALIDATION_ERROR`, details `email: Invalid email address`, `password: Password is required`. |
| 2 | /login → type `abc` in Email | The browser's `type=email` check blocks submit. |
| 3 | Attempt login 11 times (right or wrong password) | Attempt 11 returns 429 `RATE_LIMITED` "Too many requests…". |
| 4 | Look at the UI message on attempt 11 | **Expected:** the rate-limit message. **Actual per code:** "Invalid email or password", because the page reads `data.message` instead of `data.error.message` (defect D-3). |
- **Post-conditions / data checks:** Redis key `rl:<ip or 'local'>` expires after 900 s.

### MD-004 — Silent token refresh (page reload and access-token expiry)
- **Priority:** P1  | **Role:** admin  | **Type:** happy
- **Preconditions:** Logged in (MD-001). Access token lifetime is 15 min by default.
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Any ERP page → press F5 | `POST /auth/refresh` (cookie) returns 200, then `GET /auth/me` returns 200. The page renders without going to /login. |
| 2 | Wait more than 15 min idle → click a list (e.g. /purchase/suppliers) | First call 401. Interceptor calls `/auth/refresh`, then retries the original call, which returns 200. Data loads. |
| 3 | Delete the `refresh_token` cookie → F5 | Refresh fails, the user is cleared, redirect to /login. |
- **Post-conditions / data checks:** Refresh creates no new `refresh_tokens` row (the refresh token is not rotated).

### MD-005 — Logout ends the session
- **Priority:** P1  | **Role:** admin  | **Type:** negative (security)
- **Preconditions:** Logged in.
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | TopBar avatar → Logout | Redirect to /login. `localStorage.tenant_id` removed. |
| 2 | Browser Back | ERP layout redirects to /login. |
| 3 | API → `POST /auth/refresh` with the old `refresh_token` cookie | **Expected:** 401. **Actual per code:** 200 with a fresh access token. There is no logout endpoint and no revocation (defect D-1). |
| 4 | Put `tenant_id` back in localStorage → F5 | **Expected:** stays logged out. **Actual per code:** session restored silently. |
- **Post-conditions / data checks:** The `refresh_tokens` row for the session still exists and is not revoked.

### MD-006 — Refresh with a malformed or expired token, or a deactivated user
- **Priority:** P2  | **Role:** any  | **Type:** negative
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | API → `POST /auth/refresh` body `{refresh_token:"garbage"}` | **Expected:** 401. **Actual per code:** 500 `INTERNAL_ERROR`, because `jwt.verify` throws a non-AppError (defect D-2). |
| 2 | API → no body, no cookie | 400 `Refresh token required`. |
| 3 | Deactivate the user (MD-042) → refresh with that user's valid cookie | 401 `User not found`. |

---

## B. Tenant config and currency

### MD-007 — GET /tenant/currency for every authenticated role
- **Priority:** P1  | **Role:** admin, cashier, warehouse_worker, customer (storefront)  | **Type:** permission
- **Preconditions:** Ledger BOB. Tenant language `es`, country `BO`.
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Log in as cashier → API `GET /tenant/currency` | 200 `{code:"BOB", symbol, rounding_precision, rounding_method, locale:"es-BO"}`. No plan, modules or branding. |
| 2 | Repeat as warehouse_worker and as a storefront `customer` | 200, same payload. `/tenant/currency` is on the storefront allow-list. |
| 3 | Without the Authorization header | 401 `No authorization token provided`. |
| 4 | ERP → any list showing money | Amounts render as `Bs` with es-BO formatting (e.g. `Bs 1.299,50`). |

### MD-008 — Read and update tenant config (language, country, timezone)
- **Priority:** P2  | **Role:** store_manager (maintain), auditor (read), cashier (refused)  | **Type:** happy / permission
- **Test data:** `PUT /tenant/config` `{ "language":"es", "country":"BO", "timezone":"America/La_Paz" }`
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | store_manager → `GET /tenant/config` | 200 with `id,name,slug,plan,modules,branding,language,timezone,country,currency{…,locale}`. |
| 2 | store_manager → PUT with the test data | 200 with the updated tenant. |
| 3 | auditor → GET, then PUT | GET 200. PUT 403 `Permission denied: setup.tenant.maintain`. |
| 4 | cashier → GET | 403 `Permission denied: setup.tenant.read`. |
- **Post-conditions / data checks:** There is no UI for this; verify on the API only. The audit log has a `PUT /api/v1/tenant/config` 200 row, and the 403 attempts are logged too.

### MD-009 — Invalid language and country refused
- **Priority:** P1  | **Role:** admin  | **Type:** negative / boundary
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | PUT `{language:"es_BO"}` | 400 `VALIDATION_ERROR`, `language: language must be a BCP 47 language tag, e.g. es or es-BO`. |
| 2 | PUT `{language:"e"}` | 400 (min length 2). |
| 3 | PUT `{language:"es-419-BO-x"}` (more than 10 characters) | 400 (max length 10). |
| 4 | PUT `{country:"bo"}` and then `{country:"BOL"}` | 400 `country: country must be a 2-letter ISO 3166-1 alpha-2 code`. |
| 5 | PUT `{modules:["pos"]}` and then `{currency_code:"USD"}` | 400, `Unrecognized key(s) in object` (strict schema). |
| 6 | PUT `{timezone:"Mars/Olympus"}` | **Expected:** 400. **Actual per code:** 200 accepted, because the timezone is not validated (defect D-17). |
| 7 | PUT `{language:"zz"}` | 200. It is syntactically valid BCP 47. Then `GET /tenant/currency` returns `locale` `zz-BO`. Record whether screens still render. |

### MD-010 — Tenant tax setup (legacy fallback) is an admin-only finance duty
- **Priority:** P2  | **Role:** admin, store_manager  | **Type:** permission / negative
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | admin → `PUT /tenant/setup` `{tax_config:{vat_rate:0.13,vat_inclusive:true,vat_label:"IVA",secondary_tax_rate:0.03,secondary_tax_name:"IT",invoice_label:"Factura"}}` | 200 `{id,tax_config}`. |
| 2 | admin → `vat_rate: 13` | 400 (max 1). |
| 3 | admin → add `currency_code:"BOB"` at the top level | 400 Unrecognized key. |
| 4 | store_manager → valid body | 403 `Permission denied: finance.setup.maintain`. |

---

## C. Setup: wizard, organisation, warehouse

### MD-011 — Setup wizard, Bolivia preset, on a fresh tenant
- **Priority:** P2  | **Role:** admin  | **Type:** happy
- **Preconditions:** Tenant created by the CLI with a BOB ledger. No sites, no warehouses, no chart of accounts.
- **Test data:** Business "Calzados Test", country Bolivia, warehouse "Almacén Central", city La Paz, type Retail
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /setup → read the readiness cards | Organisation card is blocking (Sites 0, Warehouses 0). Facts are shown as counts. |
| 2 | /setup/wizard step 0 → enter a name, pick Bolivia | Next is enabled only when the name is filled. Banner reads "Bolivia PCG template · BOB · 13% IVA". |
| 3 | Step 1 | BOB, VAT 13, IVA, inclusive checked, secondary 3 / IT, Invoice label "Factura". |
| 4 | Step 2 → Bolivia PCG selected; Step 3 → warehouse data; Step 4 → Finish | "Setup Complete!" screen. |
| 5 | /setup/organisation | Site `SITE-MAIN` ("Almacén Central Site", La Paz, BO) and warehouse `WH-MAIN`. |
| 6 | /warehouse/locations → WH-MAIN | Zones RCV, STG, SHP with 5 locations each (`RCV-001`…). STG locations are pick locations; RCV locations are receive locations. |
| 7 | /products/uom | 8 default units, including PAIR. |
- **Post-conditions / data checks:** `tenant.tax_config` is set. CoA accounts are created. The ledger is unchanged (BOB). The business name and country are not saved anywhere (gap G-4). The audit log has POSTs for `/finance/seed-coa`, `/uom/seed-defaults` and `/warehouse/setup`, and a PUT for `/tenant/setup`.

### MD-012 — Setup wizard negative paths
- **Priority:** P2  | **Role:** admin, store_manager  | **Type:** negative
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Step 1 → clear the currency (or type `US`) → go to the last step → Finish | Message "Choose the ledger currency (a three-letter ISO code)…". Wizard jumps back to step 1. |
| 2 | As store_manager → run the wizard to Finish | Error message `Permission denied: finance.setup.maintain` (from `/tenant/setup`). |
| 3 | Pick country "Other" → Finish with a warehouse | Tax, CoA and UoM steps succeed, then the page shows "country is required and must be a 2-letter ISO 3166-1 alpha-2 code…" (`SITE_COUNTRY_REQUIRED`). The earlier steps stay applied (partial run). |
| 4 | Run the wizard a second time on the MD-011 tenant | **Expected:** idempotent, or a clear "already set up" message. **Actual per code:** `SITE-MAIN` unique collision gives "Internal server error", and the earlier steps are already re-applied (defect D-14). |
| 5 | A tenant with posted transactions → pick Turkey (TRY) | "The ledger currency is BOB and can no longer change: transactions already exist." Nothing is written. |

### MD-013 — Create a site
- **Priority:** P1  | **Role:** admin; store_manager (refused)  | **Type:** happy / negative / permission
- **Test data:** code `SITE-SCZ`, name "Santa Cruz Store", city "Santa Cruz de la Sierra", country `BO`
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /setup/organisation → New site → fill in → Create | The site appears in the Sites list. |
| 2 | New site → leave City empty | Submit blocked with "A city is required — it is what the map geocodes." |
| 3 | New site → country `BOL` | 400 "country: country must be a 2-letter ISO 3166-1 alpha-2 code" shown in the dialog. |
| 4 | New site → country left blank | Sent as `BO` (UI fallback), 201. |
| 5 | New site → code `SITE-SCZ` again | **Expected:** 409. **Actual per code:** "Internal server error" (unique `[tenant_id, code]`, defect D-5). |
| 6 | store_manager → New site | 403 "Insufficient permissions". |
- **Post-conditions / data checks:** `sites` row has `country='BO'`. The audit log has POST `/api/v1/warehouse/sites` with statuses 201, 400, 500 and 403.

### MD-014 — Create a warehouse, and an operating unit
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / negative
- **Test data:** warehouse `WH-SCZ` in site SITE-SCZ, type Retail; operating unit `SALES`, "Sales", DEPARTMENT
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /setup/organisation → New warehouse, with no sites existing | Blocked: "No sites exist yet — create one first." |
| 2 | Fill in the test data → Create warehouse | 201. Listed under Warehouses with its site. |
| 3 | Repeat with the same code | **Actual per code:** "Internal server error" (D-5). |
| 4 | API `POST /warehouse/warehouses` `{code:"WH-X",name:"X"}` with no site | 422 "A warehouse must belong to a site. Pass site_id…" and the list of existing sites. |
| 5 | /warehouse/locations → New warehouse with "create site", country `bolivia` | **Expected:** refused. **Actual:** accepted (country is not validated on this path, D-13). |
| 6 | /setup/organisation → New operating unit → SALES | 201. Listed. |
| 7 | New operating unit with code SALES again | 409 `Operating unit code "SALES" already exists (as a DEPARTMENT). The number is unique across all operating units, not per type.` |
| 8 | cashier → API `POST /warehouse/warehouses` | 403 "Insufficient permissions". |
- **Post-conditions / data checks:** /setup readiness: Organisation is no longer blocking.

### MD-015 — Zones, a single location and bulk generation
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy / boundary
- **Test data:** zone `STG2` storage; location `A-01-01` with Pick checked; bulk segments with the defaults (Aisle 1–2 width 2 "-", Rack 1–3 width 2 "-", Shelf 1–3 width 2)
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /warehouse/locations → WH-SCZ → Add zone `STG2` | Zone listed with a location count of 0. |
| 2 | Zone → add a location `A-01-01` with Pick checked | Listed with the pick flag. |
| 3 | Zone → Generate → Preview | `dry_run`: total 18, will_create 18, sample `01-01-01`…, name length 8 of max 10. Nothing written. |
| 4 | Execute | 201 `created:18`. |
| 5 | Generate the same range again, then Execute | 200 `created:0`, "Every location in this range already exists." |
| 6 | Add segments so the name exceeds 10 characters | Preview disabled. |
| 7 | Add a location with code `A-01-01` again in the same zone | **Actual per code:** "Internal server error" (unique `[zone_id, code]`, D-5). |
| 8 | cashier → API `POST /warehouse/zones` | 403 "Insufficient permissions". |
- **Post-conditions / data checks:** Readiness Warehouse card shows Locations ≥ 19 and Pick locations ≥ 1.

---

## D. Number sequences

### MD-016 — Configure a number sequence and verify the next number
- **Priority:** P1  | **Role:** admin  | **Type:** happy
- **Preconditions:** `PURCHASE_ORDER` sequence provisioned and automatic. An active supplier and product exist.
- **Test data:** format `PO-{YYYY}-{#####}`, next number `500`
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /setup/numbering → PURCHASE_ORDER card → Format field → type the format → click outside the field | Saves on blur. Header "next:" shows `PO-2026-00500` once next number is set. |
| 2 | Next number → `500` → click outside | Saves. Preview `PO-2026-00500`. |
| 3 | Create a purchase order (/purchase/orders, or API `POST /purchase/orders`) | `po_number` = `PO-2026-00500`. |
| 4 | Reload /setup/numbering | Preview `PO-2026-00501`. |
| 5 | Continuous checkbox → toggle | Saves immediately. Disabled while the sequence is manual. |
- **Post-conditions / data checks:** `number_sequences.next_number` = 501. The audit log has `PUT /api/v1/setup/number-sequences/<id>` 200 with body `{format}` and body `{next_number:500}`.

### MD-017 — Invalid number-sequence changes refused
- **Priority:** P1  | **Role:** admin; store_manager  | **Type:** negative / boundary / permission
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Format `PO-{LE}-{####}` → blur | 400 `VALIDATION_ERROR`: `format: Unsupported format token {LE}. Only {YYYY} and a counter…`. |
| 2 | Format `PO-{###}-{###}` | 400 `format: A format may contain at most one counter token.` |
| 3 | Format `PO-{YYYY` | 400 `Malformed format: A '{' at position 4 is never closed.…` |
| 4 | Format `PO-{YYYY}` (no counter) on an automatic sequence | 400 code `NUMBER_SEQUENCE_FORMAT_INVALID` "An automatic sequence needs exactly one counter token…". |
| 5 | API `{next_number:0}`, then `{next_number:2147483648}` | 400 (min 1 / max 2147483647). |
| 6 | API `{manual:"false"}` | 400 (must be a boolean, no coercion). |
| 7 | API `{reference:"X"}` | 400 Unrecognized key. |
| 8 | API with an unknown UUID | 404 `Number sequence not found`. |
| 9 | store_manager → any PUT | 403 "Insufficient permissions". The page still loads for store_manager, because GET has no guard. |

### MD-018 — FACTURA: manual/automatic switch and resume guard
- **Priority:** P2  | **Role:** admin  | **Type:** boundary
- **Preconditions:** Facturas already issued; the highest numeric one is e.g. `120`.
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /setup/numbering → FACTURA card | Shows "Highest already issued: 120" and "Lowest safe next number: 121", plus the Android POS warning. |
| 2 | Tick "Numbers are entered by hand" | Saves `manual:true`. Header "next: — typed —". |
| 3 | Next number `100` | Red text "121 or higher is required… Not saved." No request is sent. |
| 4 | API `PUT {manual:false,next_number:100}` | 400 `NUMBER_SEQUENCE_BEHIND`. |
| 5 | If manually typed non-numeric facturas exist | Acknowledgement box. The switch stays disabled until it is ticked. The API without `acknowledge_unverifiable_resume:true` returns 400 `NUMBER_SEQUENCE_ACKNOWLEDGEMENT_REQUIRED`. |

---

## E. Currencies, exchange rates, chart of accounts

### MD-019 — Activate USD; activation negatives; rate types
- **Priority:** P1  | **Role:** admin; store_manager  | **Type:** happy / negative / permission
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /setup/finance/currencies | Ledger panel: Accounting BOB, Reporting BOB, rate type BCB, "Posting date". BOB row "Active · ledger" with no Deactivate button. |
| 2 | Activate currency → USD, symbol `$` → Activate | USD row active, rounding `0.01 · NEAREST`. |
| 3 | API `POST /finance/currencies {currency_code:"USD"}` again | 409 `CURRENCY_EXISTS` "USD is already set up for this tenant." |
| 4 | API `{currency_code:"XXQ"}`, `{currency_code:"usd"}`, `{currency_code:"KWD"}` | 422 `CURRENCY_UNKNOWN`; 400 `must be a 3-letter uppercase code`; 422 `CURRENCY_PRECISION_UNSUPPORTED`. KWD is also hidden from the dropdown. |
| 5 | New rate type → code `bcb-venta` | Input is upper-cased. `BCB VENTA` (with a space) is blocked: "Use uppercase letters, digits, _ or -." |
| 6 | New rate type with an existing code | 409 `RATE_TYPE_EXISTS`. |
| 7 | store_manager → Activate currency | 403 `Permission denied: finance.setup.maintain`. |

### MD-020 — BOB stays the ledger default and locks once used
- **Priority:** P1  | **Role:** admin  | **Type:** negative
- **Preconditions:** At least one posted voucher, cost layer or payable exists.
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Currencies → Ledger panel | Lock note: "Transactions have been posted, so the ledger's currencies can no longer change." |
| 2 | Change → accounting USD | Save blocked: "Transactions have been posted; the accounting currency can no longer change." |
| 3 | API `PUT /finance/ledger-currencies` with USD/USD | 409 `CURRENCY_LOCKED`. |
| 4 | API with accounting BOB, reporting USD | 422 `REPORTING_CURRENCY_UNSUPPORTED`. |
| 5 | API with `exchange_rate_date_basis:"DOCUMENT_DATE"` | 422 `EXCHANGE_RATE_DATE_BASIS_UNSUPPORTED`. |
| 6 | API `PUT /finance/currencies/BOB {is_active:false}` | 409 `CURRENCY_IN_USE_BY_LEDGER`. |
| 7 | API deactivate rate type BCB | 409 `RATE_TYPE_IN_USE_BY_LEDGER`. |

### MD-021 — Add a USD→BOB exchange rate
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy
- **Test data:** rate type BCB, USD → BOB, valid from today, rate `6.96`, factor 1
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /finance/exchange-rates | Rate type selector defaults to BCB "(ledger)". |
| 2 | Add rate → From USD, To BOB (default), rate 6.96 → Add rate | Row: today, USD, BOB, 6.96, Per 1, Source MANUAL. |
| 3 | API `GET /finance/exchange-rates/resolve?rate_type_id=<BCB>&from=USD&to=BOB&date=<today>` | `kind:DIRECT`, rate "6.96", `one_unit` "6.96". |
| 4 | Resolve from=BOB to=USD | `kind:RECIPROCAL`, `one_unit` ≈ 0.14367816. |
| 5 | Resolve with a date before valid_from | 422 `EXCHANGE_RATE_MISSING`. |
- **Post-conditions / data checks:** `exchange_rate_currency_pairs` row USD→BOB factor 1. `exchange_rates.created_by` = store_manager id. The audit log has a POST 201.

### MD-022 — Exchange-rate negatives
- **Priority:** P1  | **Role:** store_manager, admin  | **Type:** negative / boundary
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Add rate From USD, To USD | Blocked: "Choose two different currencies." |
| 2 | Rate `0`, factor `1.5` | Blocked: "The rate must be greater than zero." / "The factor must be a positive whole number." |
| 3 | store_manager → USD→BOB with valid_from = yesterday (before the latest rate) | 409 `EXCHANGE_RATE_BACKDATED`. |
| 4 | admin → USD→BOB on the same date as MD-021 | 409 `EXCHANGE_RATE_EXISTS`. |
| 5 | Add BOB→USD (reverse direction) | 409 `RECIPROCAL_PAIR_EXISTS`. |
| 6 | API with valid_from `2026-02-30` | 400 `INVALID_DATE`. |
| 7 | EUR set up but inactive → EUR→BOB | 422 `CURRENCY_INACTIVE`. |
| 8 | API USD→BOB with `conversion_factor:100` | 409 `CONVERSION_FACTOR_MISMATCH`. |
| 9 | cashier → `GET /finance/exchange-rates` | 403 `Permission denied: finance.currency.read`. |

### MD-023 — Correct an existing rate
- **Priority:** P2  | **Role:** admin; store_manager  | **Type:** permission / happy
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | store_manager → row → Correct → 6.97 → Save | 403 `Permission denied: finance.setup.maintain` shown in the dialog. The button is visible to every role. |
| 2 | admin → Correct → 6.97 | 200. Row shows 6.97. |
| 3 | DB `audit_logs` where `path = 'exchange_rates/<id>'` | Body has `action:EXCHANGE_RATE_CORRECTED`, `before:"6.96"`, `after:"6.97"`. Not visible on /audit, which does not return `body` (G-6). |

### MD-024 — Chart of accounts templates
- **Priority:** P2  | **Role:** admin; store_manager  | **Type:** happy / permission
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /finance/coa-templates | Templates listed with country and currency (e.g. Bolivia PCG · BO · BOB). |
| 2 | Seed Accounts (Bolivia PCG) on a tenant with no CoA | "✓ Bolivia PCG: N accounts created, 0 skipped". |
| 3 | Seed again | "0 accounts created, N skipped". |
| 4 | store_manager → Seed | "Error: Permission denied: finance.setup.maintain". |

---

## F. Products

### MD-025 — Categories and units of measure
- **Priority:** P2  | **Role:** store_manager; cashier  | **Type:** happy / negative / permission
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /products/categories → name "Zapatillas Deportivas", code blank → Create | Created with code `ZAPATILLAS-DEPORTIVAS`. |
| 2 | Create the same again | **Actual per code:** "Internal server error" (unique `[tenant_id, code]`, D-5). |
| 3 | cashier → API `POST /products/categories` | 403 "Insufficient permissions". |
| 4 | /products/uom → Seed defaults | "Default units seeded." PAIR and PCS present. |
| 5 | Add a UoM `pair` / Pairs / pair | Message `UoM code "pair" already exists` (409, compared upper-cased). |
| 6 | cashier → API `POST /uom {code:"DOZ",name:"Dozen",symbol:"dz"}` | **Expected:** 403. **Actual:** 201, because UoM routes have no guard (D-10). |

### MD-026 — Variant types Size and Colour
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy
- **Test data:** "Talla" with values 38, 39, 40; "Color" with values Negro, Café
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /products/variants → new type Talla → type each value + Enter → Save | Type listed with 3 values. |
| 2 | Same for Color | Listed with 2 values. |
| 3 | Save with an empty name | Error "name is required" (400). The page may show "Failed to save" because it reads `data.message`. |

### MD-027 — Create a shoe product with variants, UoM, category, price and cost
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy
- **Test data:** name "Zapatilla Runner 270", SKU `RUN-270`, brand "Quberty", category Zapatillas Deportivas, type Physical, UoM Pairs, cost 180.00, selling 349.90, sale price blank, published off; variants Talla × Color
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /products/new → fill in the product fields | Price labels show `(BOB)`. |
| 2 | Variants → Auto-generate from Talla + Color | 6 rows, `sku_variant` like `RUN-270-38-NEGRO` … `RUN-270-40-CAFÉ`. |
| 3 | Set a barcode on row 1 (`7771234500011`) → Create Product | Redirect to /products/<id>. |
| 4 | Detail page | Name, SKU, category, UoM, cost 180, price 349.90. 6 active variants, each with `available_stock 0`. |
| 5 | /products list | Row RUN-270, "Unlisted" on the E-Commerce column. |
- **Post-conditions / data checks:** `products` row; `product_variants` ×6 with `attributes {Talla, Color}`. The `size`/`color` columns stay NULL (deprecated). Audit log has 1 POST `/products` and 6 POSTs `/products/<id>/variants`. Readiness: "Products with an item group" does not count it yet.

### MD-028 — Product validation and permissions
- **Priority:** P1  | **Role:** store_manager, cashier  | **Type:** negative / boundary / permission
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /products/new → name blank | Browser `required` blocks submit. |
| 2 | API `POST /products {name:"X",sku:"X-1",selling_price:0}` | 400 `name, sku and selling_price are required`. A price of 0 is refused. |
| 3 | API with `selling_price:-10` | **Expected:** 400. **Actual:** 201 (no range check, D-9). |
| 4 | Create with SKU `RUN-270` again | **Actual per code:** "Internal server error" (unique `[tenant_id, sku]`, D-5). |
| 5 | Create with a new SKU but a variant `sku_variant` that already belongs to RUN-270 | **Actual per code:** the existing variant is moved to the new product (upsert by `sku_variant`, D-8). Verify RUN-270 has lost a variant. |
| 6 | cashier → API `POST /products` | 403 "Insufficient permissions". |
| 7 | store_manager → API `DELETE /products/<id>` | 403. Only admin can soft-delete. |

### MD-029 — Barcode lookup
- **Priority:** P2  | **Role:** cashier  | **Type:** happy / negative
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | cashier → API `GET /products/barcode/7771234500011` | 200 with the RUN-270 product and the matching variant. |
| 2 | admin → API `PUT /products/<id> {barcode:"7770000000009"}` | 200. There is no product-level barcode field in the form (G-3). |
| 3 | GET by that barcode | Product found. |
| 4 | Give a second product the same barcode, then look it up | **Expected:** refused or unambiguous. **Actual:** accepted, and the lookup returns an arbitrary product (no unique constraint, D-8). |
| 5 | GET `/products/barcode/000` | 404 `No product found for this barcode`. |

### MD-030 — Publish and unpublish
- **Priority:** P1  | **Role:** store_manager; storefront customer  | **Type:** happy / permission
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /products → RUN-270 → click the "Unlisted" toggle | Becomes "Listed". PUT `{is_published:true}` 200. |
| 2 | Storefront (/store) as a guest/customer | RUN-270 visible. API `GET /products/<id>` as customer has no `cost_price`. |
| 3 | Select 2 products → bulk Unpublish | Bulk bar returns `affected:2`. Both Unlisted. |
| 4 | Customer → `GET /products/<RUN-270 id>` | 404 `Product not found`. |
| 5 | store_manager → select → Delete → confirm | 403 `Only admins can bulk-delete products`. |
| 6 | admin → bulk delete | Soft delete: `is_active=false`, `is_published=false`. |
| 7 | Filter panel E-Commerce = Listed | Only published rows. The filter is applied client-side to the first 100 rows only. |

---

## G. Customers (API only — no UI create or edit)

### MD-031 — Create a customer (happy path, auto code)
- **Priority:** P1  | **Role:** store_manager  | **Type:** happy
- **Preconditions:** Note the highest existing `CUST-nnnnn` (e.g. CUST-00041).
- **Test data:** `POST /customers {first_name:"María",last_name:"Quispe",email:"mq@test.bo",phone:"+59170000000",city:"La Paz",country:"BO",date_of_birth:"1990-05-13",tax_id:"1234567"}`
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /sales/customers → click "New Customer" | **Expected:** create form. **Actual:** nothing happens (defect D-4). Continue on the API. |
| 2 | API POST with the test data | 201. `code` = `CUST-00042`. `segment` default. `total_orders` 0. |
| 3 | /sales/customers → search "Quispe" | Row visible: Code CUST-00042, LTV `Bs 0,00`. |
| 4 | Search "CUST-00042" | Not found. Search only covers first name, last name and email (G-7). |
- **Post-conditions / data checks:** Audit log has POST `/api/v1/customers` 201 by store_manager. The stored `body` has no sensitive keys.

### MD-032 — Customer: missing or invalid fields
- **Priority:** P1  | **Role:** admin  | **Type:** negative / boundary
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | POST `{first_name:"A"}` | 400 `VALIDATION_ERROR`, `last_name: Required`. |
| 2 | POST `{first_name:"",last_name:"B"}` | 400 on `first_name` (min 1). |
| 3 | POST `{…, email:"not-an-email"}` | 400 `email: Invalid email`. |
| 4 | POST `{…, date_of_birth:"13/05/1990"}` | 400 `date_of_birth must be YYYY-MM-DD`. |
| 5 | POST `{…, lifetime_value:9999}` or `{…, tenant_id:"<other>"}` | 400 Unrecognized key(s). |
| 6 | POST `{…, first_name: 121 characters}` | 400 (max 120). |
| 7 | POST `{…, tax_group_id:"<uuid from another tenant>"}` | 422 `FOREIGN_REFERENCE` "Unknown reference for this tenant: …". |

### MD-033 — Duplicate customer and code continuity across gaps
- **Priority:** P1  | **Role:** admin  | **Type:** negative / boundary
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | POST with the same email as MD-031 and no code | 201. Duplicate email is allowed (no unique constraint); next code CUST-00043. |
| 2 | POST with `code:"CUST-00042"` | **Expected:** 409. **Actual per code:** 500 "Internal server error" (D-5). |
| 3 | POST with `code:"CUST-00100"` (manual gap) | 201. |
| 4 | POST with no code | `CUST-00101`. The sequence continues from the highest value, not the count. |
| 5 | POST with `code:"VIP-7"`, then POST with no code | `CUST-00102`. Non-`CUST-` codes are ignored. |
| 6 | POST with `code:"CUST-7"` (unpadded) | Accepted and counted as 7. It does not affect the next code. |
| 7 | "Deletion" check: there is no DELETE route. With DB access, delete the CUST-00102 row, then POST with no code | `CUST-00102` is **reused**. A MAX-based code reuses the top value after a hard delete. Record the result (G-8). |

### MD-034 — Edit a customer
- **Priority:** P2  | **Role:** store_manager  | **Type:** happy / negative
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `PUT /customers/<id> {city:"Cochabamba",segment:"vip"}` | 200 `data:null`. GET `/customers/<id>` shows the new city and segment and an updated `updated_at`. |
| 2 | PUT `{code:"CUST-00041"}` (another customer's code) | **Actual:** 500 (D-5). |
| 3 | PUT on a random UUID | **Expected:** 404. **Actual:** 200 (updateMany count not checked, D-6). |
| 4 | GET on a random UUID | **Expected:** 404. **Actual:** 200 `data:null` (D-6). |
| 5 | PUT `{first_name:""}` | 400 on `first_name`. |

### MD-035 — Customer permissions by role
- **Priority:** P1  | **Role:** every role  | **Type:** permission
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | cashier → POST /customers (valid) | 201. Cashier holds `customer.create`. |
| 2 | employee → GET /customers, then POST | GET 200. POST 403 `Permission denied: customer.create`. |
| 3 | auditor → GET, then PUT | GET 200. PUT 403 `Permission denied: customer.update`. |
| 4 | cashier → PUT /customers/<id> | 403 `Permission denied: customer.update`. |
| 5 | warehouse_worker, buyer, ap_clerk → GET /customers | 403 `Permission denied: customer.read`. |
| 6 | employee → GET /customers/<id>/orders | 200 (has both customer.read and sales.order.read). cashier → 403 `Permission denied: sales.order.read`. |
| 7 | storefront `customer` token → GET /customers | 403 `This area is not available to storefront accounts`. |
| 8 | cashier → GET /customers/segments | 403 `Permission denied: report.sales.read`. |

---

## H. Suppliers and payment methods

### MD-036 — Create a supplier with currency and payment terms
- **Priority:** P1  | **Role:** buyer  | **Type:** happy
- **Preconditions:** USD active (MD-019).
- **Test data:** code `SUP-010`, name "Calzados Andinos SRL", contact "Juan Mamani", email `ventas@andinos.bo`, city El Alto, country `BO`, terms 60, currency USD
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /purchase/suppliers → New Supplier | Currency defaults to BOB. Dropdown lists active currencies (BOB, USD). Terms options 7/14/30/45/60/90. |
| 2 | Fill in → Save Supplier | Row: name, `SUP-010`, contact, email, city, "60 days". |
| 3 | API GET /purchase/suppliers | `currency:"USD"`, `payment_terms:60`. |
- **Post-conditions / data checks:** Audit log POST `/api/v1/purchase/suppliers` 201 with `body` null. The POST route does not use `validate`, so no body is captured (G-6).

### MD-037 — Supplier negatives
- **Priority:** P1  | **Role:** buyer, ap_clerk  | **Type:** negative / boundary / permission
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | New Supplier with code blank | Save button disabled. |
| 2 | Save with code `SUP-010` again | **Expected:** 409 with a message. **Actual:** 500. UI shows "Failed to save supplier" (D-3, D-5). |
| 3 | API POST `{code:"S2",name:"S2",currency:"EUR"}` with EUR inactive | 422 `CURRENCY_INACTIVE` "Currency EUR is not active for this tenant." UI would show the generic message. |
| 4 | API POST `{code:"S3",name:"S3",payment_terms:0}` | **Expected:** stored 0 (cash on delivery). **Actual:** stored 30 (D-11). |
| 5 | API POST `{code:"S4",name:"S4",email:"bad",country:"Bolivia"}` | **Actual:** 201 accepted. The create path has no schema (D-11). |
| 6 | ap_clerk → New Supplier → Save | 403 `Permission denied: purchase.supplier.maintain`. UI shows "Failed to save supplier". |
| 7 | receiver → /purchase/suppliers | List call 403 `Permission denied: purchase.supplier.read`. |

### MD-038 — Edit a supplier
- **Priority:** P1  | **Role:** buyer  | **Type:** happy / negative
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Edit SUP-010 → terms 90 → Save | 200. Row shows "90 days". |
| 2 | Edit a supplier that has **no email** → change the name → Save | **Expected:** 200. **Actual:** 400 `VALIDATION_ERROR` `email: Invalid email`, because the form sends `""` and `.email()` rejects it. UI shows "Failed to save supplier" (D-12). |
| 3 | API PUT `{payment_terms:366}` | 400 (max 365). |
| 4 | API PUT `{tenant_id:"x"}` | 400 Unrecognized key. |
| 5 | API PUT on an unknown id | 404 `SUPPLIER_NOT_FOUND`. |
| 6 | API PUT `{is_active:false}` | 200. Supplier disappears from the list (list returns active only; there is no UI to reactivate). |

### MD-039 — Vendor payment methods
- **Priority:** P2  | **Role:** buyer; ap_clerk  | **Type:** happy / negative / permission
- **Test data:** code `bnb-usd`, name "BNB cuenta USD", type BANK, offset account = bank account (e.g. 1102), allowed currency `usd`
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /purchase/setup/payment-methods → New method with no account | Blocked: "Select the cash or bank ledger account." |
| 2 | Fill in the test data → Save method | Row `BNB-USD`, Currency `USD` (both upper-cased). |
| 3 | Edit the row | Code and Type are disabled. Active checkbox is shown. |
| 4 | New method with allowed currency `XYZ` | **Actual:** accepted (not checked against tenant currencies, D-11). |
| 5 | Same code again | **Actual per code:** 500 (unique `[tenant_id, legal_entity_id, code]`, D-5). |
| 6 | ap_clerk → New method → Save | 403 `Permission denied: purchase.setup.maintain`. The list loads (ap_clerk has purchase.setup.read). |
- **Note:** the offset-account dropdown calls `GET /finance/accounts`. Record whether buyer gets data there (not verified).

---

## I. HR: users, roles, payroll

### MD-040 — Create one system user per role, then log in as each
- **Priority:** P1  | **Role:** admin  | **Type:** happy / permission
- **Test data:** For each role in {employee, warehouse_worker, store_manager, admin, cashier, purchasing_requester, buyer, receiver, ap_clerk, finance_approver, auditor}: first name "QA", last name = role, email `qa.<role>@test.bo`, password `Test1234!`
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /hr → New Employee → fill in, Role = role → Create Employee | Modal closes. Row: code `EMP-000n` (running count + 1), role badge, Active. |
| 2 | Repeat for all 11 roles | 11 rows. Codes are consecutive. |
| 3 | Log out → log in as each user | Each login succeeds and lands on /dashboard. The sidebar does **not** filter menus by role (G-5). |
| 4 | For each role, run the probe calls in the table below | Results match the table. |

| Role | Allowed probe (expect 2xx) | Refused probe (expect 403 message) |
|---|---|---|
| admin | GET /audit | — |
| store_manager | POST /customers; PUT /tenant/config | PUT /setup/number-sequences/:id → `Insufficient permissions`; GET /audit → `Insufficient permissions` |
| cashier | POST /customers; GET /tenant/currency | GET /purchase/suppliers → `Permission denied: purchase.supplier.read` |
| employee | GET /customers | POST /customers → `Permission denied: customer.create` |
| warehouse_worker | GET /products | GET /customers → `Permission denied: customer.read` |
| purchasing_requester | GET /products | GET /purchase/suppliers → `…purchase.supplier.read` |
| buyer | POST /purchase/suppliers; GET /finance/currencies | POST /finance/exchange-rates → `…finance.exchange_rate.maintain` |
| receiver | GET /purchase/orders | GET /purchase/suppliers → `…purchase.supplier.read` |
| ap_clerk | GET /purchase/suppliers | POST /purchase/suppliers → `…purchase.supplier.maintain` |
| finance_approver | POST /finance/exchange-rates | PUT /finance/exchange-rates/:id → `…finance.setup.maintain` |
| auditor | GET /tenant/config; GET /customers | PUT /tenant/config → `…setup.tenant.maintain`; GET /audit → `Insufficient permissions` |
- **Post-conditions / data checks:** `users.role` matches. `employees.user_id` is linked. Each user's `last_login_at` is set. The audit log has 11 POST `/api/v1/hr/employees` 201 rows with `body` null (no `validate`), and every refused probe appears with 403.

### MD-041 — Employee creation negatives and segregation of duties
- **Priority:** P1  | **Role:** store_manager, admin  | **Type:** negative / permission
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | store_manager → New Employee, role Administrator | 403 `Only an admin can create an admin user`. |
| 2 | store_manager → role Finance Approver | **Actual:** 201. A store manager can grant permissions they do not hold themselves, such as `purchase.vendor_payment.post` (D-15). |
| 3 | admin → email `qa.cashier@test.bo` again | **Expected:** 409. **Actual:** 500 (unique `[tenant_id, email]`, D-5). |
| 4 | admin → email filled, password blank | **Expected:** 400 "Password is required…" (CreateEmployeeSchema). **Actual:** 201, an employee with no login is created silently. The schema is not wired in (D-7). |
| 5 | admin → password `123` | **Expected:** 400 (min 8). **Actual:** 201 (D-7). |
| 6 | API `POST /hr/employees {first_name:"X",last_name:"Y",role:"superuser"}` | 400 `Invalid employee role`. |
| 7 | employee, cashier, auditor → GET /hr/employees | 403 `Insufficient permissions`. |
| 8 | API `POST /hr/employees {first_name:"X",last_name:"Y",foo:1}` | **Actual:** 500. The unknown field is spread into Prisma (D-7). |

### MD-042 — Change a role and deactivate a user (API only)
- **Priority:** P2  | **Role:** admin  | **Type:** happy / negative
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | `GET /hr/users` | Lists every user with role, is_active and last_login_at. |
| 2 | `PUT /hr/users/<qa.employee id>/role {role:"cashier"}` | 200. The user logs in again and the JWT carries `cashier`; POST /customers now 201. |
| 3 | PUT role `{role:"owner"}` | 400 `Invalid role`. |
| 4 | `PUT /hr/users/<id>/deactivate` | 200. The next login returns 401 `Invalid credentials`. |
| 5 | Using that user's still-unexpired access token → GET /customers | **Actual:** 200 until the token expires (up to 15 min). Record the result. |
| 6 | store_manager → PUT role | 403 `Insufficient permissions`. |
| 7 | admin → demote their own account to `employee` | **Actual:** 200. There is no last-admin guard (D-15). |

### MD-043 — Run monthly payroll
- **Priority:** P2  | **Role:** admin; store_manager  | **Type:** happy / negative
- **Preconditions:** PAYROLL_EXPENSE, PAYROLL_PAYABLE and PAYROLL_DEDUCTION_PAYABLE posting profiles configured. Employees exist.
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /hr/payroll → Year 2026, Month September → gross 3000 / deductions 381 for 2 employees → Run | Success "Payroll 2026-09 processed. 2 employees, total gross Bs 6.000,00." |
| 2 | Payroll history | Journal entry "Planilla de Sueldos 2026-09". Debits split by department/site. Cr payable 5238, Cr deductions 762. Entry is balanced. |
| 3 | Run the same month again | 409 `Payroll for 2026-09 already processed (JE <number>).` |
| 4 | Tenant without payroll profiles → Run | 500 `Payroll for 2026-09 cannot be posted: payroll posting profiles are not configured.` |
| 5 | store_manager → /hr/payroll | Employees load. Payroll history call 403 `Insufficient permissions`. |
- **Note:** the page subtitle hard-codes "Dr 5201 / Cr 2201" (D-18).

---

## J. Data import

### MD-044 — Import a customers CSV (happy path)
- **Priority:** P1  | **Role:** admin  | **Type:** happy
- **Test data:** `customers.csv` with header `Nombre,Apellido,Correo,Ciudad` and 3 data rows
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /import → type Customers → upload the CSV | Step "map". Detected headers are listed. |
| 2 | Map Nombre→first_name, Apellido→last_name, Correo→email, Ciudad→city → save the mapping | Step "validate". |
| 3 | Validate | Status VALID. Step "execute". **Note:** `valid_rows` is always 0, because only the mapping is checked, not the rows. |
| 4 | Execute Import | Job history shows COMPLETED. |
| 5 | GET /customers?search=<a row's last name> | **Expected:** 3 new customers with codes `CUST-…`. **Actual per code:** 0 created. The executor only logs, and the file is never stored (D-16). |
- **Post-conditions / data checks:** `import_jobs` row: total_rows 3, status COMPLETED, `file_url` ''. The audit log has 4 POST `/api/v1/import/...` rows.

### MD-045 — Import CSV: invalid inputs and permissions
- **Priority:** P1  | **Role:** admin, store_manager, cashier  | **Type:** negative / permission
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | Upload a CSV with a header row only | **Expected:** error "File must have at least a header row and one data row" (400). **Actual in UI:** nothing happens; the upload mutation has no error handler (D-16). |
| 2 | Customers: map only first_name → Validate | INVALID with the error `Required field 'last_name' is not mapped`. The UI stays on validate. |
| 3 | Products: map sku and name but not selling_price | INVALID `Required field 'selling_price' is not mapped`. |
| 4 | Row with first_name blank or email "x" → Validate | **Expected:** row-level errors. **Actual:** VALID (no row validation, D-16). |
| 5 | API upload with `import_type:"suppliers"`, then validate | **Actual:** validate throws `Unknown import type: suppliers` after the status is set to VALIDATING. The job is stuck, and later mapping saves are refused (D-16). |
| 6 | store_manager → Execute | 403 `Insufficient permissions` (execute is admin-only). The UI shows no error. |
| 7 | cashier → Upload | 403 `Insufficient permissions`. |
| 8 | Execute a job that is not VALID (API) | 400 `Job must be validated before executing`. |

---

## K. Audit log

### MD-046 — Audit log shows the changes made above
- **Priority:** P1  | **Role:** admin; auditor  | **Type:** happy / permission
- **Preconditions:** MD-013 to MD-045 have been executed.
| # | Step (screen → action) | Expected result |
|---|---|---|
| 1 | /audit | Rows newest first: time, user email and role, method badge, path, status (colour-coded), duration. 50 per page. |
| 2 | Method = POST, search `/customers` | Only customer POSTs: 201 by store_manager and cashier, 403 by employee, 400 validation failures, 500 duplicates. |
| 3 | Search `qa.buyer@test.bo` | Supplier POST and PUT by buyer, plus the refused exchange-rate POST (403). |
| 4 | Filter PUT, search `number-sequences` | MD-016/017 rows, including 400s. |
| 5 | Check that GETs and logins are absent | No GET rows. No `/auth/login` rows. Requests refused with 401 by the auth middleware do not appear. |
| 6 | auditor → /audit | **Expected** (auditor role): read access. **Actual:** 403 `Insufficient permissions`, and the page shows an empty or error state (G-6). |
| 7 | Cross-tenant check: an admin of tenant B → /audit | No tenant-A rows. |
- **Post-conditions / data checks:** In the DB, `audit_logs.body` is filled only for routes using `validate()` (customers, supplier PUT, tenant, currencies, number sequences). Keys `password`, `pin`, `token` and `secret` are masked `***`. The UI never shows the body.

---

## Suspected defects / gaps found while reading code

| ID | Severity | Finding | Reference |
|---|---|---|---|
| D-1 | High | Logout is client-only. The refresh token is not revoked or rotated, and `/auth/refresh` never checks the stored `refresh_tokens` hash. Setting `tenant_id` back in localStorage restores the session. | `frontend/src/stores/authStore.ts:56`; `backend/src/modules/auth/auth.routes.ts:145-164` |
| D-2 | Med | A malformed or expired refresh token gives 500 `INTERNAL_ERROR` instead of 401 (`jwt.verify` throws outside AppError). The refresh also does not check that the tenant is still active. | `auth.routes.ts:151`; `shared/middleware/errorHandler.ts:11` |
| D-3 | Med | Several pages read `err.response.data.message`, but the envelope is `data.error.message`, so users always see a generic message. Affected: login (rate limit also shows "Invalid email or password"), suppliers, variant types. | `app/login/page.tsx:28`; `purchase/suppliers/page.tsx:94`; `products/variants/page.tsx:69` |
| D-4 | High | The Customers page has no create or edit flow: "New Customer" has no `onClick`. | `app/(erp)/sales/customers/page.tsx:61` |
| D-5 | Med | Prisma P2002 (unique violation) is not mapped, so duplicates return 500 "Internal server error". Affects customer code, supplier code, SKU, category code, site/warehouse/location code, user email and payment-method code. Only `dimension.service.ts:214` handles P2002. | `shared/middleware/errorHandler.ts:10-29` |
| D-6 | Low | `GET /customers/:id` returns 200 `null` for an unknown id. `PUT /customers/:id` returns 200 when nothing was updated. The same updateMany pattern is used in product PUT, variant PUT and variant-type PUT. | `modules/customers/customer.routes.ts:80-94` |
| D-7 | High | `POST /hr/employees` ignores `CreateEmployeeSchema`: no email check, no min-8 password, "email without password" creates no login silently, and `...employeeData` is spread into Prisma (unknown key gives 500). `PUT /hr/employees/:id` spreads the body, so `tenant_id`, `user_id` and `employee_code` are writable (cross-tenant move). `employee_code` uses count + 1 (collides under concurrency). User and employee inserts are not in one transaction (orphan user if the employee insert fails). | `modules/hr/hr.routes.ts:53-80, 87-96` |
| D-8 | Med | `POST /products/:id/variants` upserts by `sku_variant` across the tenant and reassigns `product_id`, so a variant can be moved silently from another product. Product and variant barcodes are not unique, so barcode lookup returns an arbitrary match. | `modules/inventory/product.routes.ts:549-583, 110-140` |
| D-9 | Med | Product create/update has no schema: negative or NaN prices accepted, `selling_price` 0 refused, `category_id`/`uom_id` not tenant-checked, PUT accepts any `images`/`is_active`. | `product.routes.ts:209-240, 242-270` |
| D-10 | Med | UoM routes have no role guard (any workforce role can create, rename, deactivate or seed). Variant-type DELETE is a hard delete. `/products/barcode/:code` and the warehouse/setup GET routes have no permission check. | `modules/inventory/uom.routes.ts:19,40,55`; `variant-types.routes.ts:32` |
| D-11 | Med | `POST /purchase/suppliers` has no schema: no email or country check, and `payment_terms:0` is stored as 30. Payment methods: `allowed_currency` is not checked against active tenant currencies. | `modules/purchase/purchase.routes.ts:92-111` (105); `vendorPayment.routes.ts:85` |
| D-12 | Med | Editing a supplier without an email fails validation: the UI sends `email:""` and the schema requires a valid email or null. | `shared/schemas/index.ts:268`; `purchase/suppliers/page.tsx:89-91` |
| D-13 | High | Foreign keys are not checked against the tenant: `site_id` on warehouse create, `warehouse_id` on zone create, `zone_id` on location create, `parent_id`/`manager_employee_id` on operating-unit create. The create-site branch of warehouse create does not validate `site_country`. | `modules/warehouse/warehouse.routes.ts:173,182,206-215,231-248`; `modules/setup/setup.routes.ts:108` |
| D-14 | Med | `POST /warehouse/setup` is not idempotent and not transactional (fixed codes `SITE-MAIN`/`WH-MAIN`). A second wizard run gives 500 after tax/CoA/UoM steps have already been applied. The wizard also has no rollback. | `warehouse.routes.ts:437-488` (453); `app/(erp)/setup/wizard/page.tsx:120-190` |
| D-15 | Med | Segregation of duties: store_manager can create users with roles holding permissions store_manager lacks (finance_approver, ap_clerk). `PUT /hr/users/:id/role` has no last-admin or self-demotion guard and allows assigning `customer`. | `hr.routes.ts:25-31, 53-61` |
| D-16 | High | Data import is a stub. The file is not stored (`file_url:''`). Executors only log, yet the job is marked COMPLETED. Validation checks only the mapping (`valid_rows` always 0; orders always VALID). An unknown import type leaves the job stuck in VALIDATING. The UI has no error handlers on upload/mapping/validate/execute. | `modules/import/import.service.ts:20-40, 58-90, 64, 72, 177-199`; `app/(erp)/import/page.tsx:39-68` |
| D-17 | Low | Tenant `timezone` is free text (not validated as IANA). `language` accepts any well-formed BCP 47 tag (e.g. `zz`). | `shared/schemas/index.ts:318-321` |
| D-18 | Low | The payroll page hard-codes "Dr 5201 / Cr 2201", while posting is profile-driven. Payroll lines are not validated (negative gross accepted). The duplicate-month check matches on description text. | `app/(erp)/hr/payroll/page.tsx:78`; `hr.routes.ts:145-160` |
| D-19 | Low | Login without a tenant picks the first active user with that email (`findFirst`), which is ambiguous when the same email exists in two tenants. The ERP login page never sends `tenant_slug`. The rate-limit key falls back to `'local'`, so all clients without `X-Forwarded-For` share one 10-per-15-min bucket. | `auth.routes.ts:39`; `app.ts:106,123` |
| G-1 | Gap | The ERP accepts a storefront `customer` token at /login and renders the ERP shell. Every API call is then refused by the workforce gate. There is no role check at login or in the layout. | `app/(erp)/layout.tsx:9-18` |
| G-2 | Gap | There is no UI to configure the ledger when none exists: the "Change" button renders only when the ledger exists, and the wizard's first call throws `LEDGER_CURRENCY_NOT_CONFIGURED`. The ledger can only be bootstrapped through `scripts/createTenant.ts`. | `setup/finance/currencies/page.tsx:97`; `setup/wizard/page.tsx:129` |
| G-3 | Gap | Product-level barcode has no form field (only variants have one). There is no UI for tenant config (language/country), user role change or user deactivation. | `components/erp/products/ProductForm.tsx:306-321` |
| G-4 | Gap | The wizard's Business name and Country are shown but never saved (no `PUT /tenant/config`). | `setup/wizard/page.tsx:61,235,427` |
| G-5 | Gap | The sidebar does not filter menus by role, so users see pages whose APIs return 403. | `components/erp/Sidebar.tsx` (no role usage) |
| G-6 | Gap | The audit list is admin-only (`requireRole('admin')`) despite an `auditor` role. The list does not return `body`, so field-level changes (including rate corrections) are not visible. Bodies are captured only for routes using `validate()`. | `modules/audit/audit.routes.ts:11,32-35`; `shared/middleware/auditLog.ts:37` |
| G-7 | Gap | Customer search does not include `code`. The search term is not URL-encoded. | `customer.routes.ts:38-43`; `sales/customers/page.tsx:20` |
| G-8 | Gap | There is no customer delete or deactivate route. `nextCustomerCode` uses MAX, so a hard-deleted top code is reused (the service comment claims MAX avoids reuse after deletion). | `shared/services/customerCode.service.ts:12-22` |

## Uncertain — needs confirmation

1. **Requests that fail with 4xx/5xx in a handler are probably still audited.** I believe Hono's compose catches the error and sets `c.res` before `auditLog` resumes, but this is not verified. Also confirm that 401s from `authMiddleware` are *not* logged: it runs before `auditLog` at `app.ts:169`.
2. **Which number sequences are provisioned per tenant.** Seen in code: FACTURA, PURCHASE_ORDER, SALES_QUOTATION, JOURNAL_VOUCHER. Confirm in `/setup/number-sequences` before running MD-016.
3. **Whether buyer, ap_clerk or store_manager get data from `GET /finance/accounts`,** which the payment-method dropdown needs. I did not read that route's guard.
4. **What /dashboard shows for low-privilege roles** (warehouse_worker, receiver, customer) after login in MD-040. Not read.
5. **The error message the Dialog shows on a 403 from legacy `requireRole`.** Expected "Insufficient permissions"; confirm it surfaces the same way in each UI.
6. **Whether the storefront /store page lists products through `GET /products?published=true`** as assumed in MD-030. Not read.
7. **Exact CoA template ids and counts** (`bolivia-pcg` assumed from the wizard presets).
8. **Whether `refresh_tokens` rows are ever cleaned up or checked anywhere else,** e.g. by a POS or background job.
9. **Behaviour of the `zz` language tag in `Intl.NumberFormat` on screens** (MD-009 step 7).
