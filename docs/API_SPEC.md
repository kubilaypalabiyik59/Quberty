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
| POST | `/api/v1/auth/register` | Register customer (storefront) | Public |
| GET | `/api/v1/auth/me` | Current user profile | Any |

---

## PRODUCTS

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/api/v1/products` | List products (filterable, paginated) | Any |
| POST | `/api/v1/products` | Create product | Admin, Manager |
| GET | `/api/v1/products/:id` | Get product detail | Any |
| PUT | `/api/v1/products/:id` | Update product | Admin, Manager |
| DELETE | `/api/v1/products/:id` | Soft delete | Admin |
| GET | `/api/v1/products/:id/variants` | List variants | Any |
| POST | `/api/v1/products/:id/variants` | Create variant | Admin, Manager |
| GET | `/api/v1/products/:id/stock` | Get stock by location | Admin, Manager, Employee |
| GET | `/api/v1/products/categories` | List categories | Any |
| POST | `/api/v1/products/categories` | Create category | Admin |

**Query params for GET /products:**
- `?search=nike&category=sneakers&page=1&limit=20&sortBy=name&inStock=true`

---

## INVENTORY

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/api/v1/inventory/stock` | Stock overview (all locations) | Admin, Manager |
| GET | `/api/v1/inventory/stock/:productId` | Stock per product per location | Admin, Manager |
| POST | `/api/v1/inventory/adjustments` | Manual stock adjustment | Admin |
| GET | `/api/v1/inventory/transactions` | Transaction ledger (filterable) | Admin, Manager |
| POST | `/api/v1/inventory/transfers` | Create internal transfer | Admin, Manager |
| GET | `/api/v1/inventory/transfers/:id` | Transfer detail | Admin, Manager |

---

## WAREHOUSE

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/api/v1/warehouse/sites` | List sites | Admin, Manager |
| POST | `/api/v1/warehouse/sites` | Create site | Admin |
| GET | `/api/v1/warehouse/warehouses` | List warehouses | Admin, Manager |
| POST | `/api/v1/warehouse/warehouses` | Create warehouse | Admin |
| GET | `/api/v1/warehouse/locations` | List locations (filterable by zone) | Any |
| POST | `/api/v1/warehouse/locations` | Create location | Admin |
| GET | `/api/v1/warehouse/work` | List work tasks | Admin, Manager, Worker |
| GET | `/api/v1/warehouse/work/:id` | Work detail + lines | Admin, Manager, Worker |
| POST | `/api/v1/warehouse/work/:id/start` | Start work task | Worker |
| POST | `/api/v1/warehouse/work/:id/lines/:lineId/complete` | Complete a work line | Worker |
| POST | `/api/v1/warehouse/work/:id/complete` | Complete entire work task | Worker |
| GET | `/api/v1/warehouse/waves` | List waves | Admin, Manager |
| POST | `/api/v1/warehouse/waves` | Create wave | Admin, Manager |
| POST | `/api/v1/warehouse/waves/:id/release` | Release wave → generates work | Admin, Manager |
| GET | `/api/v1/warehouse/arrival-journals` | List arrival journals | Admin, Manager, Worker |
| POST | `/api/v1/warehouse/arrival-journals` | Create arrival journal | Admin, Manager |
| POST | `/api/v1/warehouse/arrival-journals/:id/post` | Post journal → updates stock | Admin, Manager |
| GET | `/api/v1/warehouse/location-directives` | List location directives | Admin |
| POST | `/api/v1/warehouse/location-directives` | Create directive | Admin |
| GET | `/api/v1/warehouse/work-templates` | List work templates | Admin |

---

## SALES

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/api/v1/sales/orders` | List sales orders (filterable) | Admin, Manager |
| POST | `/api/v1/sales/orders` | Create manual sales order | Admin, Manager, Employee |
| POST | `/api/v1/sales/orders/storefront` | Create order from storefront | Customer |
| GET | `/api/v1/sales/orders/:id` | Order detail + lines | Admin, Manager |
| PUT | `/api/v1/sales/orders/:id` | Update order (draft only) | Admin, Manager |
| POST | `/api/v1/sales/orders/:id/confirm` | Confirm order → reserves stock | Admin, Manager |
| POST | `/api/v1/sales/orders/:id/cancel` | Cancel order → releases stock | Admin |
| POST | `/api/v1/sales/orders/:id/ship` | Mark as shipped | Admin, Manager |
| POST | `/api/v1/sales/orders/:id/complete` | Mark as completed | Admin, Manager |
| GET | `/api/v1/sales/orders/:id/shipment` | Get shipment details | Any |

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
| GET | `/api/v1/customers` | List customers (filterable, paginated) | Admin, Manager |
| POST | `/api/v1/customers` | Create customer | Admin, Manager, Employee |
| GET | `/api/v1/customers/:id` | Customer detail | Admin, Manager |
| PUT | `/api/v1/customers/:id` | Update customer | Admin, Manager |
| GET | `/api/v1/customers/:id/orders` | Customer order history | Admin, Manager |
| GET | `/api/v1/customers/segments` | List segments + counts | Admin, Manager |

---

## HR

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | `/api/v1/hr/employees` | List employees | Admin |
| POST | `/api/v1/hr/employees` | Create employee | Admin |
| GET | `/api/v1/hr/employees/:id` | Employee detail | Admin |
| PUT | `/api/v1/hr/employees/:id` | Update employee | Admin |
| GET | `/api/v1/hr/users` | List users | Admin |
| PUT | `/api/v1/hr/users/:id/role` | Change user role | Admin |
| PUT | `/api/v1/hr/users/:id/deactivate` | Deactivate user | Admin |

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

| Method | Path | Description | Role |
|--------|------|-------------|------|
| POST | `/api/v1/import/upload` | Upload Excel/CSV file | Admin, Manager |
| POST | `/api/v1/import/jobs/:id/mapping` | Save column mapping | Admin, Manager |
| POST | `/api/v1/import/jobs/:id/validate` | Validate data | Admin, Manager |
| GET | `/api/v1/import/jobs/:id/preview` | Preview validated data | Admin, Manager |
| POST | `/api/v1/import/jobs/:id/execute` | Execute import | Admin |
| GET | `/api/v1/import/jobs` | Import history | Admin, Manager |
| GET | `/api/v1/import/jobs/:id` | Job status + errors | Admin, Manager |

---

## TENANTS (Platform-level, no tenant header needed)

| Method | Path | Description | Role |
|--------|------|-------------|------|
| POST | `/api/v1/tenants` | Create new tenant | Platform Admin |
| GET | `/api/v1/tenants/:id/config` | Get tenant config | Tenant Admin |
| PUT | `/api/v1/tenants/:id/config` | Update modules/branding | Tenant Admin |

---

## HEALTH

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/health/ready` | Readiness probe |
