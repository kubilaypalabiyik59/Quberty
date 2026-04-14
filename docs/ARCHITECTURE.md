# Skarpine ERP — Full System Architecture
> Inspired by Microsoft Dynamics 365 Finance & Operations
> SaaS-ready, Multi-tenant, Modular

---

## 1. SYSTEM OVERVIEW

Skarpine ERP is a **multi-tenant SaaS ERP + E-commerce platform** for retail shoe businesses.
Built on clean architecture principles, inspired by Microsoft Dynamics 365 F&O modular design.

```
┌─────────────────────────────────────────────────────────────────┐
│                        SKARPINE PLATFORM                         │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  ERP ADMIN   │  │  STOREFRONT  │  │   MOBILE (future)    │   │
│  │  Next.js App │  │  Next.js App │  │   React Native       │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│         └─────────────────┼──────────────────────┘               │
│                           │                                       │
│                    ┌──────▼───────┐                              │
│                    │  API GATEWAY │  (versioned /api/v1/)        │
│                    │  + JWT Auth  │                              │
│                    └──────┬───────┘                              │
│                           │                                       │
│  ┌────────────────────────▼──────────────────────────────────┐  │
│  │                    BACKEND SERVICES                        │  │
│  │                                                            │  │
│  │  Sales │ Purchase │ Inventory │ Warehouse │ Customers     │  │
│  │  HR    │ Reporting │ Import   │ Auth      │ Tenants       │  │
│  └────────────────────────┬──────────────────────────────────┘  │
│                           │                                       │
│                    ┌──────▼───────┐                              │
│                    │  PostgreSQL  │  (per-tenant schema)         │
│                    │  + Redis     │  (sessions, cache)           │
│                    └──────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. MODULES

### 2.1 Sales Management
- Sales Order lifecycle: `Draft → Confirmed → Picked → Packed → Shipped → Completed`
- Manual orders (ERP admin) + automatic orders (storefront)
- Customer-linked, location-aware

### 2.2 Purchase Management
- Supplier profiles
- Purchase Orders with line items
- Receiving triggers inbound warehouse workflow
- Cost tracking per product

### 2.3 Inventory Management
- Real-time stock per location (site → warehouse → zone → bin)
- Every movement recorded in `inventory_transactions`
- Types: Inbound, Outbound, Transfer, Adjustment, Return

### 2.4 Warehouse Management (D365-inspired)
Full WMS module following Dynamics 365 Supply Chain warehouse logic:

**Location Hierarchy:**
```
Site (City)
  └── Warehouse (Store / Distribution Center)
        └── Zone (Section of warehouse)
              └── Aisle
                    └── Rack
                          └── Bin/Shelf (Lowest level — actual storage location)
```

**Inbound Workflow (Receiving):**
```
Purchase Order Confirmed
  → Arrival Journal created
    → Receiving dock scan
      → Quality check (optional)
        → Put-away task generated
          → Location Directive selects target bin
            → Worker performs put-away
              → Stock confirmed at bin level
```

**Outbound Workflow (Shipping):**
```
Sales Order Confirmed
  → Wave created (groups multiple orders)
    → Work template applied
      → Pick tasks generated
        → Location Directive selects source bin (FIFO/FEFO)
          → Worker picks items
            → Packing station
              → Shipping label generated
                → Shipment confirmed
                  → Stock decremented
```

**Work Templates** — define the sequence of pick/put steps for warehouse tasks
**Location Directives** — rules engine for "where to put" / "where to pick from"
**Wave Templates** — batch multiple orders into efficient pick waves

### 2.5 Customer Management (CRM Lite)
- Customer profiles with segmentation tags
- Full order history
- Lifetime value calculation

### 2.6 HR Module
- Employee profiles
- RBAC roles: Admin, Store Manager, Warehouse Worker, Employee, Customer
- Module-level permissions

### 2.7 Reporting Module
Standard reports:
- Monthly sales / purchases
- Top-selling products
- Sales by city/location

Advanced analytics:
- Inventory turnover ratio
- Gross profit margins per product
- Month-over-month growth trends

### 2.8 Data Import Module
- Excel/CSV upload
- Column mapping UI (drag & drop field mapping)
- Validation: duplicate detection, format checks, required fields
- Import history log

---

## 3. MULTI-TENANT ARCHITECTURE

Strategy: **Schema-per-tenant** in PostgreSQL

```
public schema     → Platform-level (tenants, plans, billing)
tenant_abc schema → Tenant ABC's data (isolated)
tenant_xyz schema → Tenant XYZ's data (isolated)
```

Tenant isolation ensures:
- No data leakage between tenants
- Per-tenant configuration (modules on/off, branding, language)
- Future per-tenant database for enterprise tier

**Tenant resolution:** Subdomain-based (`skarpine.platform.com` or `abc.skarpine.app`)

---

## 4. SECURITY

- JWT (access token 15min + refresh token 7 days)
- RBAC with granular module permissions
- All API endpoints require `X-Tenant-ID` header
- Row-level security at DB layer (PostgreSQL RLS)
- Audit log for all mutations

**Roles:**
| Role | Access |
|------|--------|
| Admin | Full access |
| Store Manager | Their store's sales, inventory, reports |
| Warehouse Worker | Warehouse tasks only |
| Employee | View-only on assigned modules |
| Customer | Storefront only |

---

## 5. TECH STACK

| Layer | Technology | Reason |
|-------|-----------|--------|
| Backend | Node.js + Express | Fast, ecosystem, easy to hire |
| ORM | Prisma | Type-safe, migrations, multi-schema |
| Database | PostgreSQL | ACID, JSON support, RLS |
| Cache | Redis | Sessions, report caching |
| Frontend ERP | Next.js 14 (App Router) | SSR, performance |
| Frontend Store | Next.js 14 | SEO, fast |
| Auth | JWT + bcrypt | Standard, stateless |
| File Storage | Supabase Storage / S3 | Product images, imports |
| Email | Resend / Nodemailer | Order confirmations |
| CI/CD | GitHub Actions | Free, integrated |

---

## 6. API DESIGN

Base URL: `/api/v1/`
All endpoints require: `Authorization: Bearer <token>` + `X-Tenant-ID: <tenantId>`

See `API_SPEC.md` for full endpoint list.

---

## 7. DATA FLOW — Frontend ↔ ERP

```
Customer browses storefront
  → GET /api/v1/products (with stock)

Customer adds to cart → places order
  → POST /api/v1/orders/storefront
    → Creates Sales Order (status: Draft)
      → Payment processed
        → Sales Order status → Confirmed
          → Warehouse wave created
            → Pick/Pack/Ship workflow executes
              → Stock decremented at bin level
                → Order status → Completed
                  → Customer email sent
```

---

## 8. SCALABILITY DECISIONS

1. **Stateless API** — horizontal scaling ready
2. **Redis caching** — reports cached, invalidated on data change
3. **Event-driven stock updates** — using DB triggers or event queue (future: RabbitMQ/Kafka)
4. **Schema-per-tenant** — easy to migrate one tenant to dedicated DB
5. **Module flags** — each tenant can enable/disable modules
6. **API versioning** — v1/v2 without breaking changes
7. **Prisma migrations** — version-controlled schema changes
