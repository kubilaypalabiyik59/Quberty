# Task T2 — correction 1

Review of commit 3573a75: this round type-checks and follows the conventions. Two defects need
fixing.

1. `Reveal.tsx`: the animated branch drops `className`. The `motion.div` must receive
   `className={className}`, exactly as the reduced-motion `<div>` does.
2. `LandingHeader.tsx`: `hidden items-center gap-6 md:flex` sits on an inner `<div>`, so on phones
   the `<nav>` stays in the page as an empty navigation landmark, which screen readers announce.
   Put those classes on the `<nav>` itself and remove the inner `<div>`. The three `<a>` anchors
   become direct children of `<nav>`.

Change nothing else. Output both files in full, each as its path alone on one line followed by
the fenced code block.
