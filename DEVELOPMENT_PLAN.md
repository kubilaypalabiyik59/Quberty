# Quberty ERP — Development Plan
**Created:** 2026-04-03  
**Stack:** Next.js 14 · Express + Prisma · Supabase PostgreSQL  
**End goal:** Stable ERP → Android POS

---

## PHASE 1 — Fix Bugs & Close Critical Accounting Gaps ✅ DONE
> Goal: Books are complete and correct. Every transaction that moves money or inventory has a matching journal entry.

### 1.1 COGS Auto-JE on Shipment ✅ DONE
Auto-JE added in `sales.service.ts` `shipOrder()`: Dr 5101 Costo de Ventas / Cr 1110 Inventario.

---

### 1.2 Fix Duplicate + Buggy Inventory Adjustment Routes ✅ DONE
Only `POST /adjust` remains in `inventory.routes.ts`. Buggy `/adjustments` route is gone.

---

### 1.3 Dashboard Data ✅ DONE
Dashboard page calls `GET /reports/dashboard` + `GET /reports/daily-revenue`. Full KPI cards, revenue chart (monthly/daily toggle), top products table, and activity feed all wired up.

---

## PHASE 2 — Sales Returns & Credit Notes ✅ DONE
> Goal: Retail needs to handle returns.

### 2.1 Backend — Sales Return Flow ✅ DONE
`POST /api/v1/sales/orders/:id/return` — stock restoration, credit note Factura, 3-JE reversal (invoice + COGS + payment if paid), RETURNED status.

### 2.2 Frontend — Return Button ✅ DONE
Return button added to SO list page (pink, visible for SHIPPED/COMPLETED orders without `returned_at`). Confirmation dialog before firing.

---

## PHASE 3 — Factura Sequential Number Race Condition ✅ DONE
> Goal: Fix before POS. Legal requirement in Bolivia — factura numbers must be strictly sequential with no gaps or duplicates.

**What:** Current implementation (`finance.routes.ts:196`):
```ts
const lastFactura = await db.factura.findFirst({ orderBy: { factura_number: 'desc' } });
const facturaNumber = (lastFactura?.factura_number ?? 0) + 1;
```
This is a race condition — two concurrent requests (e.g. two POS terminals) will read the same `lastFactura` and generate duplicate numbers.

**Fix:** Replace with a PostgreSQL sequence:
```sql
CREATE SEQUENCE factura_seq_<tenant_id> START 1;
SELECT nextval('factura_seq_<tenant_id>');
```
Or simpler: wrap in a `db.$transaction` with `SELECT FOR UPDATE` on a `FacturaCounter` table (one row per tenant).

**Approach:**
1. Add `FacturaCounter` model to Prisma schema (tenant_id, last_number)
2. In factura creation: `db.$transaction` → SELECT FOR UPDATE counter row → increment → use as factura_number
3. Apply same fix in both `finance.routes.ts` (manual factura) and `sales.routes.ts` (order invoice)

---

## PHASE 4 — Frontend Finance Pages ✅ DONE
> Goal: The backend finance APIs are built. The frontend needs pages to use them.

### 4.1 AR Aging Page ✅ DONE
`/finance/aging` — combined AR/AP tab view, bucket summary cards (0-30/31-60/61-90/90+), detail table.

### 4.2 AP Aging Page ✅ DONE
Same page as AR, tab-switched. Calls `GET /finance/ap-aging`.

### 4.3 P&L Report Page ✅ DONE
`/finance/p-and-l` — month/year picker, revenue (4xxx) + expenses (5xxx) tables, net income summary. Calls `GET /finance/profit-loss`.

### 4.4 Balance Sheet Page ✅ DONE
`/finance/balance-sheet` — as-of date picker, Assets / Liabilities / Equity sections, "Balanced" indicator. Calls `GET /finance/balance-sheet`.

### 4.5 Period Closing ✅ DONE
`/finance/periods` — list all periods (OPEN/CLOSED), Close Period + Reopen buttons (admin only). Calls `GET /finance/periods`, `POST /finance/periods/:year/:month/close|reopen`.

### 4.6 Bank Reconciliation ✅ DONE
`/finance/bank-reconciliation` — period picker + optional statement balance input, shows full bank ledger (1101) with running balance, opening/closing balance, difference indicator.

---

## PHASE 5 — HR Payroll ✅ DONE
> Goal: Record salary payments so staff costs appear in P&L.

### 5.1 Backend — Payroll Run
**New route:** `POST /api/v1/hr/payroll`

**Logic:**
1. Input: period (year/month), list of employee_id + gross_salary + deductions
2. Create JE:
   - Dr 5201 Gastos de Administración (or 5202 Gastos de Venta) → gross salary
   - Cr 2101-like "Sueldos por Pagar" account → net payable
   - Cr tax/deduction accounts as needed
3. Mark payroll period as processed (prevent double-run)

### 5.2 Frontend — Payroll Page
- Employee list with salary input
- Run Payroll button
- History of past payroll runs

---

## PHASE 6 — Android POS (React Native + Expo)
> Full plan: see `docs/POS_PLAN.md`

### Architecture
- **Platform:** React Native + Expo SDK, Android-first, online-only (v1)
- **Auth:** Same JWT + X-Tenant-ID as ERP — SecureStore for token on device
- **Navigation:** Expo Router (file-based, same mental model as Next.js App Router)
- **State:** TanStack Query (server) + Zustand (cart) — same pattern as ERP frontend
- **Multi-terminal:** Each device = one `RegisterSession` (open/close register)

### 6.1 Backend — RegisterSession Model + Routes
**New Prisma model:** `RegisterSession`
```prisma
model RegisterSession {
  id              String    @id @default(uuid()) @db.Uuid
  tenant_id       String    @db.Uuid
  terminal_name   String
  opened_by       String    @db.Uuid
  opened_at       DateTime  @default(now())
  closed_by       String?   @db.Uuid
  closed_at       DateTime?
  opening_float   Decimal   @db.Decimal(12, 2)
  closing_float   Decimal?  @db.Decimal(12, 2)
  total_sales     Decimal   @default(0) @db.Decimal(14, 2)
  transaction_count Int     @default(0)
  status          String    @default("OPEN") // OPEN | CLOSED
  site_id         String?   @db.Uuid
  warehouse_id    String?   @db.Uuid
  created_at      DateTime  @default(now())
  @@index([tenant_id, status])
  @@map("register_sessions")
}
```
**New routes** (`/api/v1/pos/sessions`):
- `POST /open` — open register, record opening float
- `POST /:id/close` — record closing float, mark CLOSED → return Z-report data
- `GET /current` — get open session for this terminal (by terminal_name header)

### 6.2 Backend — Atomic Sale Endpoint
**New route:** `POST /api/v1/pos/sale`

Single `db.$transaction()` — all-or-nothing:
1. Validate RegisterSession is OPEN
2. Stock check per line (throw if insufficient)
3. Stock deduction — OUTBOUND InventoryTransaction per line
4. Create SalesOrder (status: `COMPLETED` immediately — no workflow for POS)
5. Atomic factura number via FacturaCounter upsert
6. Create Factura (source_type: `POS_SALE`)
7. JE #1: Dr 1201 CxC / Cr 4101 Ventas + Cr 2105 IVA Débito Fiscal
8. JE #2: Dr 5101 Costo de Ventas / Cr 1110 Inventario
9. Update RegisterSession total_sales + transaction_count
10. Return: `{ order_id, factura_number, total, subtotal, iva_amount, it_amount, change_due }`

**Concurrency test before mobile work:** hit `/pos/sale` 10× simultaneously with Postman. Verify no duplicate factura numbers and no negative stock.

### 6.3 React Native App — Screens
| Screen | Route | Purpose |
|--------|-------|---------|
| Login | `/login` | Tenant slug + email + password → JWT to SecureStore |
| Open Register | `/open-register` | Terminal name + opening float → POST /pos/sessions/open |
| Sale | `/sale` | Product search (name + barcode), cart, IVA display, COBRAR button |
| Payment | `/payment` | Payment method, NumPad for cash, change calc, CONFIRMAR |
| Receipt | `/receipt` | Factura #, totals, change, print/share, NUEVA VENTA |
| Z-Report | `/z-report` | Closing float input, session summary, close register |
| Void Sale | `/void` | Search by factura #, trigger return endpoint |

### 6.4 Barcode Scanner
- Phase 1: `expo-camera` — scan via phone camera → lookup `product.barcode` → add to cart
- Phase 2: Bluetooth HID scanner — works as keyboard input, no code needed beyond a focused TextInput

### 6.5 Receipt Printing — Phase 2
- Phase 1: `expo-sharing` — share receipt as plain text or PDF
- Phase 2: `react-native-thermal-receipt-printer` or `react-native-ble-plx` + ESC/POS for 58mm/80mm Bluetooth printer

### Build Order (strict sequence)
1. `RegisterSession` in schema.prisma + `prisma db push`
2. Backend: session open/close/current routes
3. Backend: atomic sale endpoint
4. **Concurrency test** (Postman) before any mobile work
5. `npx create-expo-app skarpine-pos` + Expo Router setup
6. Login screen + SecureStore JWT
7. Open Register screen
8. Sale screen — name search first (no barcode yet)
9. Cart (Zustand)
10. Payment screen + NumPad component
11. Wire POST /pos/sale → Receipt screen (first end-to-end sale)
12. Z-Report screen
13. Expo Camera barcode scanning
14. Void Sale screen
15. EAS Build → APK (first installable)
16. BLE receipt printing (Phase 2)

---

## Full Priority Order (Sequence to Execute)

| # | Task | Phase | Status |
|---|------|-------|--------|
| 1 | COGS auto-JE on shipment | 1.1 | ✅ Done |
| 2 | Remove buggy `/adjustments` route | 1.2 | ✅ Done |
| 3 | Dashboard frontend | 1.3 | ✅ Done |
| 4 | Sales return backend | 2.1 | ✅ Done |
| 5 | Sales return frontend (Return button) | 2.2 | ✅ Done |
| 6 | Factura sequence race condition fix | 3 | ✅ Done |
| 7 | AR Aging frontend page | 4.1 | ✅ Done |
| 8 | AP Aging frontend page | 4.2 | ✅ Done |
| 9 | P&L frontend page | 4.3 | ✅ Done |
| 10 | Balance Sheet frontend page | 4.4 | ✅ Done |
| 11 | Period closing frontend | 4.5 | ✅ Done |
| 12 | Bank reconciliation basic | 4.6 | ✅ Done |
| 13 | HR Payroll backend + frontend | 5 | ✅ Done |
| 14 | POS: RegisterSession schema + session routes | 6.1 | ✅ Done |
| 15 | POS: Atomic sale endpoint + barcode lookup | 6.2 | ✅ Done |
| 16 | POS: Expo app — Login + Open Register | 6.3a | ✅ Done |
| 17 | POS: Sale screen + cart + payment + receipt | 6.3b | ✅ Done |
| 18 | POS: Z-Report screen | 6.3c | ✅ Done |
| 19 | POS: Barcode scanner (expo-camera) | 6.4 | 🟡 Next |
| 20 | POS: EAS Build → APK | 6.3d | 🟡 Not started |
| 21 | POS: BLE receipt printing | 6.5 | 🟡 Not started (Phase 2) |

---

## Rules That Don't Change

- Bolivia IVA 13% is **always inclusive**: `iva = total - total/1.13` — never additive
- IT 3% is on net subtotal (after extracting IVA)
- `InventoryStock` compound unique has nullable `variant_id` → always `findFirst + update/create`, never `upsert`
- All auto-JEs are **non-fatal** (try/catch) except the POS atomic sale which must be all-or-nothing
- `prisma generate` on Windows requires stopping the server first (DLL lock)
- Error format: `{ success: false, error: { message, code } }` — don't change this
