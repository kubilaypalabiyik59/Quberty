#!/usr/bin/env node
/**
 * Implementer gate — Aider's test-cmd. It runs after every edit, and whatever it prints is
 * fed back to the model.
 *
 * Every check below is a defect a review actually caught (see IMPLEMENTER_LEDGER.md). A rule
 * in IMPLEMENTER_CONVENTIONS.md tells the model; this script makes sure. Messages are phrased
 * as instructions, because the model reads them as its next prompt.
 *
 * Scope: files changed in the last commit (Aider commits before testing) plus uncommitted and
 * untracked files. Exit 0 = clean, 1 = violations.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const root = git('rev-parse', '--show-toplevel').trim();
process.chdir(root);

// No shell: on Windows execSync goes through cmd.exe, which mangles quoted paths such as (landing).
const lines = (...args) => git(...args).split('\n').map((s) => s.trim()).filter(Boolean);
// CHECK_PATHS="dir1|dir2" audits every tracked and untracked file under those paths instead
// (used by the architect to audit accepted code, and to test this script).
const changed = new Set(
  process.env.CHECK_PATHS
    ? lines('ls-files', '--cached', '--others', '--exclude-standard', '--', ...process.env.CHECK_PATHS.split('|'))
    : [
        ...lines('diff', '--name-only', 'HEAD~1', 'HEAD'),
        ...lines('diff', '--name-only', 'HEAD'),
        ...lines('ls-files', '--others', '--exclude-standard'),
      ],
);
const files = [...changed].filter((f) => /\.(ts|tsx)$/.test(f) && existsSync(f));
const problems = [];
const report = (file, line, msg) => problems.push(`${file}${line ? `:${line}` : ''}: ${msg}`);

// Constants may live only here; everywhere else a literal email or URL is a fabrication.
const CONSTANT_FILES = [/\/content\.ts$/, /\/i18n\/(en|tr|es)\.ts$/];
// Allowed arbitrary Tailwind values, each approved in a spec.
const ALLOWED_ARBITRARY = ['min-h-[calc(100svh-4rem)]'];

for (const file of files) {
  // T5: the path line held only a basename, so Aider created the file in the wrong place.
  if (!file.startsWith('frontend/') && !file.startsWith('backend/') && !file.startsWith('docs/')) {
    report(file, 0, 'FILE IN WRONG PLACE. You wrote this file outside the project folders because the path line was not the full path. Write the FULL path from the task (for example frontend/src/app/(landing)/_components/X.tsx) alone on its own line. (Ledger: T5)');
    continue;
  }
  if (!file.startsWith('frontend/src/')) continue;

  const src = readFileSync(file, 'utf8').split('\n');
  const isConstantFile = CONSTANT_FILES.some((re) => re.test(file));

  src.forEach((text, i) => {
    const n = i + 1;
    // Comments may name a forbidden pattern to explain why it is forbidden.
    if (/^\s*(\/\/|\/\*|\*)/.test(text)) return;
    // T3: a computed JSX tag name.
    if (/<[A-Z][A-Za-z0-9_]*\[/.test(text)) {
      report(file, n, 'Invalid JSX tag: a tag name cannot be indexed. Write `const Icon = ICONS[i];` and then render `<Icon ... />`. (Ledger: T3)');
    }
    // T5: fabricated values.
    if (!isConstantFile && /['"`][^'"`\s]*@[a-z0-9-]+\.[a-z]{2,}/i.test(text)) {
      report(file, n, 'Email address literal. Never invent an email. Import the real constant (DEMO_EMAIL from @/app/(landing)/content). (Ledger: T5)');
    }
    if (!isConstantFile && /['"`]https?:\/\//.test(text)) {
      report(file, n, 'URL literal. Never invent a URL. If the task does not give one, it comes from a constants module. (Ledger: T5)');
    }
    // Conventions: design tokens only.
    if (/#[0-9a-fA-F]{3,8}\b/.test(text) && /className|style|color/.test(text)) {
      report(file, n, 'Hex colour. Use design tokens only (bg-surface, text-fg, text-accent, ...).');
    }
    if (/\brgba?\(|\bhsla?\(/.test(text) && file.endsWith('.tsx')) {
      report(file, n, 'rgb()/hsl() colour. Use design tokens only.');
    }
    for (const m of text.matchAll(/[a-z:-]+-\[[^\]]+\]/g)) {
      if (!ALLOWED_ARBITRARY.includes(m[0].replace(/^[a-z-]+:/, ''))) {
        report(file, n, `Arbitrary Tailwind value "${m[0]}". Use the token scale; arbitrary values need an explicit allowance in the task.`);
      }
    }
    if (/\b(bg|text|border)-(gray|slate|zinc|neutral|blue|red|green|teal|cyan|indigo)-\d{2,3}\b/.test(text)) {
      report(file, n, 'Palette colour class. Use design tokens (bg-surface, text-fg-muted, border-border, ...).');
    }
    // T6: branching render on a browser-only hook breaks hydration.
    if (/\buseReducedMotion\s*\(/.test(text)) {
      report(file, n, 'Do not use useReducedMotion() to choose what to render: server and browser disagree and hydration keeps the server output. Use the CSS variant motion-reduce: instead. (Ledger: landing integration)');
    }
  });

  // Next.js: 'use client' must be the first statement.
  const useClientAt = src.findIndex((l) => /^['"]use client['"];?\s*$/.test(l.trim()));
  if (useClientAt > 0 && src.slice(0, useClientAt).some((l) => l.trim() && !l.trim().startsWith('//'))) {
    report(file, useClientAt + 1, "'use client' must be the very first line of the file.");
  }
}

if (problems.length) {
  console.log(`Implementer gate: ${problems.length} problem(s). Fix every one, then stop.\n`);
  console.log(problems.join('\n'));
}

// Type-check last. It is pinned to the frontend's own TypeScript: a bare `npx tsc` from the
// repo root downloads an unrelated npm package called "tsc". (Ledger: T1)
const tsc = spawnSync(process.execPath, ['frontend/node_modules/typescript/bin/tsc', '--noEmit', '-p', 'frontend'], { encoding: 'utf8' });
if (tsc.status !== 0) {
  console.log('\nType errors:\n' + (tsc.stdout || tsc.stderr));
}

process.exit(problems.length || tsc.status !== 0 ? 1 : 0);
