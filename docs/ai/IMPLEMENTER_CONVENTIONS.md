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
- Use `import type` for type-only imports. Use named exports only, never default exports, except
  where Next.js requires a default (`page.tsx`, `layout.tsx`).
- No `any`. No non-null `!` assertions. Casts only where a type guard cannot express the check.
- Put a short doc comment on each exported symbol that says what it is for. Do not narrate the
  code line by line.

## Next.js 14 (App Router)

- Files are server components by default. Add `'use client'` as the **first line** only when the
  file uses state, effects, event handlers, browser APIs, `useRouter`, or framer-motion.
- A server component must not call a function exported from a `'use client'` module. For example,
  `buttonVariants` from `@/components/ui/Button` may only be called inside a client component.
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

## Copy and accessibility

- Components never contain user-visible text. All text comes from the dictionary prop `t`.
- Decorative elements get `aria-hidden`. Every interactive control has an accessible name. Use
  one `<h1>` per page and `<h2>` for section titles.

## Done means

- The type-check passes. Aider runs it after every edit; if it reports errors, fix them before
  anything else.
- Do not ask questions and do not suggest extra work. If the task is ambiguous, pick the simplest
  reading that satisfies every rule above.
