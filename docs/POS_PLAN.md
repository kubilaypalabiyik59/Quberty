# Quberty POS — Android Development Plan
**Created:** 2026-04-05  
**Author:** Kubilay + Claude  
**Status:** Planning phase. ERP phases 1–5 complete. POS is next.

---

## 1. The Big Picture — How to Think About This

The POS is **not a new app**. It is a thin mobile client on top of the same backend you already have.  
Everything complex already exists:
- JWT auth → same `/api/v1/auth`
- Stock management → same inventory module
- Factura generation → same (and now race-condition safe)
- GL journal entries → same finance module
- Customer records → same CRM

What the POS adds is:
1. A **mobile UI** optimised for a cashier (speed, touch, barcode)
2. A **RegisterSession** concept (open/close register, float, Z-report)
3. One **atomic sale endpoint** that collapses the multi-step ERP flow into a single transaction

This is the right mental model: **mobile skin + one new endpoint + register management**.

---

## 2. Key Decisions (Make These Now)

### 2.1 Online-only vs Offline-first
**Decision: Online-only for v1.**

Offline-first sounds good until you implement it. You need:
- Local SQLite sync
- Conflict resolution when two terminals modify the same stock
- Merge strategy for facturas (sequential numbers are impossible offline)

For a shoe store in a Bolivian city, internet is available. If it drops for 30 seconds, the cashier waits.  
**Offline is a v2 feature if clients demand it.**

### 2.2 Payment Methods to Support Day 1
| Method | How to Handle |
|--------|--------------|
| Cash | Compute change in app (cash tendered - total) |
| QR (Tigo Money / Simple / QR Bolivia) | Mark as paid, external QR terminal handles it |
| Card | Mark as paid, external card terminal handles it |

For QR and card, the POS just records the payment method — the actual processing happens on the physical terminal. No payment gateway integration needed in v1.

### 2.3 Barcode Scanner
- **Phase 1:** Expo Camera scanning (works, free, no hardware needed)
- **Phase 2:** Bluetooth HID scanner — these appear as a keyboard to Android. No special code. Just focus a TextInput and the scanner types the barcode.

**Advice:** Buy a cheap Bluetooth HID scanner (~$15-$30) early for testing. It transforms the cashier UX.

### 2.4 Receipt
- **Phase 1:** On-screen receipt only (factura number + totals). Shareable as plain text via Expo Share.
- **Phase 2:** 58mm Bluetooth thermal printer via ESC/POS (react-native-thermal-receipt-printer or ble-plx + manual ESC/POS).

### 2.5 App Distribution
- Development: Expo Go on Android device
- Testing/staging: EAS Build → APK sideload
- Production: EAS Build → internal track Google Play, or direct APK distribution

---

## 3. Architecture

```
Android Device (Expo)
    │
    │  HTTPS + JWT + X-Tenant-ID
    │
    ▼
Express Backend (existing)
    │
    ├── /api/v1/auth          (existing — login)
    ├── /api/v1/pos/sessions  (NEW — register open/close)
    ├── /api/v1/pos/sale      (NEW — atomic sale)
    ├── /api/v1/products      (existing — product search)
    └── /api/v1/finance       (existing — read facturas)
```

### New Backend: `/api/v1/pos` module
Two routes only. Keep it simple.

**RegisterSession model (add to schema.prisma):**
```prisma
model RegisterSession {
  id             String    @id @default(uuid()) @db.Uuid
  tenant_id      String    @db.Uuid
  terminal_name  String
  opened_by      String    @db.Uuid
  opened_at      DateTime  @default(now())
  closed_by      String?   @db.Uuid
  closed_at      DateTime?
  opening_float  Decimal   @db.Decimal(12, 2)
  closing_float  Decimal?  @db.Decimal(12, 2)
  total_sales    Decimal   @default(0) @db.Decimal(14, 2)
  transaction_count Int    @default(0)
  status         String    @default("OPEN") // OPEN | CLOSED
  site_id        String?   @db.Uuid
  warehouse_id   String?   @db.Uuid
  created_at     DateTime  @default(now())

  @@index([tenant_id, status])
  @@map("register_sessions")
}
```

---

## 4. The Atomic Sale Endpoint — Most Critical Piece

`POST /api/v1/pos/sale`

This is the heart of the POS. One HTTP request, one database transaction, all-or-nothing.

**Request body:**
```json
{
  "session_id": "uuid",
  "customer_name": "Cliente Mostrador",
  "customer_nit": null,
  "payment_method": "CASH",
  "cash_tendered": 150.00,
  "lines": [
    { "product_id": "uuid", "variant_id": "uuid", "quantity": 2, "unit_price": 65.00, "discount_pct": 0 }
  ]
}
```

**What happens inside `db.$transaction()`:**
1. Validate session is OPEN and belongs to this tenant
2. For each line: check stock ≥ quantity, throw if not
3. For each line: deduct stock (OUTBOUND inventory transaction)
4. Create SalesOrder with status `COMPLETED` immediately (no DRAFT/CONFIRMED for POS)
5. Get next factura number via atomic SQL upsert on FacturaCounter
6. Create Factura (source_type: `POS_SALE`)
7. Create JE #1 — Sales invoice: Dr 1201 CxC / Cr 4101 Ventas + Cr 2105 IVA Débito Fiscal
8. Create JE #2 — COGS: Dr 5101 Costo de Ventas / Cr 1110 Inventario
9. Update RegisterSession: increment total_sales + transaction_count
10. Return: `{ order_id, factura_number, total, subtotal, iva_amount, change_due }`

**If ANY step fails → full rollback. The cashier sees an error and retries.**

---

## 5. React Native App Structure

```
skarpine-pos/               ← physically nested, independently versioned: its own Git
                              repository with its own remote (Quberty-POS), NOT tracked
                              by the parent repository (updated 2026-09-07)
├── app/
│   ├── _layout.tsx         ← root layout, auth guard
│   ├── login.tsx           ← screen 1
│   ├── open-register.tsx   ← screen 2
│   ├── sale.tsx            ← screen 3 (main POS screen)
│   ├── payment.tsx         ← screen 4
│   ├── receipt.tsx         ← screen 5
│   ├── z-report.tsx        ← screen 6
│   └── void.tsx            ← screen 7
├── lib/
│   ├── api.ts              ← axios instance (same pattern as ERP frontend)
│   ├── auth.ts             ← JWT storage via AsyncStorage
│   └── cart.ts             ← Zustand cart store
├── components/
│   ├── CartItem.tsx
│   ├── ProductCard.tsx
│   └── NumPad.tsx          ← reusable numpad for cash input
└── app.json
```

**Tech stack:**
```json
{
  "expo": "latest SDK",
  "expo-router": "file-based navigation",
  "expo-camera": "barcode scanning",
  "expo-secure-store": "JWT storage (more secure than AsyncStorage)",
  "expo-sharing": "receipt sharing",
  "@tanstack/react-query": "server state (same as ERP)",
  "zustand": "cart state (same as ERP)",
  "axios": "HTTP (same pattern as ERP)"
}
```

---

## 6. Screen-by-Screen Design

### Screen 1 — Login
- Fields: tenant slug, email, password
- On success: store JWT in SecureStore, store tenant_id
- Check for open RegisterSession for this device → skip to Sale if already open

### Screen 2 — Open Register
- Input: Terminal Name (e.g. "Caja 1"), Opening Float (cash in drawer)
- POST /api/v1/pos/sessions/open
- Navigate to Sale screen

### Screen 3 — Sale Screen (main)
```
┌─────────────────────────────────────────────┐
│ [🔍 Search product or scan barcode        ] │
│                                             │
│ CART                                        │
│ ─────────────────────────────────────────── │
│ Nike Air Max 42  ×2  Bs. 130.00      [✕]   │
│ Adidas Samba 40  ×1  Bs.  65.00      [✕]   │
│ ─────────────────────────────────────────── │
│ SUBTOTAL (sin IVA)          Bs. 172.57      │
│ IVA 13%                     Bs.  22.43      │
│ TOTAL                       Bs. 195.00      │
│                                             │
│              [ COBRAR ]                     │
└─────────────────────────────────────────────┘
```
- Search by product name OR barcode
- Tap product → adds to cart, quantity picker
- Swipe or X to remove from cart
- COBRAR button → Payment screen

### Screen 4 — Payment Screen
```
┌─────────────────────────────────────────────┐
│ Total a cobrar:  Bs. 195.00                 │
│                                             │
│ Método:  [ EFECTIVO ]  [ QR ]  [ TARJETA ]  │
│                                             │
│ Efectivo recibido:                          │
│ ┌─────────────────┐                         │
│ │     Bs. 200     │                         │
│ └─────────────────┘                         │
│ [1][2][3]                                   │
│ [4][5][6]                                   │
│ [7][8][9]                                   │
│ [.][0][⌫]                                   │
│                                             │
│ Cambio:  Bs. 5.00                           │
│                                             │
│         [ CONFIRMAR VENTA ]                 │
└─────────────────────────────────────────────┘
```
- Customer name / NIT optional (for Factura)
- NumPad for cash entry
- Change calculated live
- CONFIRMAR → POST /api/v1/pos/sale → Receipt screen

### Screen 5 — Receipt Screen
```
┌─────────────────────────────────────────────┐
│         ✅ VENTA CONFIRMADA                 │
│                                             │
│  FACTURA #000042                            │
│  Cliente: Cliente Mostrador                 │
│  Fecha: 05/04/2026                          │
│  ─────────────────────────────────────      │
│  Nike Air Max 42  ×2       Bs. 130.00       │
│  Adidas Samba 40  ×1       Bs.  65.00       │
│  ─────────────────────────────────────      │
│  Subtotal:                 Bs. 172.57       │
│  IVA (13%):                Bs.  22.43       │
│  TOTAL:                    Bs. 195.00       │
│  Efectivo:                 Bs. 200.00       │
│  Cambio:                   Bs.   5.00       │
│                                             │
│  [ 🖨 IMPRIMIR ]    [ NUEVA VENTA ]         │
└─────────────────────────────────────────────┘
```
- NUEVA VENTA → clears cart, back to Sale screen
- IMPRIMIR → Expo Share (text/PDF) in Phase 1, BLE printer in Phase 2

### Screen 6 — Z-Report (Close Register)
- Shows: session open time, total transactions, total sales, total cash expected
- Input: actual cash counted (closing float)
- POST /api/v1/pos/sessions/:id/close
- Displays full Z-report summary
- Logs out / back to Login

### Screen 7 — Void Sale
- Search by Factura # or Order #
- Triggers existing `POST /api/v1/sales/orders/:id/return` endpoint
- Same return flow as ERP (stock restored, credit note, JE reversal)

---

## 7. Build Order (Strict Sequence)

| # | Task | Why this order |
|---|------|---------------|
| 1 | Add `RegisterSession` to `schema.prisma` + `prisma db push` | Schema first, before any backend work |
| 2 | `POST /api/v1/pos/sessions/open` + `close` + `GET current` | Backend sessions before atomic sale (sale needs session_id) |
| 3 | `POST /api/v1/pos/sale` atomic endpoint | Most complex backend piece — test with Postman before touching RN |
| 4 | Concurrent test: hit `/pos/sale` 10× simultaneously | Verify FacturaCounter and stock deduction are truly atomic |
| 5 | Expo project init (`npx create-expo-app skarpine-pos`) | RN setup |
| 6 | Login screen + JWT SecureStore | Auth gate — nothing works without this |
| 7 | Open Register screen | Session management |
| 8 | Sale screen — product search (name only first) | Core UX, no barcode yet |
| 9 | Cart logic (Zustand) | Cart state before payment |
| 10 | Payment screen + NumPad | Cash flow |
| 11 | Wire POST /pos/sale → Receipt screen | End-to-end first sale |
| 12 | Z-Report screen | Register close |
| 13 | Expo Camera barcode scanning | Enhancement |
| 14 | Void Sale screen | Exception flow |
| 15 | EAS Build → APK | First installable build |
| 16 | BLE receipt printing | Phase 2 |

---

## 8. My Advice

### 1. Do backend first, test it brutally before writing a single RN screen
The atomic sale endpoint is the hardest piece. Test it with Postman, simulate concurrent requests, make sure the FacturaCounter and stock deduction behave correctly under load. If the backend is solid, the mobile UI is easy.

### 2. The NumPad is deceptively important
Cashiers use the payment screen 100× a day. Build a responsive, error-proof NumPad component first. Decimal handling, backspace, max-value guard. Get it right early.

### 3. Don't support customer NIT on every sale — make it optional
In Bolivia, most retail transactions are "Cliente Mostrador" (anonymous buyer). Only require NIT when the customer specifically asks for a factura with their tax ID. Make it a quick-access optional field, not a required step.

### 4. Product search UX matters more than you think
For a shoe store with hundreds of variants: "Nike Air Max" → 20 results with 6 sizes each = 120 rows. Design the search result to show product name + variant attributes clearly, and add to cart in one tap. Barcode scanning solves this completely — push for hardware scanner early.

### 5. Use the same Zustand + TanStack Query pattern as the ERP frontend
You already know how it works. `useQuery` for product search, Zustand for cart state, `useMutation` for the sale. Don't introduce new patterns.

### 6. Handle network errors gracefully
Online-only means the cashier WILL see errors. If `/pos/sale` fails:
- Show a clear error (out of stock / network error / server error)
- The cart stays intact — don't clear it on error
- Let the cashier retry or void

### 7. SecureStore over AsyncStorage for the JWT
AsyncStorage is not encrypted on Android. Use `expo-secure-store` for the JWT token. AsyncStorage is fine for non-sensitive preferences (terminal name, theme).

### 8. Terminal name = device identity
Set it once at first Open Register and save to AsyncStorage. Pre-fill it on all subsequent register opens. This is how you track which device made which sale.

### 9. EAS Build early — don't develop only on Expo Go
Expo Go has limitations (some native modules don't work). Set up EAS Build in week 1 and generate a development build. This avoids surprises later when you add the camera or BLE printer.

### 10. The Z-Report is your end-of-day ritual — make it satisfying
This is the cashier's daily closing ceremony. Make it clear, complete, and printable. Show: opening float, total sales, expected cash, actual cash counted, overage/shortage. A good Z-report builds trust with the business owner.

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stock goes negative under concurrent POS sales | Low (FacturaCounter fixed, stock check inside transaction) | High | Test with concurrent Postman requests before going live |
| Internet drops mid-sale | Medium | Medium | The transaction never started → cart is safe, show "retry" |
| Factura number gap if transaction rolls back | Zero | High | FacturaCounter atomic upsert handles this — rollback doesn't decrement |
| Camera barcode slow to scan in dim light | High | Medium | BLE hardware scanner as Phase 2 fallback |
| ESC/POS printer compatibility varies | High | Low | Phase 2 only — Phase 1 uses Share |
| Google Play review delays distribution | Low | Medium | Distribute as direct APK sideload to avoid Play Store for internal use |

---

## 10. What "Done" Looks Like

The POS is done when a cashier can:
1. Open the app on an Android phone
2. Log in with their ERP credentials
3. Open the register with an opening float
4. Search for a product, add to cart, adjust quantity
5. Accept cash payment, see change due
6. Get a receipt with a valid sequential Factura number
7. Close the register at end of day with a Z-report

Everything else (printing, QR payment, offline mode, void) is enhancement.
