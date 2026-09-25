# Task T1 — correction 1

Review of commit f23f4e4: the logic is correct, but the project does not type-check.

```
src/app/(landing)/i18n/getLocale.ts: error TS2304: Cannot find name 'Locale'.
src/app/(landing)/i18n/getLocale.ts: error TS2304: Cannot find name 'isLocale'.
src/app/(landing)/i18n/getLocale.ts: error TS2304: Cannot find name 'cookies'.
src/app/(landing)/i18n/getLocale.ts: error TS2304: Cannot find name 'LANG_COOKIE'.
src/app/(landing)/i18n/getLocale.ts: error TS2304: Cannot find name 'headers'.
```

Fix exactly these three things:

1. `getLocale.ts` has no imports. Add them at the top of the file:
   `import { cookies, headers } from 'next/headers';`,
   `import { LANG_COOKIE } from '../content';` and
   `import { isLocale, type Locale } from './types';`.
2. `types.ts`: move `import type { en } from './en';` to the first line of the file.
   Imports come before any declaration.
3. `getDictionary.ts`: the comment `/** The locale copy objects, keyed by locale. */` is attached to
   an import. Move it so it sits directly above `const DICTIONARIES`.

Do not change any logic. Do not touch other files.

Output format: write the full file path alone on its own line, followed by the complete file in a
fenced code block. No bold, no labels, no backticks around the path.
