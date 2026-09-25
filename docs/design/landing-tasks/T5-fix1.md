# Task T5 — correction 1

Review of commit 8b343ef: `page.tsx`, `LandingFooter.tsx` and the `Foundation.tsx` fixes are
accepted. `FinalCta.tsx` has two defects.

```
FinalCta.tsx(1,25): error TS2307: Cannot find module '@/components/ui/CtaLink'
```

1. **Wrong import path.** `CtaLink` lives in the landing components folder. The correct import is
   `import { CtaLink } from '@/app/(landing)/_components/CtaLink';`
2. **Invented email address.** Delete `const DEMO_EMAIL = 'demo@quberty.dev';` entirely. That
   address is fabricated. The real constant already exists; import it:
   `import { DEMO_EMAIL } from '@/app/(landing)/content';`

Change nothing else in `FinalCta.tsx`, and do not touch any other file. Output the file in full.
