# Quberty POS — Android Tablet App Development Plan
**Created:** 2026-04-05  
**Platform:** React Native + Expo SDK 51 (Android-first)  
**Backend:** Skarpine ERP — `http://localhost:3001/api/v1`

---

> ## Current status — added 2026-09-07
>
> **This document is the original implementation plan and is preserved as such.** Its checklists
> describe what was *planned*, not what is finished. Nothing below is marked complete by this note.
>
> What is true today:
>
> - An **incomplete** POS implementation exists. It is not finished and must not be reported as
>   delivered.
> - It is preserved in its own private remote repository, `Quberty-POS`, on branch
>   `codex/wip-incomplete-pos-2026-09-06` at `09fa4de`. Git recoverability is therefore resolved.
> - `skarpine-pos/` is physically nested inside the ERP checkout but **independently versioned**.
>   The parent repository no longer tracks it: it was never *configured* as a Git submodule (no
>   `.gitmodules` entry ever existed), but the parent index did represent it as an unregistered
>   gitlink, and that gitlink was removed in the V1 reconstruction commit.
> - The POS type-check still reports **five known TypeScript errors**: one missing argument in
>   `app/pos.tsx`, one missing `CartLine.key` in `VariantPicker.tsx`, and three Zustand
>   persist-storage type incompatibilities.
> - POS work is **out of scope** until Kubi explicitly scopes it.

---

## Architecture Decisions (Final)

| Concern | Choice | Reason |
|---|---|---|
| Framework | React Native + Expo | Same TS stack as ERP, shared patterns |
| Navigation | Expo Router (file-based) | Same mental model as Next.js App Router |
| Server state | TanStack Query v5 | Same as ERP frontend |
| Cart state | Zustand | Same as ERP frontend |
| Auth storage | expo-secure-store | JWT stored securely on device |
| HTTP client | Axios | Same as ERP frontend |
| Barcode | expo-camera + expo-barcode-scanner | Expo managed |
| Receipt | expo-sharing + plain text | Phase 1; BLE printer in Phase 2 |
| Build | EAS Build → APK | Expo Application Services |

---

## Backend Status (Already Built ✅)

All backend infrastructure was built before the app:

| Endpoint | Status | Notes |
|---|---|---|
| `POST /auth/login` | ✅ | Returns JWT + user + tenant |
| `POST /pos/sessions/open` | ✅ | Creates RegisterSession |
| `GET /pos/sessions/current?terminal_name=` | ✅ | Checks if register is open |
| `GET /pos/sessions` | ✅ | List all sessions |
| `POST /pos/sessions/:id/close` | ✅ | Returns Z-report data |
| `POST /pos/sale` | ✅ | Atomic: stock→SO→factura→JEs |
| `GET /products` | ✅ | With search, inStock filter |
| `GET /products/:id` | ✅ | With variants + stock per variant |
| `GET /products/barcode/:code` | ✅ (to add) | Fast barcode lookup |
| `GET /customers?search=` | ✅ | Name/email/phone search |
| `POST /customers` | ✅ | Create new customer |
| `GET /inventory/stock?product_id=` | ✅ | Stock query screen |

---

## Screen Map

```
Login
  └── Open Register
        └── [POS Main - Split Layout]
              ├── Left Panel: Product Grid
              │     ├── Search bar (name + barcode scan)
              │     ├── Category filter tabs
              │     └── Product cards (name, price, stock badge)
              │           └── Variant Picker modal
              └── Right Panel: Cart
                    ├── Customer selector (search / create)
                    ├── Line items (qty +/-)
                    ├── Totals (Subtotal / IVA / IT / Total)
                    └── [COBRAR] button
                          └── Payment Modal
                                ├── CASH → numpad → change display
                                └── CARD/TRANSFER → confirm
                                      └── Receipt Screen
                                            └── [NUEVA VENTA] → clears cart
                                                  OR
                                            [CERRAR CAJA] → Z-Report → Login
```

---

## Phase 1 — Core Loop (Build First)

### Step 1: Project Setup
- `npx create-expo-app skarpine-pos --template blank-typescript`
- Install: `expo-router`, `@tanstack/react-query`, `zustand`, `axios`, `expo-secure-store`
- Configure `app.json`: Android package name, tablet orientation lock

### Step 2: API Client + Auth
- Axios instance with `X-Tenant-ID` header from SecureStore
- JWT auto-attach interceptor
- Login screen: email + password → store JWT

### Step 3: Open Register Screen
- Terminal name input + opening float numpad
- `POST /pos/sessions/open` → store session_id in Zustand

### Step 4: POS Main Screen (Split Layout)
- Left 60%: ProductGrid with TanStack Query
- Right 40%: CartPanel (Zustand)
- Product card tap → variant picker → add to cart

### Step 5: Payment + Sale
- COBRAR button → PaymentModal
- Cash: numpad, shows change due
- `POST /pos/sale` → receipt screen

### Step 6: Receipt Screen
- Factura number, items, totals, change
- NUEVA VENTA button (clears cart)

---

## Phase 2 — Polish

### Step 7: Barcode Scanner
- Camera button on search bar
- `expo-camera` → scan → lookup product → add to cart

### Step 8: Customer Management
- Customer search drawer (right side)
- Create new customer inline

### Step 9: Z-Report + Close Register
- CERRAR CAJA button (requires admin PIN or role check)
- Shows session summary: sales count, total, over/short
- `POST /pos/sessions/:id/close`

### Step 10: Stock Query Screen
- Separate tab/button
- Search product → see all variants + stock per location

---

## Phase 3 — Production

- EAS Build → signed APK
- BLE thermal printer (58mm / 80mm)
- Offline queue (SQLite via expo-sqlite)
- Daily sales summary push notification

---

## Key Rules

- Bolivia IVA 13% is **inclusive**: never add on top of price
- IT 3% = subtotal × 0.03 (display only — backend computes it)
- Stock check is server-side at `POST /pos/sale` — client shows warning but server enforces
- `X-Tenant-ID` header must be sent on every API call
- `session_id` must be passed in every `POST /pos/sale` call
- Factura number comes back from backend — never generated client-side

---

## Deliverables

- [ ] `skarpine-pos/` — full Expo project
- [ ] Login + Register Open flow
- [ ] Full POS sale loop (product → cart → payment → receipt)
- [ ] Customer search + create
- [ ] Barcode scanning
- [ ] Z-Report
- [ ] Stock Query screen
- [ ] EAS Build configuration
