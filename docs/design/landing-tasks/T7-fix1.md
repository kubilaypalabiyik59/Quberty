# Task T7 — correction 1

Review of commit 5f04802: the gate passes, and 16 of the 17 tests pass against the running page.
One test fails:

```
› Landing page › the switcher persists the choice
  navigated to "http://localhost:3000/?lang=es"
> 33 |     await page.waitForURL('??lang=es');
  TimeoutError
```

The page did navigate to `/?lang=es`. The wait never matched because in a Playwright URL glob `?`
is a single-character wildcard, so `'??lang=es'` means "any two characters, then lang=es". It
never matches the full URL.

Fix exactly this:

1. Replace `await page.waitForURL('??lang=es');` with `await page.waitForURL(/\?lang=es$/);`.
2. In the second loop (the horizontal-scroll tests), the variable `t` is declared but never used.
   Iterate over the language codes only: `for (const lang of Object.keys(DICTIONARIES)) {`.

Change nothing else. This time the test command also runs this spec against the live page, so
you will see whether it passes.
