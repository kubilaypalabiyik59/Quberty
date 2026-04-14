# Skarpine ERP — MVP Implementation Plan
> Step-by-step build roadmap for Skarpine retail shoe business

---

## PHASE 0 — Foundation (Week 1-2)

### Goals
- Working project structure
- Database running
- Authentication working

### Tasks
- [ ] Set up PostgreSQL (local Docker + production Railway/Supabase)
- [ ] Run schema.sql to create all tables
- [ ] Configure Prisma schema + generate client
- [ ] Implement JWT auth (login, register, refresh)
- [ ] Set up tenant creation (onboard Skarpine as first tenant)
- [ ] Set up first admin user
- [ ] Create seed data: sites, warehouses, zones, locations
- [ ] CI/CD pipeline (GitHub Actions)

### Deliverable
`POST /api/v1/auth/login` returns JWT ✓

---

## PHASE 1 — Product Catalog (Week 2-3)

### Goals
- Products visible in ERP + storefront

### Tasks
- [ ] Product CRUD API
- [ ] Product variants (size, color)
- [ ] Category management
- [ ] Product publish toggle (ERP vs storefront)
- [ ] Image upload to Supabase Storage
- [ ] Frontend: product list page (ERP)
- [ ] Frontend: shop page (storefront with filters)
- [ ] Frontend: product detail page (storefront)

### Deliverable
Storefront shows Skarpine shoe catalog ✓

---

## PHASE 2 — Inventory Foundation (Week 3-4)

### Goals
- Stock visible per location
- Opening stock imported from Excel

### Tasks
- [ ] Location hierarchy setup (Sites → Warehouses → Zones → Bins)
- [ ] inventory_stock table operational
- [ ] inventory_transactions ledger
- [ ] Data Import: products + opening stock from Excel
- [ ] Column mapping UI
- [ ] Frontend: stock overview page
- [ ] Frontend: transaction history

### Deliverable
All current stock imported and visible ✓

---

## PHASE 3 — Sales Orders (Week 4-5)

### Goals
- Create + process sales orders manually
- Storefront checkout creates orders automatically

### Tasks
- [ ] Sales Order CRUD + lifecycle (Draft → Confirmed → Shipped → Completed)
- [ ] Stock reservation on confirm
- [ ] Stock deduction on ship
- [ ] Storefront checkout flow (cart → order)
- [ ] Customer registration + login on storefront
- [ ] Order confirmation email (Resend)
- [ ] Frontend: sales orders list + detail (ERP)
- [ ] Frontend: checkout page (storefront)
- [ ] Frontend: order status page (storefront)

### Deliverable
Customer can buy online → stock updates automatically ✓

---

## PHASE 4 — Purchase + Receiving (Week 5-6)

### Goals
- Buy from suppliers → stock updates

### Tasks
- [ ] Supplier management
- [ ] Purchase Order CRUD + confirm
- [ ] Arrival Journal (receive goods at warehouse)
- [ ] Post journal → stock inbound
- [ ] Frontend: purchase orders (ERP)
- [ ] Frontend: supplier management (ERP)
- [ ] Frontend: receiving page (ERP)

### Deliverable
Full buy → receive → stock cycle ✓

---

## PHASE 5 — Warehouse Management (Week 6-8)

### Goals
- D365-inspired WMS for picking/put-away

### Tasks
- [ ] Location directives (put-away + pick rules)
- [ ] Work templates (PICK, PUTAWAY sequences)
- [ ] Wave templates + wave creation
- [ ] Wave release → auto-generate pick work
- [ ] Arrival journal → auto-generate put-away work
- [ ] Worker UI: warehouse work task list
- [ ] Worker UI: complete work lines
- [ ] Frontend: wave management (ERP)
- [ ] Frontend: location directive config (ERP)

### Deliverable
Warehouse worker sees pick tasks on screen, completes them ✓

---

## PHASE 6 — Reporting (Week 8-9)

### Goals
- Business intelligence dashboards

### Tasks
- [ ] Materialized views (monthly sales, top products)
- [ ] Monthly sales chart
- [ ] Sales by city chart
- [ ] Top products table with margins
- [ ] Month-over-month growth
- [ ] Inventory turnover
- [ ] Purchase summary
- [ ] Report date range filters
- [ ] Export to PDF/Excel (optional MVP+)

### Deliverable
Full analytics dashboard with all required reports ✓

---

## PHASE 7 — HR + RBAC (Week 9-10)

### Goals
- Employee management + role-based access

### Tasks
- [ ] Employee CRUD
- [ ] Role assignment (Admin, Manager, Worker, Employee, Customer)
- [ ] Module-level permissions per role
- [ ] User management UI
- [ ] Tenant settings (modules on/off, branding)

### Deliverable
Different roles see different parts of the system ✓

---

## POST-MVP (v2.0 — SaaS Launch)

- Stripe billing integration
- Multi-tenant onboarding flow
- Tenant admin dashboard
- Custom branding per tenant
- API rate limiting per plan
- Mobile warehouse app (React Native + barcode scanner)
- WhatsApp order notifications
- Advanced forecasting

---

## RECOMMENDED TECH STACK FOR MVP

| Service | Provider | Cost |
|---------|----------|------|
| Database | Supabase (PostgreSQL) | Free tier |
| Backend hosting | Railway | $5/mo |
| Frontend hosting | Vercel | Free tier |
| File storage | Supabase Storage | Free tier |
| Email | Resend | Free tier (3k/mo) |
| Error tracking | Sentry | Free tier |
| CI/CD | GitHub Actions | Free |
| **Total MVP cost** | | **~$5/month** |
