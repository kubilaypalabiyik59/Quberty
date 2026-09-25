# Skarpine ERP — API Specification
> Base URL: `/api/v1/`
> All endpoints require: `Authorization: Bearer <jwt>` + `X-Tenant-ID: <tenantId>`

---

## AUTH

| Method | Path | Description | Role |
|--------|------|-------------|------|
| POST | `/api/v1/auth/login` | Login, returns JWT | Public |
| POST | `/api/v1/auth/logout` | Revoke refresh token | Any |
| POST | `/api/v1/auth/refresh` | Refresh access token | Any |
| POST | `/api/v1/auth/register` | Register a storefront customer. Requires exactly one of `tenant_id` or `tenant_slug` (400 otherwise); always creates role `customer`, never an admin (WORK-030a) | Public |
| GET | `/api/v1/storefront/:slug/products` | Public catalogue of the store named by tenant slug: published, active products; `in_stock` yes/no, no quantities or costs; `page`, `limit` (max 48), `search`, `category`, `inStock` | Public |
| GET | `/api/v1/storefront/:slug/products/:id` | One published product, variants with `available` yes/no | Public |
| GET | `/api/v1/storefront/:slug/categories` | The store's categories (`id`, `name`) | Public |
| GET | `/api/v1/auth/me` | Current user profile | Any |

`POST /api/v1/auth/make-admin` was removed in WORK-030a (404). Administrators are created by the
operator CLI and roles are assigned by an admin under HR.

**Storefront accounts (WORK-030a).** A `customer` token, or a token whose role the registry does not
know, reaches only these v1 routes; every other v1 route answers 403 before its own guard:
`GET /products`, `GET /products/categories`, `GET /products/:uuid`, `POST /sales/orders/storefront`,
`GET /tenant/currency`. On the three product reads a caller without `product.read` sees published
products only and no `cost_price`.

---

## PRODUCTS

Guards are the exported manifests in the route files and are pinned by `stockRoutePermissions.test.ts` (WORK-030b). A `store_manager` holds every code here except `product.delete`, `product.setup.maintain`, `warehouse.site.maintain` and `import.job.execute`.

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/v1/products` | `product.read or storefront.catalog.read` |
| GET | `/api/v1/products/categories` | `product.read or storefront.catalog.read` |
| GET | `/api/v1/products/:id` | `product.read or storefront.catalog.read` |
| GET | `/api/v1/products/barcode/:code` | `product.read` |
| POST | `/api/v1/products/categories` | `product.maintain` |
| POST | `/api/v1/products` | `product.maintain` |
| PUT | `/api/v1/products/:id` | `product.maintain` |
| GET | `/api/v1/products/setup/item-groups` | `product.setup.read` |
| GET | `/api/v1/products/setup/item-model-groups` | `product.setup.read` |
| POST | `/api/v1/products/setup/item-groups` | `product.setup.maintain` |
| POST | `/api/v1/products/setup/item-model-groups` | `product.setup.maintain` |
| PUT | `/api/v1/products/setup/item-model-groups/:id` | `product.setup.maintain` |
| PUT | `/api/v1/products/setup/item-groups/:id` | `product.setup.maintain` |
| GET | `/api/v1/products/setup/coverage` | `product.setup.read` |
| POST | `/api/v1/products/setup/assign-groups` | `product.setup.maintain` |
| DELETE | `/api/v1/products/:id` | `product.delete` |
| POST | `/api/v1/products/bulk` | `product.maintain` |
| POST | `/api/v1/products/:id/variants` | `product.maintain` |
| PUT | `/api/v1/products/:id/variants/:variantId` | `product.maintain` |
| DELETE | `/api/v1/products/:id/variants/:variantId` | `product.maintain` |
| POST | `/api/v1/products/:id/image` | `product.maintain` |
| DELETE | `/api/v1/products/:id/image` | `product.maintain` |
| POST | `/api/v1/products/:id/generate-video` | `product.media.generate` |
| GET | `/api/v1/products/:id/video-jobs/:requestId` | `product.media.generate` |
| DELETE | `/api/v1/products/:id/video` | `product.maintain` |
| GET | `/api/v1/products/:id/stock` | `inventory.stock.read` |

A caller without `product.read` (a shopper) gets the storefront projection: published products only, no `cost_price`.

**Query params for GET /products:** `?search=nike&category=<id>&page=1&limit=20&sortBy=name&inStock=true`

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/v1/uom` | `product.read` |
| POST | `/api/v1/uom` | `product.maintain` |
| PUT | `/api/v1/uom/:id` | `product.maintain` |
| POST | `/api/v1/uom/seed-defaults` | `product.maintain` |

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/v1/variant-types` | `product.read` |
| POST | `/api/v1/variant-types` | `product.maintain` |
| PUT | `/api/v1/variant-types/:id` | `product.maintain` |
| DELETE | `/api/v1/variant-types/:id` | `product.maintain` |

---

## INVENTORY

Guards are the exported manifests in the route files and are pinned by `stockRoutePermissions.test.ts` (WORK-030b). A `store_manager` holds every code here except `product.delete`, `product.setup.maintain`, `warehouse.site.maintain` and `import.job.execute`.

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/v1/inventory/stock` | `inventory.stock.read` |
| GET | `/api/v1/inventory/transactions` | `inventory.transaction.read` |
| GET | `/api/v1/inventory/low-stock` | `inventory.stock.read` |
| POST | `/api/v1/inventory/transfers` | `inventory.transfer.post` |
| POST | `/api/v1/inventory/adjust` | `inventory.adjustment.post` |

`POST /inventory/adjust` and `POST /inventory/transfers` refuse a product, variant or location that is not the caller tenant's with 422 `FOREIGN_REFERENCE` before any write.

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/v1/inventory-counts` | `inventory.count.read` |
| GET | `/api/v1/inventory-counts/:id` | `inventory.count.read` |
| POST | `/api/v1/inventory-counts` | `inventory.count.create` |
| PUT | `/api/v1/inventory-counts/:id/lines/:lineId` | `inventory.count.record` |
| POST | `/api/v1/inventory-counts/:id/finalize` | `inventory.count.post` |

---

## WAREHOUSE

Guards are the exported manifests in the route files and are pinned by `stockRoutePermissions.test.ts` (WORK-030b). A `store_manager` holds every code here except `product.delete`, `product.setup.maintain`, `warehouse.site.maintain` and `import.job.execute`.

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/v1/warehouse/sites` | `warehouse.structure.read` |
| POST | `/api/v1/warehouse/sites` | `warehouse.site.maintain` |
| GET | `/api/v1/warehouse/warehouses` | `warehouse.structure.read` |
| GET | `/api/v1/warehouse/overview` | `warehouse.structure.read` |
| POST | `/api/v1/warehouse/warehouses` | `warehouse.structure.maintain` |
| GET | `/api/v1/warehouse/zones` | `warehouse.structure.read` |
| POST | `/api/v1/warehouse/zones` | `warehouse.structure.maintain` |
| GET | `/api/v1/warehouse/locations` | `warehouse.structure.read` |
| POST | `/api/v1/warehouse/locations` | `warehouse.structure.maintain` |
| POST | `/api/v1/warehouse/locations/bulk` | `warehouse.structure.maintain` |
| GET | `/api/v1/warehouse/work` | `warehouse.work.read` |
| POST | `/api/v1/warehouse/work/:id/start` | `warehouse.work.execute` |
| POST | `/api/v1/warehouse/work/:id/lines/:lineId/complete` | `warehouse.work.execute` |
| POST | `/api/v1/warehouse/work/:id/complete` | `warehouse.work.execute` |
| GET | `/api/v1/warehouse/waves` | `warehouse.wave.read` |
| POST | `/api/v1/warehouse/waves/:id/release` | `warehouse.wave.release` |
| GET | `/api/v1/warehouse/arrival-journals` | `warehouse.arrival.read` |
| POST | `/api/v1/warehouse/arrival-journals` | `warehouse.arrival.create` |
| POST | `/api/v1/warehouse/arrival-journals/:id/post` | `warehouse.arrival.post` |
| POST | `/api/v1/warehouse/setup` | `warehouse.setup.maintain` |
| GET | `/api/v1/warehouse/location-directives` | `warehouse.setup.read` |
| POST | `/api/v1/warehouse/location-directives` | `warehouse.setup.maintain` |
| GET | `/api/v1/warehouse/parameters` | `warehouse.setup.read` |
| PUT | `/api/v1/warehouse/parameters/:warehouseId` | `warehouse.setup.maintain` |
| POST | `/api/v1/warehouse/location-directives/:id/lines` | `warehouse.setup.maintain` |
| DELETE | `/api/v1/warehouse/location-directives/:id` | `warehouse.setup.maintain` |

---

## SALES

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/api/v1/sales/orders` | List sales orders (filterable) | `sales.order.read` |
| POST | `/api/v1/sales/orders` | Create manual sales order | `sales.order.create` |
| POST | `/api/v1/sales/orders/storefront` | Create order from storefront | `storefront.order.place` |
| GET | `/api/v1/sales/orders/:id` | Order detail + lines | `sales.order.read` |
| PUT | `/api/v1/sales/orders/:id` | Update order (draft only) | `sales.order.update` |
| POST | `/api/v1/sales/orders/:id/confirm` | Confirm order → reserves stock | `sales.order.confirm` |
| POST | `/api/v1/sales/orders/:id/cancel` | Cancel order → releases stock | `sales.order.cancel` (admin) |
| POST | `/api/v1/sales/orders/:id/ship` | Mark as shipped | `sales.order.ship` |
| POST | `/api/v1/sales/orders/:id/complete` | Mark as completed | `sales.order.complete` |
| POST | `/api/v1/sales/orders/:id/invoice` | Issue the factura (draws a FACTURA number) | `sales.invoice.post` |
| POST | `/api/v1/sales/orders/:id/pay` | Record the customer payment | `sales.customer_payment.post` |
| POST | `/api/v1/sales/orders/:id/return` | Whole-order return and credit note | `sales.return.post` |

Quotations (`/api/v1/sales/quotations`): list/detail `sales.quotation.read`; create
`sales.quotation.create`; lines and revise `sales.quotation.update`; send `sales.quotation.send`;
confirm `sales.quotation.confirm` + `sales.order.create` + `customer.create` (it can convert the
lead); lose/cancel `sales.quotation.close`.

CRM (`/api/v1/crm`): leads `crm.lead.read` / `crm.lead.maintain`; qualify additionally
`crm.opportunity.maintain` + `customer.create`; convert-to-customer additionally `customer.create`;
opportunities and stages read `crm.opportunity.read`; opportunity writes `crm.opportunity.maintain`;
close `crm.opportunity.close`; stage setup `crm.setup.maintain` (admin).

POS (`/api/v1/pos`): sessions `pos.session.operate`; sale `pos.sale.post`; void `pos.sale.void`
(store manager, admin — not cashier).

---

## PURCHASE

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/api/v1/purchase/orders` | List purchase orders | Admin, Manager |
| POST | `/api/v1/purchase/orders` | Create purchase order | Admin, Manager |
| GET | `/api/v1/purchase/orders/:id` | PO detail + lines | Admin, Manager |
| PUT | `/api/v1/purchase/orders/:id` | Update PO (draft only) | Admin, Manager |
| POST | `/api/v1/purchase/orders/:id/confirm` | Confirm PO | Admin, Manager |
| POST | `/api/v1/purchase/orders/:id/cancel` | Cancel PO | Admin |
| GET | `/api/v1/purchase/suppliers` | List suppliers | Admin, Manager |
| POST | `/api/v1/purchase/suppliers` | Create supplier | Admin |
| GET | `/api/v1/purchase/suppliers/:id` | Supplier detail | Admin, Manager |
| PUT | `/api/v1/purchase/suppliers/:id` | Update supplier | Admin |

---

## CUSTOMERS

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/api/v1/customers` | List customers (filterable, paginated) | `customer.read` |
| POST | `/api/v1/customers` | Create customer | `customer.create` |
| GET | `/api/v1/customers/:id` | Customer detail | `customer.read` |
| PUT | `/api/v1/customers/:id` | Update customer | `customer.update` |
| GET | `/api/v1/customers/:id/orders` | Customer order history | `customer.read` + `sales.order.read` |
| GET | `/api/v1/customers/:id/statement` | Orders with factura number and payment state, and totals ordered / invoiced / paid / open | `customer.read` + `sales.order.read` |
| GET | `/api/v1/customers/segments` | List segments + counts | `report.sales.read` |

---

## HR

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/api/v1/hr/employees` | List employees | Admin |
| POST | `/api/v1/hr/employees` | Create employee | Admin |
| GET | `/api/v1/hr/employees/:id` | Employee detail | Admin |
| PUT | `/api/v1/hr/employees/:id` | Update employee | Admin |
| GET | `/api/v1/hr/users` | List users | Admin |
| POST | `/api/v1/hr/users` | Create a sign-in account (email, names, role, initial password) | Admin |
| PUT | `/api/v1/hr/users/:id/role` | Change user role | Admin |
| PUT | `/api/v1/hr/users/:id/deactivate` | Deactivate user | Admin |
| PUT | `/api/v1/hr/users/:id/reactivate` | Reactivate user | Admin |

---

## REPORTS

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/api/v1/reports/sales/monthly` | Monthly sales (by month, city) | Admin, Manager |
| GET | `/api/v1/reports/sales/by-city` | Sales breakdown by city | Admin, Manager |
| GET | `/api/v1/reports/products/top-selling` | Top products by units/revenue | Admin, Manager |
| GET | `/api/v1/reports/purchases/monthly` | Monthly purchase summary | Admin, Manager |
| GET | `/api/v1/reports/inventory/turnover` | Inventory turnover ratio | Admin, Manager |
| GET | `/api/v1/reports/inventory/valuation` | Stock value by location | Admin, Manager |
| GET | `/api/v1/reports/finance/margins` | Gross profit margins per product | Admin |
| GET | `/api/v1/reports/trends/growth` | MoM growth trends | Admin |
| POST | `/api/v1/reports/refresh` | Refresh materialized views | Admin |

**Query params:** `?from=2024-01-01&to=2024-12-31&siteId=...&warehouseId=...`

---

## DATA IMPORT

Guards are the exported manifests in the route files and are pinned by `stockRoutePermissions.test.ts` (WORK-030b). A `store_manager` holds every code here except `product.delete`, `product.setup.maintain`, `warehouse.site.maintain` and `import.job.execute`.

| Method | Path | Permission |
|--------|------|------------|
| POST | `/api/v1/import/upload` | `import.job.prepare` |
| POST | `/api/v1/import/jobs/:id/mapping` | `import.job.prepare` |
| POST | `/api/v1/import/jobs/:id/validate` | `import.job.prepare` |
| POST | `/api/v1/import/jobs/:id/execute` | `import.job.execute` |
| GET | `/api/v1/import/jobs` | `import.job.read` |
| GET | `/api/v1/import/jobs/:id` | `import.job.read` |

Every write step answers 501 `IMPORT_NOT_IMPLEMENTED` until the executors write rows (WORK-042; real import in WORK-054).

---

## TENANT (own tenant only; tenant header and Bearer token required)

Tenants are created by the platform operator with `backend/scripts/createTenant.ts`, not over
HTTP. Module entitlement is operator-controlled and cannot be edited through the API.

| Method | Path | Description | Permission |
|--------|------|-------------|------|
| GET | `/api/v1/tenant/currency` | The ledger's currency for rendering money: `code`, `symbol`, `rounding_precision`, `rounding_method`, `locale`. `null` before the ledger exists — a client then renders no amounts rather than inventing a symbol | **none beyond authentication.** Every screen that shows an amount needs it — the POS for a cashier, the shop for a customer — and none of those roles may read the tenant config or the finance currency setup (WORK-025b) |
| GET | `/api/v1/tenant/config` | Get own tenant config, including the same `currency` projection | `setup.tenant.read` (admin, store manager, auditor) |
| PUT | `/api/v1/tenant/config` | Update branding, language, timezone | `setup.tenant.maintain` (admin, store manager) |
| PUT | `/api/v1/tenant/setup` | Update the legacy tax config only; a `currency_code` is refused (400) — the accounting currency belongs to the ledger (WORK-024) | `finance.setup.maintain` (admin) |
| GET | `/api/v1/finance/ledger-currencies` | Ledger accounting/reporting currency, rate types, `locked` once anything has posted | `finance.currency.read` |
| PUT | `/api/v1/finance/ledger-currencies` | Set the ledger currencies; 409 `CURRENCY_LOCKED` after the first posting; reporting must equal accounting until WORK-024b | `finance.setup.maintain` (admin) |
| GET | `/api/v1/finance/currencies` · `/currencies/iso` | Activated currencies with rounding · ISO 4217 reference list | `finance.currency.read` |
| POST · PUT | `/api/v1/finance/currencies` · `/currencies/:code` | Activate a currency (≤ 2 decimals) · update rounding/active; a ledger currency cannot be deactivated | `finance.setup.maintain` (admin) |
| GET · POST · PUT | `/api/v1/finance/exchange-rate-types[/:id]` | List · create · rename/(de)activate rate types | read: `finance.currency.read`; write: `finance.setup.maintain` (admin) |
| GET | `/api/v1/finance/exchange-rates` · `/exchange-rates/resolve` | Dated rates · preview the rate valid on a date (latest on or before; reciprocal by division) | `finance.currency.read` |
| POST | `/api/v1/finance/exchange-rates` | Add a dated rate (add only); reciprocal pair refused | `finance.exchange_rate.maintain` (admin, store manager, finance approver) |
| PUT | `/api/v1/finance/exchange-rates/:id` | Correct an existing rate; posted documents keep their rate | `finance.setup.maintain` (admin) |

---

## ATTACHMENTS (migration 041)

Files kept on a business document. `entity_type` is one of `LEAD`, `OPPORTUNITY`, `SALES_QUOTATION`,
`SALES_ORDER`, `PURCHASE_ORDER`, `VENDOR_INVOICE`, `CUSTOMER`, `SUPPLIER`. Permission follows the
parent document: read = its read permission, write = its maintain permission (see `ENTITY_RULES` in
`backend/src/modules/attachments/attachment.routes.ts`). Files live in the private Supabase bucket
`attachments` under `<tenant>/<entity_type>/<entity_id>/<uuid>`.

| Method | Path | Description | Permission |
|--------|------|-------------|------|
| GET | `/api/v1/attachments?entity_type=&entity_id=` | Live attachments of the document | parent read |
| POST | `/api/v1/attachments` | Multipart `entity_type`, `entity_id`, `file`; pdf, doc(x), xls(x), txt, csv, png, jp(e)g; 415 other types, 413 over 10 MB, 422 document not in the tenant | parent write |
| GET | `/api/v1/attachments/:id/download` | `{ url, expires_in: 60, file_name }` — a signed URL valid for 60 seconds | parent read |
| DELETE | `/api/v1/attachments/:id` | Soft delete (`deleted_at`, `deleted_by`); 409 `ATTACHMENT_LOCKED` on a posted vendor invoice | parent write |

---

## HEALTH

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/health/ready` | Readiness probe |
