# Quberty ERP — Marketing Landing Page (spec)

Date: 2026-09-25 · Author: Claude (architect) · Implementer: local model (Ornith-1.5-9B via Aider)
Status: **APPROVED 2026-09-25** — D1 accepted, D3 address supplied, §7 claims accepted by Kubi.

---

## 0. Work-item header (CLAUDE.md §4)

| Field | Value |
|---|---|
| Catalog IDs | None. This is product marketing, not an ERP business process. No BPC mapping applies. |
| Scope status | In scope — first pilot task for the local implementer. |
| Implementation evidence | None yet. The failed earlier attempt was deleted on 2026-09-25 (two `landing.html` files, `app/(landing)/page.tsx`, and a stray comment block in `globals.css`). |
| Parameter owner | N/A. There is no configuration; all copy lives in typed dictionaries (§5). |
| Schema-hook decision | None needed. Frontend only. No backend, Prisma, or API change. |
| Localization effect | UI copy in EN / TR / ES. No tax, number-format, or document-numbering effect. |
| Acceptance evidence | §8. |

---

## 1. Purpose and audience

The landing page sells Quberty ERP to owners and managers of businesses with **5–50 people**.
These businesses have outgrown spreadsheets and cannot justify an enterprise ERP. The reader is
not an ERP expert, so the page speaks in terms of their day (stock, orders, cash, stores), not
module names.

The Bolivia pilot is **not** mentioned anywhere on the page (Kubi, 2026-09-25).

### Claims policy (hard rule)

Every capability the page names must exist in the product today. The allowed claims and their
repo evidence:

| Claim | Evidence (repo-verified) |
|---|---|
| Sales: quotations and sales orders | `frontend/src/app/(erp)/sales`, `docs/design/PROSPECT_TO_QUOTE_AND_ATTACHMENTS_2026-09-18.md` |
| CRM: prospects through to quotes | `frontend/src/app/(erp)/crm` |
| Purchasing and procurement | `frontend/src/app/(erp)/purchase`, `(erp)/procurement` |
| Inventory across several stores/warehouses | `frontend/src/app/(erp)/inventory` |
| Warehouse: arrivals, waves, work, locations | `frontend/src/app/(erp)/warehouse/{arrival,waves,work,locations}` |
| Finance: chart of accounts, journals, periods, bank reconciliation, AR/AP aging, P&L, balance sheet, exchange rates | `frontend/src/app/(erp)/finance/*` |
| Point of sale app | `skarpine-pos/` (Expo) |
| Online store | `frontend/src/app/(store)` |
| People / HR | `frontend/src/app/(erp)/hr` |
| Dashboards and reports | `frontend/src/app/(erp)/reports/ceo-dashboard`, `(erp)/dashboard` |
| Audit trail | `frontend/src/app/(erp)/audit` |
| Data import | `frontend/src/app/(erp)/import` |

**Forbidden:** customer counts, customer logos, testimonials, uptime or performance numbers,
"AI" features, certifications, integrations that do not exist, prices, and any country-specific
tax claim. If a sentence needs one of these to work, it is cut.

---

## 2. Decisions (Kubi to confirm)

| # | Decision | Recommendation | Consequence |
|---|---|---|---|
| D1 | Route — **accepted** | Landing at `/`. Replaces the redirect in `frontend/src/app/page.tsx`. | A signed-in user who opens `/` now sees the landing page and reaches the app via "Sign in", because `/login` already forwards a live session to `/dashboard` (`tests/e2e/10-session.spec.ts:26-27`). `10-session.spec.ts:24-25` must change (see T10). Long term the ERP belongs on an `app.` subdomain; this spec does not depend on that. |
| D2 | Theme | Landing is **always dark**, independent of the ERP theme toggle. | Same reasoning as the sign-in panel (`globals.css`, "brand panel" comment): the brand imagery needs a dark surround, and the brand looks the same to every visitor. |
| D3 | Primary CTA — **decided** | "Request a demo" → `mailto:` address | `DEMO_EMAIL = 'kubilaypalabiyik@gmail.com'`, defined once in `content.ts` (Kubi, 2026-09-25). |
| D4 | Language selection | `?lang=` query param, then cookie `quberty_lang`, then `Accept-Language`, then `en`. | No i18n library. No locale path segments (`/tr/...`), which keeps the route tree unchanged. |
| D5 | Hero visual | Reuse the existing sign-in stage (`components/brand/LoginStage.tsx`) and wordmark (`components/brand/QubertyWordmark.tsx`) unchanged. | One brand across sign-in and marketing. See the §4 note on `position: fixed`. |

---

## 3. Visual direction

- **Brand already exists, and the landing page reuses it.** It consists of the silver `QUBERTY`
  wordmark in Syncopate with a light sweep, the glass cube floating in a teal beam, a near-black
  stage, and IBM Plex Sans for all other text. Nothing new is invented.
- **Tokens only.** The page root carries `className="dark bg-bg text-fg"`. `globals.css` defines
  the dark token set under `.dark`, so every `bg-surface`, `text-fg-muted`, `border-border`,
  `bg-accent` and similar class resolves to its dark value inside the landing page, whatever theme
  the ERP is using. **No raw colours, no hex values, no arbitrary Tailwind values
  (`text-[13px]`, `bg-[#...]`).** The one exception is §4 T3's heading size (see below).
- **Type scale.** The product scale (`micro` … `display`) is built for a dense ERP and tops out at
  30px. A marketing page needs larger headings. Add **two** marketing sizes to
  `tailwind.config.ts` `fontSize`, and nothing else:
  - `hero`: `['clamp(2.5rem, 6vw, 4.5rem)', { lineHeight: '1.05', letterSpacing: '-0.03em' }]`
  - `section`: `['clamp(1.75rem, 3.5vw, 2.5rem)', { lineHeight: '1.15', letterSpacing: '-0.02em' }]`
- **Layout.**
  - Content width `max-w-6xl mx-auto px-4 sm:px-6`.
  - Vertical rhythm between sections `py-24 sm:py-32`.
  - Radius: `rounded-surface` for cards and `rounded-control` for buttons, with no other radii.
  - Shadows: none. Depth comes from borders (`border border-border`) and surface tone, as
    elsewhere in the product.
- **Motion.** A section fades up once when it enters the viewport, using framer-motion
  `whileInView` with `viewport={{ once: true }}` and `initial={{ opacity: 0, y: 12 }}`, duration
  0.4s. Nothing else moves apart from the hero stage. Under `prefers-reduced-motion` nothing
  animates: use framer-motion's `useReducedMotion()` and render the final state.
- **Icons.** Use `lucide-react` (already a dependency), 20px, `text-accent`, with at most one icon
  per card.

---

## 4. Page structure and tasks

Every task below is one Aider run with an explicit file list. Files live under
`frontend/src/app/(landing)/` unless stated otherwise. Each component is a server component
unless it is marked *client*.

```
app/page.tsx                          ← D1: delete (route moves to the group below)
app/(landing)/page.tsx                ← T10 assembly
app/(landing)/i18n/{en,tr,es}.ts      ← T0 (architect: generated from §6, not by the model)
app/(landing)/i18n/types.ts           ← T1
app/(landing)/i18n/getLocale.ts       ← T1
app/(landing)/i18n/getDictionary.ts   ← T1
app/(landing)/content.ts              ← T1 (DEMO_EMAIL, section ids)
app/(landing)/_components/Reveal.tsx          ← T2 (client)
app/(landing)/_components/CtaLink.tsx         ← T2 (client)
app/(landing)/_components/LanguageSwitcher.tsx← T2 (client)
app/(landing)/_components/LandingHeader.tsx   ← T2
app/(landing)/_components/Hero.tsx            ← T3
app/(landing)/_components/Problem.tsx         ← T4
app/(landing)/_components/OneSystem.tsx       ← T5
app/(landing)/_components/Capabilities.tsx    ← T6
app/(landing)/_components/Flows.tsx           ← T7
app/(landing)/_components/Foundation.tsx      ← T8
app/(landing)/_components/FinalCta.tsx        ← T9
app/(landing)/_components/LandingFooter.tsx   ← T9
```

Every component receives `t: LandingDictionary` (and `locale` where needed) as props. **No
component contains user-visible text of its own.** All text comes from `t`.

### T0 — Dictionary files (architect)

`en.ts`, `tr.ts` and `es.ts` are generated mechanically from §6 by the architect. Copying 600 lines
of text verbatim is not a meaningful task for the model, and it is where a small model is most
likely to "improve" the copy. `en.ts` is the source of truth and is **not** annotated.
`tr.ts` and `es.ts` import `type { LandingDictionary } from './types'` and are annotated with it.
This way TypeScript rejects a missing or extra key in either translation.

### T1 — Locale types, resolution and dictionary lookup

- `types.ts`:
  - `export const LOCALES = ['en', 'tr', 'es'] as const;`
  - `export type Locale = (typeof LOCALES)[number];`
  - `export type LandingDictionary = typeof en;`, with `import type { en }` taken from `./en`.
    Do not annotate `en` itself, because that would be a circular type reference.
  - `export function isLocale(value: unknown): value is Locale`.
- `getLocale.ts`: `export function getLocale(searchParams: { lang?: string | string[] }): Locale`.
  It returns the first supported value from the following sources, in order:
  1. `searchParams.lang`. If it is an array, use its first element.
  2. The `quberty_lang` cookie, read with `cookies().get('quberty_lang')?.value` from
     `next/headers`. In Next 14.1 this is synchronous.
  3. `headers().get('accept-language')`:
     - Split on `,` and parse each entry's `q=` weight, defaulting to 1.
     - **Drop entries with `q=0`.**
     - Sort by weight, highest first. The sort must be stable, so that header order breaks ties.
     - Reduce each tag to its primary subtag, lower-cased (`tr-TR` → `tr`, `es-419` → `es`).
     - Take the first entry that `isLocale` accepts.
  4. `'en'`.

  Values are trimmed and lower-cased before they are checked. Malformed input never throws.
- `getDictionary.ts`: `export function getDictionary(locale: Locale): LandingDictionary`, which
  returns `en`, `tr` or `es` through a `Record<Locale, LandingDictionary>` map.
- `content.ts`:
  - `export const DEMO_EMAIL = 'kubilaypalabiyik@gmail.com';`
  - `export const SECTION_IDS = { product: 'product', capabilities: 'capabilities', how: 'how-it-works' } as const;`
  - `export const LANG_COOKIE = 'quberty_lang';`. `getLocale.ts` imports this constant rather than
    repeating the string.

### T2 — Header, language switcher, reveal wrapper

- `Reveal.tsx` (*client*): wraps its children in the §3 fade-up animation and respects reduced
  motion.
- `LanguageSwitcher.tsx` (*client*):
  - Props `{ locale, labels }`.
  - Renders three buttons, `EN · TR · ES`, as a segmented control
    (`rounded-control border border-border`), with the active one in `bg-surface-raised text-fg`
    and the others in `text-fg-muted`.
  - Each button is a real `<button>` with `aria-pressed` and `lang` set to its own language, and
    the control has `aria-label={labels.languageLabel}`.
  - On click it sets `document.cookie = 'quberty_lang=<l>; path=/; max-age=31536000; samesite=lax'`
    and then calls `router.replace('/?lang=<l>', { scroll: false })` followed by `router.refresh()`.
- `LandingHeader.tsx`:
  - `sticky top-0 z-40`, height 64px, `bg-bg/70 backdrop-blur border-b border-border`.
  - Left: `<QubertyWordmark sweep="once" className="text-lg" />` linking to `/`.
  - Centre, `md+` only: anchor links to the three `SECTION_IDS`.
  - Right: `LanguageSwitcher`, then a `Sign in` link (`/login`, ghost style), then a
    `Request a demo` link (`mailto:`, primary style).
  - Every CTA link on the page is rendered through `CtaLink` (below). It is never styled
    inline.
- `CtaLink.tsx` (*client*):
  - Props `{ href, variant: 'primary' | 'outline' | 'ghost', size?: 'md' | 'lg', children }`.
  - Styles itself with `buttonVariants({ variant, size })` from `@/components/ui/Button`
    (exported at `Button.tsx:65`).
  - Renders `next/link` for internal hrefs and a plain `<a>` for `mailto:` hrefs.
  - **It must be a client component.** `Button.tsx` is `'use client'`, so calling
    `buttonVariants()` from a server component throws at render time ("Attempted to call … from
    the server"). Do not work around this by editing `Button.tsx`.
  - On mobile (< `md`) the centre links are hidden, and only the switcher and the primary CTA stay
    on the right.

### T3 — Hero

- A `<section>` with `relative min-h-[100svh]` (the one allowed arbitrary value) and no background
  of its own.
- `<LoginStage />` is rendered once, as the first child of the page (T10), not inside Hero.
  **Note:** `.stage` is `position: fixed` (`brand.module.css:49`). It therefore stays behind the
  whole page, which is intended: the hero is transparent over it, and **every section after the
  hero must have an opaque `bg-bg`** so the stage never shows through. Its dust canvas keeps
  animating while it is covered. That is an accepted cost for this pilot. Do not modify
  `LoginStage`.
- Content sits on the left 60% on `lg+` and is full width on mobile, vertically centred:
  eyebrow (`text-caption uppercase tracking-widest text-accent`), H1 (`text-hero font-semibold`,
  max width `max-w-3xl`), subheading (`text-lead text-fg-muted max-w-xl`), and two CTAs
  (primary `Request a demo`, outline `See how it works` linking to `#how-it-works`).
- Below the CTAs: three short proof points (`text-caption text-fg-muted`), each preceded by a
  `lucide` `Check` icon.

### T4 — Problem ("Sound familiar?")

- Section title and intro text.
- Three cards in a `grid md:grid-cols-3 gap-4`, each with an icon (`FileSpreadsheet`, `Boxes`,
  `Clock`), a title and a body.

### T5 — One system (`id="product"`)

- Title and intro.
- A four-tile row (`grid sm:grid-cols-2 lg:grid-cols-4`): **Back office**, **Point of sale**,
  **Online store**, **Warehouse**. Each tile has an icon (`LayoutDashboard`, `Store`,
  `ShoppingBag`, `Warehouse`), a name and a one-line description.
- Under the row sits a single full-width strip reading `t.oneSystem.ledgerLine`, styled
  `rounded-surface border border-border bg-surface px-6 py-4 text-center`. This is the core
  message: every channel writes to the same stock and the same books.

### T6 — Capabilities (`id="capabilities"`)

- Title and intro.
- Eight cards (`grid sm:grid-cols-2 lg:grid-cols-4 gap-4`), with content from
  `t.capabilities.items`. Icons in order: `Handshake`, `ShoppingCart`, `Package`, `Warehouse`,
  `Landmark`, `Users`, `BarChart3`, `ShieldCheck`.
- Each card has an icon, a title, a body, and 3 bullet "includes" items in `text-caption
  text-fg-muted`.

### T7 — Flows (`id="how-it-works"`)

- Title and intro.
- Two horizontal flows, each a labelled row of steps joined by a `ChevronRight` icon (these wrap
  to a vertical list on mobile, with `ChevronDown`):
  - **Selling:** Prospect → Quotation → Order → Pick & ship → Invoice → Payment
  - **Buying:** Request → Purchase order → Receive → Put away → Vendor bill → Payment
- Each step is a chip (`rounded-control border border-border bg-surface px-3 py-2 text-body`).
- Under each flow is one sentence from `t.flows.*.note`.
- Step labels come from the dictionary.

### T8 — Foundation ("Simple on the surface. Serious underneath.")

- A two-column layout on `lg+`: the left column holds the title and intro, the right column holds
  four stacked rows, each with an icon, a title and a body.
- Icons: `BookOpen` (double-entry books), `Layers` (grows with you), `Building2` (several stores
  and companies), `History` (full audit trail).

### T9 — Final CTA and footer

- `FinalCta`: a centred card (`rounded-surface border border-border bg-surface p-10 sm:p-16`)
  with the title, a body, and the primary CTA.
- `LandingFooter`: `border-t border-border`, with a small wordmark, `© {year} Quberty` (the year is
  computed with `new Date().getFullYear()`), and a `Sign in` link. No social links. No legal links
  until pages exist.

### T10 — Assembly and route switch

- Delete `frontend/src/app/page.tsx`. The `(landing)` group then owns `/`.
- `(landing)/page.tsx` is a server component:
  - It receives `{ searchParams }`, calls `getLocale`, and selects the dictionary.
  - It renders
    `<div lang={locale} className="dark relative min-h-screen bg-bg text-fg"><LoginStage /><LandingHeader/><main>Hero…FinalCta</main><LandingFooter/></div>`.
  - All sections after Hero are wrapped in `<Reveal>` and carry `bg-bg`.
- `(landing)/layout.tsx` is **not** needed. Do not create one.
- Add `export async function generateMetadata({ searchParams })`, which returns `title` and
  `description` from `t.meta`.
- Update `frontend/tests/e2e/10-session.spec.ts` lines 24–25. After login, `goto('/')` now expects
  the landing page to be visible (`getByRole('link', { name: /sign in/i })`), and the existing
  `/login` → `/dashboard` assertion stays as it is. Rename the test to "a live session reaches the
  app from the landing page".

---

## 5. Implementer rules (Ornith: read before every task)

1. Touch **only** the files listed in the task. Never edit `LoginStage.tsx`, `QubertyWordmark.tsx`,
   `brand.module.css`, `globals.css`, or anything under `(erp)`, `(store)`, `backend/`.
   `tailwind.config.ts` may be edited only for the two `fontSize` entries in §3.
2. No new npm dependencies.
3. No user-visible string literals inside components. All copy comes from the dictionary.
4. Tokens only (§3). No hex, no `rgb()`, no arbitrary Tailwind values except `min-h-[100svh]`.
5. Files are UTF-8 without BOM. Never write files through a shell command. Aider writes them.
6. `next/link` for internal links, a plain `<a>` for `mailto:`.
7. Every image or decorative layer has `aria-hidden` or a real `alt`. There is one `<h1>` on the
   page, and section titles are `<h2>`.
8. Each task ends with `npx tsc --noEmit` passing in `frontend/`. Do not claim a task is done
   without running it. (`npm run lint` is not used: ESLint is not installed in `frontend/`, and the
   script stops at an interactive setup prompt. Adding ESLint is a separate work item.)

---

## 6. Copy (verbatim — do not rewrite)

The dictionary shape is the EN object below. TR and ES have the identical shape.

### EN

```ts
export const en = {
  meta: {
    title: 'Quberty ERP — one system for your whole business',
    description:
      'Sales, purchasing, inventory, warehouse and finance in one place, with a point of sale and an online store that write to the same books. Built for businesses of 5 to 50 people.',
  },
  nav: { product: 'Product', capabilities: 'Capabilities', how: 'How it works', signIn: 'Sign in', demo: 'Request a demo', languageLabel: 'Language' },
  hero: {
    eyebrow: 'ERP for growing businesses',
    title: 'Run your whole business on one system.',
    subtitle:
      'Quberty brings sales, purchasing, stock, warehouse and finance together — with a point of sale and an online store that write to the same books. Built for teams of 5 to 50.',
    primary: 'Request a demo',
    secondary: 'See how it works',
    proof: ['One stock figure across every store', 'Books that close themselves', 'Set up in days, not months'],
  },
  problem: {
    title: 'Sound familiar?',
    intro: 'Most growing businesses run on a patchwork that worked at five people and breaks at twenty.',
    items: [
      { title: 'Spreadsheets everywhere', body: 'Orders in one file, stock in another, prices in someone’s head. Every report starts with copy and paste.' },
      { title: 'Stock you can’t trust', body: 'The shelf says one thing, the system says another, and the online store sells what you no longer have.' },
      { title: 'Month-end takes weeks', body: 'The accountant rebuilds the books from receipts because sales and purchases never reached them properly.' },
    ],
  },
  oneSystem: {
    title: 'One system. Every channel.',
    intro: 'Your back office, your shops, your web store and your warehouse — working from the same data, in real time.',
    tiles: [
      { title: 'Back office', body: 'Sales, purchasing, finance and people.' },
      { title: 'Point of sale', body: 'A fast checkout app for every store.' },
      { title: 'Online store', body: 'Sell online from the same catalogue and stock.' },
      { title: 'Warehouse', body: 'Receive, put away, pick and ship with guided work.' },
    ],
    ledgerLine: 'Every sale, receipt and payment lands in the same stock and the same books — no exports, no re-typing.',
  },
  capabilities: {
    title: 'Everything you need. Nothing you don’t.',
    intro: 'The core of a serious ERP, shaped for a business that doesn’t have an IT department.',
    items: [
      { title: 'Customers', body: 'From first contact to signed quote.', includes: ['Prospects and contacts', 'Quotations', 'Customer history'] },
      { title: 'Sales', body: 'Orders that flow straight to stock and invoice.', includes: ['Sales orders', 'Invoicing', 'Customer balances'] },
      { title: 'Purchasing', body: 'Buy on time, at the right price.', includes: ['Purchase requests', 'Purchase orders', 'Vendor bills'] },
      { title: 'Warehouse', body: 'Know where every item is, and move it with purpose.', includes: ['Receiving and put-away', 'Picking waves', 'Bin locations'] },
      { title: 'Finance', body: 'Real double-entry accounting, not a cash book.', includes: ['Journals and periods', 'Bank reconciliation', 'P&L and balance sheet'] },
      { title: 'People', body: 'Your team, their roles and their access.', includes: ['Employees', 'Roles and permissions', 'Store assignments'] },
      { title: 'Reports', body: 'The numbers you need, without building them.', includes: ['Owner dashboard', 'Sales and stock reports', 'Aged receivables and payables'] },
      { title: 'Control', body: 'See who changed what, and when.', includes: ['Full audit trail', 'Approval-ready documents', 'Data import'] },
    ],
  },
  flows: {
    title: 'How the work flows',
    intro: 'Every document knows where it came from and where it goes next. Nothing is typed twice.',
    selling: {
      label: 'Selling',
      steps: ['Prospect', 'Quotation', 'Order', 'Pick & ship', 'Invoice', 'Payment'],
      note: 'A quote becomes an order, the order reserves stock, and the invoice posts itself to the books.',
    },
    buying: {
      label: 'Buying',
      steps: ['Request', 'Purchase order', 'Receive', 'Put away', 'Vendor bill', 'Payment'],
      note: 'What you receive is what you pay for — matched to the order before the bill is paid.',
    },
  },
  foundation: {
    title: 'Simple on the surface. Serious underneath.',
    intro: 'Quberty is easy to start with, and built on the same foundations as enterprise systems — so you never have to switch again.',
    items: [
      { title: 'Real accounting', body: 'Every transaction is a balanced journal entry your accountant can trust.' },
      { title: 'Grows with you', body: 'Start with what you need today; turn on more when you need it, without migrating.' },
      { title: 'Many stores, one view', body: 'Run several stores and warehouses with stock and results for each — and for the whole business.' },
      { title: 'Nothing disappears', body: 'Corrections are recorded, not erased. You can always see what happened.' },
    ],
  },
  finalCta: {
    title: 'See Quberty with your own data.',
    body: 'Book a 30-minute walkthrough. We’ll show you your day in Quberty — orders, stock and books.',
    primary: 'Request a demo',
  },
  footer: { rights: 'All rights reserved.', signIn: 'Sign in' },
};
```

### TR

```ts
export const tr: LandingDictionary = {
  meta: {
    title: 'Quberty ERP — tüm işiniz için tek sistem',
    description:
      'Satış, satın alma, stok, depo ve finans tek yerde; aynı defterlere yazan bir satış noktası ve online mağaza ile. 5–50 kişilik işletmeler için tasarlandı.',
  },
  nav: { product: 'Ürün', capabilities: 'Özellikler', how: 'Nasıl çalışır', signIn: 'Giriş yap', demo: 'Demo talep et', languageLabel: 'Dil' },
  hero: {
    eyebrow: 'Büyüyen işletmeler için ERP',
    title: 'Tüm işinizi tek bir sistemden yönetin.',
    subtitle:
      'Quberty satışı, satın almayı, stoğu, depoyu ve finansı bir araya getirir; satış noktanız ve online mağazanız da aynı defterlere yazar. 5 ile 50 kişilik ekipler için.',
    primary: 'Demo talep et',
    secondary: 'Nasıl çalıştığını gör',
    proof: ['Tüm mağazalarda tek stok rakamı', 'Kendiliğinden kapanan defterler', 'Aylarca değil, günler içinde kurulum'],
  },
  problem: {
    title: 'Tanıdık geliyor mu?',
    intro: 'Büyüyen işletmelerin çoğu, beş kişiyken işleyen ama yirmi kişide dağılan bir yama bohçasıyla yürür.',
    items: [
      { title: 'Her yerde Excel', body: 'Siparişler bir dosyada, stok başka birinde, fiyatlar birinin aklında. Her rapor kopyala-yapıştırla başlar.' },
      { title: 'Güvenilmeyen stok', body: 'Raf bir şey söyler, sistem başka bir şey; online mağaza artık elinizde olmayanı satar.' },
      { title: 'Haftalar süren ay sonu', body: 'Satışlar ve alımlar muhasebeye hiç düzgün ulaşmadığı için muhasebeci defterleri fişlerden yeniden kurar.' },
    ],
  },
  oneSystem: {
    title: 'Tek sistem. Her kanal.',
    intro: 'Merkez ofisiniz, mağazalarınız, web mağazanız ve deponuz — aynı veriyle, anlık olarak çalışır.',
    tiles: [
      { title: 'Merkez ofis', body: 'Satış, satın alma, finans ve personel.' },
      { title: 'Satış noktası', body: 'Her mağaza için hızlı bir kasa uygulaması.' },
      { title: 'Online mağaza', body: 'Aynı katalog ve aynı stokla online satış.' },
      { title: 'Depo', body: 'Yönlendirmeli işlerle kabul, yerleştirme, toplama ve sevk.' },
    ],
    ledgerLine: 'Her satış, her mal kabul ve her ödeme aynı stoğa ve aynı defterlere düşer — dışa aktarma yok, yeniden yazma yok.',
  },
  capabilities: {
    title: 'İhtiyacınız olan her şey. Fazlası değil.',
    intro: 'Ciddi bir ERP’nin çekirdeği; BT departmanı olmayan bir işletmeye göre şekillendirildi.',
    items: [
      { title: 'Müşteriler', body: 'İlk temastan imzalı teklife kadar.', includes: ['Potansiyel müşteriler ve kişiler', 'Teklifler', 'Müşteri geçmişi'] },
      { title: 'Satış', body: 'Doğrudan stoğa ve faturaya akan siparişler.', includes: ['Satış siparişleri', 'Faturalama', 'Müşteri bakiyeleri'] },
      { title: 'Satın alma', body: 'Zamanında ve doğru fiyata satın alın.', includes: ['Satın alma talepleri', 'Satın alma siparişleri', 'Tedarikçi faturaları'] },
      { title: 'Depo', body: 'Her ürünün nerede olduğunu bilin ve amaçla taşıyın.', includes: ['Mal kabul ve yerleştirme', 'Toplama dalgaları', 'Raf lokasyonları'] },
      { title: 'Finans', body: 'Kasa defteri değil, gerçek çift taraflı muhasebe.', includes: ['Yevmiye ve dönemler', 'Banka mutabakatı', 'Gelir tablosu ve bilanço'] },
      { title: 'Personel', body: 'Ekibiniz, rolleri ve erişimleri.', includes: ['Çalışanlar', 'Roller ve yetkiler', 'Mağaza atamaları'] },
      { title: 'Raporlar', body: 'İhtiyacınız olan rakamlar, kurmakla uğraşmadan.', includes: ['Yönetici paneli', 'Satış ve stok raporları', 'Alacak ve borç yaşlandırma'] },
      { title: 'Kontrol', body: 'Kimin neyi ne zaman değiştirdiğini görün.', includes: ['Tam denetim izi', 'Onaya hazır belgeler', 'Veri aktarımı'] },
    ],
  },
  flows: {
    title: 'İş nasıl akar',
    intro: 'Her belge nereden geldiğini ve nereye gideceğini bilir. Hiçbir şey iki kez yazılmaz.',
    selling: {
      label: 'Satış',
      steps: ['Potansiyel müşteri', 'Teklif', 'Sipariş', 'Toplama ve sevk', 'Fatura', 'Tahsilat'],
      note: 'Teklif siparişe dönüşür, sipariş stoğu ayırır, fatura kendini deftere işler.',
    },
    buying: {
      label: 'Satın alma',
      steps: ['Talep', 'Satın alma siparişi', 'Mal kabul', 'Yerleştirme', 'Tedarikçi faturası', 'Ödeme'],
      note: 'Ne teslim aldıysanız onun parasını ödersiniz — fatura ödenmeden önce siparişle eşleştirilir.',
    },
  },
  foundation: {
    title: 'Yüzeyde sade. Altında ciddi.',
    intro: 'Quberty’ye başlamak kolaydır ve kurumsal sistemlerle aynı temeller üzerine kuruludur — bir daha sistem değiştirmek zorunda kalmazsınız.',
    items: [
      { title: 'Gerçek muhasebe', body: 'Her işlem, muhasebecinizin güvenebileceği dengeli bir yevmiye kaydıdır.' },
      { title: 'Sizinle büyür', body: 'Bugün ihtiyacınız olanla başlayın; gerektiğinde fazlasını açın, veri taşımadan.' },
      { title: 'Çok mağaza, tek görünüm', body: 'Birden çok mağaza ve depoyu, her biri ve işin tamamı için stok ve sonuçlarla yönetin.' },
      { title: 'Hiçbir şey kaybolmaz', body: 'Düzeltmeler silinmez, kaydedilir. Ne olduğunu her zaman görebilirsiniz.' },
    ],
  },
  finalCta: {
    title: 'Quberty’yi kendi verinizle görün.',
    body: '30 dakikalık bir tanıtım ayarlayın. Gününüzü Quberty’de gösterelim — siparişler, stok ve defterler.',
    primary: 'Demo talep et',
  },
  footer: { rights: 'Tüm hakları saklıdır.', signIn: 'Giriş yap' },
};
```

### ES

```ts
export const es: LandingDictionary = {
  meta: {
    title: 'Quberty ERP — un solo sistema para todo tu negocio',
    description:
      'Ventas, compras, inventario, almacén y finanzas en un solo lugar, con un punto de venta y una tienda online que escriben en los mismos libros. Pensado para empresas de 5 a 50 personas.',
  },
  nav: { product: 'Producto', capabilities: 'Funciones', how: 'Cómo funciona', signIn: 'Iniciar sesión', demo: 'Solicitar una demo', languageLabel: 'Idioma' },
  hero: {
    eyebrow: 'ERP para empresas en crecimiento',
    title: 'Gestiona todo tu negocio en un solo sistema.',
    subtitle:
      'Quberty reúne ventas, compras, inventario, almacén y finanzas — con un punto de venta y una tienda online que escriben en los mismos libros. Para equipos de 5 a 50 personas.',
    primary: 'Solicitar una demo',
    secondary: 'Ver cómo funciona',
    proof: ['Un solo stock en todas tus tiendas', 'Libros que se cierran solos', 'En marcha en días, no en meses'],
  },
  problem: {
    title: '¿Te suena?',
    intro: 'La mayoría de las empresas en crecimiento funciona con un parche que servía con cinco personas y se rompe con veinte.',
    items: [
      { title: 'Hojas de cálculo por todas partes', body: 'Pedidos en un archivo, stock en otro, precios en la cabeza de alguien. Cada informe empieza con copiar y pegar.' },
      { title: 'Un stock en el que no confías', body: 'El estante dice una cosa, el sistema otra, y la tienda online vende lo que ya no tienes.' },
      { title: 'Cierres de mes que duran semanas', body: 'El contador reconstruye los libros a partir de recibos porque ventas y compras nunca llegaron bien a ellos.' },
    ],
  },
  oneSystem: {
    title: 'Un solo sistema. Todos los canales.',
    intro: 'Tu oficina, tus tiendas, tu tienda online y tu almacén — trabajando con los mismos datos, en tiempo real.',
    tiles: [
      { title: 'Oficina', body: 'Ventas, compras, finanzas y personal.' },
      { title: 'Punto de venta', body: 'Una caja rápida para cada tienda.' },
      { title: 'Tienda online', body: 'Vende online con el mismo catálogo y el mismo stock.' },
      { title: 'Almacén', body: 'Recibe, ubica, prepara y envía con trabajo guiado.' },
    ],
    ledgerLine: 'Cada venta, recepción y pago llega al mismo stock y a los mismos libros — sin exportar, sin volver a teclear.',
  },
  capabilities: {
    title: 'Todo lo que necesitas. Nada que sobre.',
    intro: 'El núcleo de un ERP serio, pensado para una empresa que no tiene departamento de sistemas.',
    items: [
      { title: 'Clientes', body: 'Del primer contacto a la cotización firmada.', includes: ['Prospectos y contactos', 'Cotizaciones', 'Historial del cliente'] },
      { title: 'Ventas', body: 'Pedidos que fluyen directo al stock y a la factura.', includes: ['Pedidos de venta', 'Facturación', 'Saldos de clientes'] },
      { title: 'Compras', body: 'Compra a tiempo y al precio correcto.', includes: ['Solicitudes de compra', 'Órdenes de compra', 'Facturas de proveedor'] },
      { title: 'Almacén', body: 'Sabe dónde está cada artículo y muévelo con propósito.', includes: ['Recepción y ubicación', 'Olas de preparación', 'Ubicaciones'] },
      { title: 'Finanzas', body: 'Contabilidad de partida doble real, no un libro de caja.', includes: ['Diarios y periodos', 'Conciliación bancaria', 'Estado de resultados y balance'] },
      { title: 'Personas', body: 'Tu equipo, sus roles y sus accesos.', includes: ['Empleados', 'Roles y permisos', 'Asignación a tiendas'] },
      { title: 'Informes', body: 'Las cifras que necesitas, sin tener que construirlas.', includes: ['Panel de dirección', 'Informes de ventas y stock', 'Antigüedad de cobros y pagos'] },
      { title: 'Control', body: 'Mira quién cambió qué, y cuándo.', includes: ['Registro de auditoría completo', 'Documentos listos para aprobación', 'Importación de datos'] },
    ],
  },
  flows: {
    title: 'Cómo fluye el trabajo',
    intro: 'Cada documento sabe de dónde viene y a dónde va. Nada se escribe dos veces.',
    selling: {
      label: 'Vender',
      steps: ['Prospecto', 'Cotización', 'Pedido', 'Preparación y envío', 'Factura', 'Cobro'],
      note: 'La cotización se convierte en pedido, el pedido reserva stock y la factura se contabiliza sola.',
    },
    buying: {
      label: 'Comprar',
      steps: ['Solicitud', 'Orden de compra', 'Recepción', 'Ubicación', 'Factura de proveedor', 'Pago'],
      note: 'Pagas lo que recibes — conciliado con la orden antes de pagar la factura.',
    },
  },
  foundation: {
    title: 'Simple por fuera. Serio por dentro.',
    intro: 'Quberty es fácil para empezar y está construido sobre las mismas bases que los sistemas empresariales — para que no tengas que cambiar nunca más.',
    items: [
      { title: 'Contabilidad real', body: 'Cada operación es un asiento cuadrado en el que tu contador puede confiar.' },
      { title: 'Crece contigo', body: 'Empieza con lo que necesitas hoy; activa más cuando lo necesites, sin migraciones.' },
      { title: 'Muchas tiendas, una vista', body: 'Gestiona varias tiendas y almacenes con stock y resultados de cada uno — y del negocio entero.' },
      { title: 'Nada desaparece', body: 'Las correcciones se registran, no se borran. Siempre puedes ver qué pasó.' },
    ],
  },
  finalCta: {
    title: 'Mira Quberty con tus propios datos.',
    body: 'Agenda una demostración de 30 minutos. Te mostramos tu día en Quberty — pedidos, stock y libros.',
    primary: 'Solicitar una demo',
  },
  footer: { rights: 'Todos los derechos reservados.', signIn: 'Iniciar sesión' },
};
```

---

## 7. Claims accepted by Kubi (2026-09-25)

These pass the §1 policy on repo evidence, but the wording promises more than the evidence proves.
Kubi accepted all of them on 2026-09-25. None has been smoke-tested; he judges each one technically
sound, and anything found not to hold is fixed in the product rather than removed from the page:

| Copy | Concern |
|---|---|
| "Books that close themselves" | Period close exists (`finance/periods`), but posting completeness across every channel was not verified here. |
| "Set up in days, not months" | A sales promise with no evidence behind it. Keep it only if Kubi stands behind it. |
| "Matched to the order before the bill is paid" (three-way match) | Not verified in `purchase`. Soften to "checked against the order" if matching is manual. |
| "Approval-ready documents" | Workflow approvals were not verified. |
| POS in every store / Online store | Both exist, but the POS lives in a separate repo, and this machine's `skarpine-pos/` directory is empty. |

---

## 8. Acceptance

1. `npx tsc --noEmit` and `npm run build` pass in `frontend/`. The tsc baseline was clean on
   2026-09-25.
2. `/`, `/?lang=tr` and `/?lang=es` render with no console errors. The switcher persists the choice
   across a reload without the query parameter (cookie).
3. Playwright screenshots at 360, 768 and 1440 px wide × 3 languages: no horizontal scroll, no
   clipped text, and the header stays usable at 360 px.
4. Under reduced motion (Playwright `reducedMotion: 'reduce'`) all sections are visible without
   scrolling animations.
5. `grep` over `(landing)/_components` finds no hex colours, no `text-[`/`bg-[` arbitrary values
   (except `min-h-[100svh]`), and no user-visible string literals.
6. The updated `10-session.spec.ts` passes.
7. Architect review of the diff against §5 → ACCEPTED.
