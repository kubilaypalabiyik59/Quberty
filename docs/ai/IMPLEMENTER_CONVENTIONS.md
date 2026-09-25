# Implementer conventions

You are the implementer on this project. An architect writes each task, and a reviewer checks your
diff before it is accepted. Follow these rules in every task, and follow the task file where it
is more specific. Every rule below exists because breaking it has already caused a rejected
change.

## Output format

- For each file, write the full path **alone on its own line**, then the complete file in a
  fenced code block. Do not use bold, numbering, "File 1:" labels, or backticks around the path.
  ```
  frontend/src/app/(landing)/content.ts
  ```ts
  export const X = 1;
  ```
  ```
- Only output files the task lists. Never edit a file the task does not name.

## TypeScript

- **Imports come first.** Every name you use must be imported at the top of the file. Before you
  finish, check each identifier in the file against the import list. Missing imports are the most
  common rejection.
- **Never invent a value or a module path.** Do not declare an email address, URL, ID or other
  constant yourself, and do not guess an import path. Everything the task references already
  exists at the path the task gives, or in a file in the chat. If you cannot find where a name
  comes from, import it from `@/app/(landing)/content` (for constants) or from the path in the
  task's "What already exists" list. A fabricated value is the worst possible defect, because it
  compiles and looks right. (Ledger: T5)
- Use `import type` for type-only imports. Use named exports only, never default exports, except
  where Next.js requires a default (`page.tsx`, `layout.tsx`).
- No `any`. No non-null `!` assertions. Casts only where a type guard cannot express the check.
- Put a short doc comment on each exported symbol that says what it is for. Do not narrate the
  code line by line.
- A JSX tag name must be a plain capitalised identifier. `<ICONS[i] />` is a syntax error
  (TS1003 "Identifier expected"). Assign the component to a variable first, then render it:
  `const Icon = ICONS[i];` followed by `<Icon aria-hidden className="h-5 w-5" />`. (Ledger: T3)

## Next.js 14 (App Router)

- Files are server components by default. Add `'use client'` as the **first line** only when the
  file uses state, effects, event handlers, browser APIs, `useRouter`, or framer-motion.
- A server component must not call a function exported from a `'use client'` module. For example,
  `buttonVariants` from `@/components/ui/Button` may only be called inside a client component.
- Never choose *what to render* from a browser-only value (`useReducedMotion()`, `window`,
  `matchMedia`) in a component that is server-rendered. The server renders one branch and the
  browser another, and React keeps the server's attributes during hydration. That is how the
  reduced-motion users of the landing page got content stuck at `opacity: 0`. Express
  browser-dependent styling in CSS instead (`motion-reduce:`, `md:`). (Ledger: landing
  integration)
- Import `cookies()` and `headers()` from `next/headers`. They are synchronous in Next 14.1.
- Use `next/link` for internal links and a plain `<a>` for `mailto:` and external links.

## Styling

- Tailwind only, with the project's design tokens: `bg-bg`, `bg-surface`, `bg-surface-raised`,
  `text-fg`, `text-fg-muted`, `text-fg-subtle`, `border-border`, `border-border-strong`,
  `bg-accent`, `text-accent`, `rounded-control`, `rounded-surface`, and the type scale
  `text-micro`, `text-caption`, `text-body`, `text-lead`, `text-title`, `text-display`.
- Never use hex colours, `rgb()`, palette classes (`bg-gray-900`, `text-blue-500`), or arbitrary
  values (`text-[13px]`, `bg-[#...]`) unless the task explicitly allows one.
- Merge class names with `cn()` from `@/lib/utils`.
- If a component accepts `className`, **every** render branch applies it, including the
  `motion.*` branch and any early return. (Ledger: T2)
- Put responsive visibility (`hidden md:flex`) on the semantic element itself (`<nav>`,
  `<section>`), not on a wrapper inside it. Otherwise an empty landmark stays in the page.
  (Ledger: T2)

## Playwright tests

- In a URL glob, `?` and `*` are wildcards: `'??lang=es'` never matches a real URL. To match a
  query string, use a regular expression: `page.waitForURL(/\?lang=es$/)`. (Ledger: T7)
- `toBeVisible()` passes for an element at `opacity: 0`. To prove content is actually shown,
  assert `toHaveCSS('opacity', '1')`. (Ledger: T7)
- Import app code with relative paths. The `@/` alias is not resolved in tests.

## Copy and accessibility

- Components never contain user-visible text. All text comes from the dictionary prop `t`.
- Decorative elements get `aria-hidden`. Every interactive control has an accessible name. Use
  one `<h1>` per page and `<h2>` for section titles.

## Done means

- The type-check passes. Aider runs it after every edit; if it reports errors, fix them before
  anything else.
- Do not ask questions and do not suggest extra work. If the task is ambiguous, pick the simplest
  reading that satisfies every rule above.
