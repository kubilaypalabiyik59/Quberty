# Skarpine / Quberty — Production Improvement Roadmap

**Generated**: 2026-04-05  
**Auditor**: Claude Code (Explore Agent)  
**Status**: In Progress

---

## Executive Summary

Skarpine is a well-architected ERP + POS system at **BETA / MVP stage**. The core accounting logic, multi-tenancy, and Bolivia tax compliance are solid. The following roadmap addresses the gaps identified in the full audit before production deployment.

---

## Overall Audit Scores

| Dimension | Score | Target |
|-----------|-------|--------|
| Feature Completeness | 7/10 | 9/10 |
| Code Quality | 6/10 | 8/10 |
| Security | 5/10 | 8/10 |
| Production Readiness | 4/10 | 8/10 |
| Bolivia Compliance | 7/10 | 9/10 |
| Mobile POS App | 5/10 | 8/10 |

---

## PHASE 1 — Critical (Pre-Launch)

### ✅ 1. Extract IVA/IT Tax Rates to Shared Config
- **Problem**: IVA 13% and IT 3% hardcoded in 10+ files. Tax law change = find & replace across codebase.
- **Fix**: Central `src/config/tax.ts` with `IVA_RATE`, `IT_RATE` constants. All modules import from there.
- **Files affected**: `sales.routes.ts`, `pos.routes.ts`, `finance.routes.ts`, `purchase.routes.ts`
- **Status**: [ ] Pending

### ✅ 2. Fix Atomic Order Number Generation
- **Problem**: `ORDER_COUNT + 1` pattern has race condition — two concurrent creates produce duplicate numbers.
- **Fix**: Reuse the `factura_counters` atomic counter pattern (PostgreSQL `ON CONFLICT DO UPDATE`) for all order types.
- **Files affected**: `sales.routes.ts`, `purchase.routes.ts`, `pos.routes.ts`, `inventory.routes.ts`
- **Status**: [ ] Pending

### ✅ 3. Wrap GL Journal in db.$transaction
- **Problem**: In `sales.routes.ts` (lines ~255, 316), GL journal entry creation is done outside the main transaction. If GL fails, Factura is posted but books are out of sync.
- **Fix**: Wrap entire Factura + GL creation in `db.$transaction()`.
- **Files affected**: `sales.routes.ts`, `finance.routes.ts`
- **Status**: [ ] Pending

### ✅ 4. Add Zod Input Validation to All Routes
- **Problem**: Request bodies accepted as-is — no schema validation. Business logic can be bypassed with malformed input.
- **Fix**: Zod schemas for every POST/PUT body across all 13 modules. Shared `validate()` middleware.
- **Files affected**: All `*.routes.ts` files
- **Status**: [ ] Pending

### ✅ 5. Stricter Rate Limiting on Auth Endpoints
- **Problem**: Global 500 req/15min limit applies equally to all routes. `/auth/login` should be far stricter.
- **Fix**: Apply `5 req/15min` to `/auth/login` and `/auth/register`. Keep global 500 for everything else.
- **Files affected**: `server.ts`, `auth.routes.ts`
- **Status**: [ ] Pending

---

## PHASE 2 — Security Hardening

### ✅ 6. RBAC Permission Matrix
- **Problem**: Routes only check `role` string (`admin`, `employee`). No granular permissions (e.g., `can_post_journal`, `can_void_sale`).
- **Fix**: Permission map in `authMiddleware.ts` — `requirePermission('post_journal')` derives from role.
- **Files affected**: `authMiddleware.ts`, all protected routes
- **Status**: [ ] Pending

### ✅ 7. Replace console.* with Pino Structured Logger
- **Problem**: 22+ `console.error()` / `console.log()` calls in production code. Leaks internals if logs are exposed.
- **Fix**: Central `logger.ts` using `pino`. All modules use `logger.error()` / `logger.info()`.
- **Files affected**: All backend modules
- **Status**: [ ] Pending

### ✅ 8. Audit Logging Middleware
- **Problem**: No record of who changed what. Deletions leave no trace.
- **Fix**: Middleware that logs all write operations (POST/PUT/DELETE) to `audit_logs` table with user, tenant, route, method, and payload summary.
- **Files affected**: `server.ts`, new `auditMiddleware.ts`, new Prisma model
- **Status**: [ ] Pending

---

## PHASE 3 — Mobile POS Completeness

### ✅ 9. POS Cart + Session Persistence
- **Problem**: Cart state and session ID lost on app restart (Zustand is in-memory). Crash = lost sale context.
- **Fix**: Persist cart to `Expo SecureStore`; rehydrate on app load. Reconnect to open session on startup.
- **Files affected**: `cartStore.ts`, `sessionStore.ts`, `app/_layout.tsx`
- **Status**: [ ] Pending

### ✅ 10. POS Void / Refund Flow
- **Problem**: Cashier cannot correct a mistake — no void or refund capability in the POS app.
- **Fix**: Add void endpoint to backend (`DELETE /pos/sale/:id`); add Void button on Receipt screen; reverse stock + GL.
- **Files affected**: `pos.routes.ts`, `app/receipt.tsx`, new `app/void.tsx`
- **Status**: [ ] Pending

---

## PHASE 4 — Operations & Observability

### ✅ 11. API Documentation (OpenAPI)
- **Problem**: No documentation for the 80+ API endpoints. Developers must read source code.
- **Fix**: `swagger-jsdoc` + `swagger-ui-express` generating live docs at `/api/docs`.
- **Status**: [ ] Pending

### ✅ 12. Basic Test Suite
- **Problem**: Zero test files found in the entire codebase.
- **Fix**: Jest unit tests for: tax calculation, order number generation, Factura creation, GL posting, auth middleware.
- **Status**: [ ] Pending

---

## Known Architectural Risks (Accepted for Now)

| Risk | Mitigation |
|------|-----------|
| No payment gateway | Manual cash/card recording only — acceptable for Bolivian SME context |
| No e-signature on Facturas | Manual Factura process until AFIP integration planned |
| No offline POS mode | App will show clear error if backend unreachable |
| No multi-currency FX | All amounts in BOB — flag for future |
| No Docker / CI-CD | Manual deployment — acceptable for MVP |

---

## Progress Tracker

| # | Improvement | Priority | Status |
|---|-------------|----------|--------|
| 1 | IVA/IT to shared config | CRITICAL | ✅ Done |
| 2 | Atomic order numbers | CRITICAL | ✅ Done |
| 3 | GL transaction safety | CRITICAL | ✅ Done |
| 4 | Zod input validation | CRITICAL | ✅ Done |
| 5 | Auth rate limiting | HIGH | ✅ Done |
| 6 | RBAC permissions | HIGH | ✅ Done |
| 7 | Pino structured logger | HIGH | ✅ Done |
| 8 | Audit logging | HIGH | ✅ Done |
| 9 | POS persistence | MEDIUM | ✅ Done |
| 10 | POS void/refund | MEDIUM | ✅ Done |
| 11 | API docs | LOW | ✅ Done |
| 12 | Test suite | LOW | ✅ Done |

---

*This document is updated automatically as improvements are completed.*
