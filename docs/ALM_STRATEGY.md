# Skarpine ALM Strategy
> Based on Microsoft Dynamics 365 ALM Guidance
> https://learn.microsoft.com/dynamics365/guidance/implementation-guide/application-lifecycle-management

---

## 1. ENVIRONMENT STRATEGY

Three-tier environment model (mirroring D365 guidance):

```
DEV  →  TEST/UAT  →  PRODUCTION
```

| Environment | Purpose | Database | Who Uses It |
|-------------|---------|----------|-------------|
| Development | Feature development, local | Local PostgreSQL | Developers |
| Testing/UAT | Integration tests, client acceptance | Shared test DB | QA, Client |
| Production | Live system | Production DB | End users |

### Environment Configuration
Each environment has its own:
- `.env` file (never committed)
- Database connection string
- JWT secrets
- Redis instance
- Feature flags

```
.env.development
.env.test
.env.production
```

---

## 2. VERSION CONTROL STRATEGY

### Branching Model (GitFlow-inspired)

```
main           ← production-ready, tagged releases
  └── develop  ← integration branch
        ├── feature/sales-order-workflow
        ├── feature/warehouse-location-directives
        ├── fix/inventory-transfer-bug
        └── hotfix/critical-stock-calculation
```

### Branch Rules
- `main` — protected, requires PR + 1 approval, CI must pass
- `develop` — requires PR, CI must pass
- Feature branches — `feature/<module>-<description>`
- Bug fixes — `fix/<description>`
- Hotfixes — `hotfix/<description>` (branches from main, merges to both main + develop)

### Commit Convention (Conventional Commits)
```
feat(inventory): add bin-level stock tracking
fix(warehouse): correct FIFO pick logic
chore(db): add migration for work_templates table
docs(api): update order endpoints spec
```

---

## 3. CI/CD PIPELINE

### GitHub Actions Workflow

```yaml
# On every PR to develop/main:
1. Lint (ESLint + Prettier)
2. Type check (TypeScript)
3. Unit tests (Jest)
4. Integration tests (against test DB)
5. Build (Next.js + backend)
6. Security scan (npm audit)

# On merge to develop:
7. Deploy to TEST environment

# On merge to main (tagged release):
8. Deploy to PRODUCTION
9. Run smoke tests
10. Notify team (Slack/email)
```

### Pipeline Files
```
.github/
  workflows/
    ci.yml          ← runs on every PR
    deploy-test.yml ← deploys to UAT on develop merge
    deploy-prod.yml ← deploys to production on main tag
```

### Zero-downtime Deployment Strategy
1. Build new container/bundle
2. Run DB migrations (backward-compatible)
3. Blue/green swap (or rolling deploy on Vercel/Railway)
4. Health check
5. Keep previous version ready for rollback (15 min window)

---

## 4. RELEASE STRATEGY

### Semantic Versioning
```
v1.0.0  → Initial MVP (Sales + Inventory + Basic Warehouse)
v1.1.0  → Purchase Management + Supplier portal
v1.2.0  → Full WMS (waves, work templates, location directives)
v2.0.0  → Multi-tenant SaaS + billing
v2.1.0  → Advanced reporting + analytics
v3.0.0  → Mobile warehouse app + barcode scanning
```

### Release Process
1. Feature freeze on `develop`
2. Create `release/vX.Y.Z` branch
3. Final testing on UAT
4. Client sign-off
5. Tag `vX.Y.Z` on main
6. Deploy to production
7. Monitor for 24h
8. Close release branch

### Hotfix Process
1. `hotfix/description` from `main`
2. Fix applied, tested
3. PR to `main` (fast-tracked review)
4. Tag `vX.Y.Z+1`
5. Merge back to `develop`

---

## 5. DATA MIGRATION STRATEGY

### Phase 1 — Initial Import (MVP Launch)
Migrate from paper/Excel to Skarpine:

```
Excel files (client provides)
  → Data Import Module (UI)
    → Column mapping
      → Validation (duplicates, formats)
        → Staging table
          → Review & approve
            → Load to production tables
```

**Import order (respects FK dependencies):**
1. Locations (sites, warehouses, zones, bins)
2. Products + categories
3. Suppliers
4. Customers
5. Opening stock (inventory_transactions with type=OPENING)
6. Historical sales (optional, for reporting baseline)

### Phase 2 — Ongoing Migrations (Schema changes)
- All schema changes via **Prisma migrations** (version-controlled SQL)
- Migrations run automatically in CI/CD pipeline
- Never modify production DB manually
- Migration naming: `YYYYMMDD_description.sql`

### Rollback Strategy
- Every migration has a corresponding `down` script
- Production DB snapshots before major releases
- Point-in-time recovery enabled on PostgreSQL

---

## 6. MONITORING & MAINTENANCE

### Application Logging
- **Structured JSON logs** (Winston or Pino)
- Log levels: ERROR, WARN, INFO, DEBUG
- All API requests logged with: tenant_id, user_id, method, path, status, duration
- All inventory movements logged with full context

### Error Tracking
- **Sentry** (or self-hosted Glitchtip for cost)
- Captures unhandled errors with stack traces
- Alert thresholds: >10 errors/min → Slack notification

### Performance Monitoring
- API response time tracking
- Slow query detection (> 500ms logged)
- Redis hit rate monitoring

### Health Checks
```
GET /api/health        → { status: "ok", db: "ok", redis: "ok" }
GET /api/health/ready  → Readiness probe (for k8s future)
```

### Maintenance
- DB vacuuming on schedule
- Log rotation (keep 30 days)
- Dependency updates (Dependabot)
- Security patches (monthly review)
- Backup verification (weekly restore test)

---

## 7. TESTING STRATEGY

```
Unit Tests        → Business logic (order calculations, stock math)
Integration Tests → API endpoints with real DB
E2E Tests         → Critical user flows (Playwright)
Load Tests        → API under 1000 concurrent users (k6)
```

### Coverage Targets
- Unit: 80%+ on business logic modules
- Integration: All API endpoints covered
- E2E: Happy path for sales, purchase, warehouse flows
