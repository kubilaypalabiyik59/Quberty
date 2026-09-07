# Skarpine ERP Platform
> Full-stack ERP + E-commerce system inspired by Microsoft Dynamics 365 F&O
> Multi-tenant SaaS-ready | Retail (Shoes) | Built for digital transformation

---

## What Is This?

Skarpine is a **production-grade ERP + E-commerce platform** for retail shoe businesses.
It is designed to replace paper-based operations with a digital, scalable system —
and is architected as a future multi-tenant SaaS product ($5,000+/year contracts).

---

## Module Overview

| Module | Status | Key Features |
|--------|--------|-------------|
| Sales Management | MVP | Order lifecycle, storefront integration, stock reservation |
| Purchase Management | MVP | PO lifecycle, supplier management, cost tracking |
| Inventory | MVP | Bin-level stock, FIFO, transaction ledger |
| Warehouse (WMS) | MVP | D365-style: waves, work templates, location directives |
| Customer CRM | MVP | Profiles, order history, segmentation |
| HR | MVP | Employees, RBAC roles |
| Reporting | MVP | Monthly sales, margins, turnover, growth, by-city |
| Data Import | MVP | Excel/CSV, column mapping UI, validation |
| E-commerce Store | MVP | Product catalog, cart, checkout, auto stock update |
| Multi-tenant | v2 | Schema-per-tenant, module config, branding |

---

## Project Structure

```
skarpine/
├── backend/              ← Node.js + Hono + Prisma
│   └── src/
│       ├── modules/
│       │   ├── auth/
│       │   ├── sales/
│       │   ├── purchase/
│       │   ├── inventory/
│       │   ├── warehouse/
│       │   ├── customers/
│       │   ├── hr/
│       │   ├── reporting/
│       │   ├── import/
│       │   └── tenants/
│       ├── shared/
│       │   ├── middleware/
│       │   └── errors/
│       ├── infrastructure/
│       │   └── database/
│       └── config/
├── frontend/             ← Next.js 14 (App Router)
│   └── src/
│       ├── app/
│       │   ├── (erp)/    ← Admin ERP pages
│       │   └── (store)/  ← Customer storefront
│       ├── components/
│       │   ├── erp/
│       │   ├── store/
│       │   └── ui/
│       ├── stores/       ← Zustand state
│       └── lib/
├── database/
│   └── schema.sql        ← Full database schema
├── docs/
│   ├── ARCHITECTURE.md   ← System design
│   ├── API_SPEC.md       ← All endpoints
│   ├── ALM_STRATEGY.md   ← DevOps & ALM
│   └── MVP_PLAN.md       ← Build roadmap
└── alm/
    ├── pipelines/        ← GitHub Actions CI/CD
    └── environments/     ← Environment strategy
```

---

## Quick Start

### 1. Backend
```bash
cd backend
npm install
cp .env.example .env    # fill in your values
npx prisma migrate dev  # creates all tables
npm run db:seed         # seed demo data
npm run dev             # starts on :3001
```

### 2. Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev             # starts on :3000
```

### 3. Access
- ERP Admin: `http://localhost:3000/dashboard`
- Storefront: `http://localhost:3000/shop`
- API: `http://localhost:3001/api/v1`
- API Health: `http://localhost:3001/api/health`

---

## Warehouse Flows (D365-Inspired)

### Inbound (Receiving)
```
Purchase Order Confirmed
→ Create Arrival Journal
→ Post Journal → Location Directive selects bin
→ Put-away Work generated
→ Worker puts to bin
→ Stock confirmed at bin level
```

### Outbound (Picking)
```
Sales Order Confirmed → stock reserved
→ Added to Wave
→ Release Wave → Pick Work generated
→ Location Directive selects FIFO source bin
→ Worker picks + puts to staging
→ Pack + Ship
→ Stock decremented
```

---

## Architecture Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Multi-tenancy | Schema-per-tenant | Strong isolation, easy to migrate |
| Auth | JWT (15min) + refresh (7d) | Stateless, scalable |
| ORM | Prisma | Type-safe, migrations |
| API versioning | /api/v1/ prefix | Non-breaking upgrades |
| Stock tracking | Bin-level (site→wh→zone→bin) | D365 warehouse management |
| Reports | Raw SQL + materialized views | Performance on large datasets |

---

## SaaS Roadmap

```
v1.0 — MVP (this version)
v1.1 — Purchase Management + full receiving
v1.2 — Full WMS (barcode scanning ready)
v2.0 — Multi-tenant SaaS + Stripe billing
v2.1 — Advanced analytics + forecasting
v3.0 — Mobile warehouse app (React Native)
```

---

## Documentation

- [Full Architecture](docs/ARCHITECTURE.md)
- [Database Schema](database/schema.sql)
- [API Specification](docs/API_SPEC.md)
- [ALM Strategy](docs/ALM_STRATEGY.md)
- [MVP Build Plan](docs/MVP_PLAN.md)
