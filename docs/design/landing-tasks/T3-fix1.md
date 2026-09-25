# Task T3 — correction 1

Review of commit e42142b: `Hero.tsx` is accepted as it is, apart from item 2. `Problem.tsx` and
`OneSystem.tsx` do not compile:

```
Problem.tsx(19,23): error TS1003: Identifier expected.
OneSystem.tsx(20,23): error TS1003: Identifier expected.
```

## 1. The cause

`<ICONS[i] ... />` is not valid JSX. A JSX tag name must be a plain identifier. Fix it in both
files by assigning the icon to a variable inside the `map` callback, then rendering that variable:

```tsx
{t.problem.items.map((item, i) => {
  const Icon = ICONS[i];
  return (
    <div key={item.title} className="rounded-surface border border-border bg-surface p-6">
      <Icon aria-hidden className="h-5 w-5 text-accent" />
      <h3 className="mt-4 text-title font-semibold text-fg">{item.title}</h3>
      <p className="mt-2 text-body text-fg-muted">{item.body}</p>
    </div>
  );
})}
```

`OneSystem.tsx` gets the same change, using `t.oneSystem.tiles` and `tile`.

## 2. Doc comments

Each exported component needs a one-line doc comment directly above it, as the conventions
require:

- `Hero`: `/** Landing hero: headline, subheading, demo CTA and proof points over the brand stage. */`
- `Problem`: `/** "Sound familiar?" section: three pains of the spreadsheet stage. */`
- `OneSystem`: `/** One-system section: the four channels and the shared-ledger line. */`

Change nothing else. Output all three files in full.
