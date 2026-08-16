import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * Apply a hand-reviewed SQL migration from `prisma/sql/`.
 *
 * Runs against DIRECT_URL, never the pooled DATABASE_URL: the Supabase pooler
 * cannot run DDL reliably in transaction mode, and `schema.prisma` points at the
 * pooler by design.
 *
 *   npx tsx scripts/applyMigration.ts 005_process_chain.sql
 */
const file = process.argv[2];
if (!file) {
  console.error('usage: tsx scripts/applyMigration.ts <file.sql>');
  process.exit(1);
}

const url = process.env.DIRECT_URL;
if (!url) {
  console.error('DIRECT_URL is not set — refusing to run DDL through the pooler.');
  process.exit(1);
}

const full = path.join(__dirname, '..', 'prisma', 'sql', file);
const sql = fs.readFileSync(full, 'utf8');

const prisma = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });

/**
 * Postgres refuses multiple commands in one prepared statement, so the file is
 * split into statements. The splitter is deliberately simple — it only has to
 * handle the DDL these migrations contain — but it does strip comment-only
 * lines first, so a `;` inside a comment cannot end a statement early.
 */
function statements(source: string): string[] {
  const code = source
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  return code
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

(async () => {
  const stmts = statements(sql);
  console.log(`applying ${file} — ${stmts.length} statement(s) …`);

  // DDL is transactional in Postgres, so the whole migration is all-or-nothing.
  await prisma.$transaction(
    async (tx) => {
      for (const [i, s] of stmts.entries()) {
        try {
          await tx.$executeRawUnsafe(s);
        } catch (e: any) {
          throw new Error(`statement ${i + 1}/${stmts.length} failed:\n${s.slice(0, 300)}\n→ ${e.message}`);
        }
      }
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  console.log(`OK  ${file} applied (${stmts.length} statements).`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(`FAILED ${file}: ${e.message}`);
  await prisma.$disconnect();
  process.exit(1);
});
