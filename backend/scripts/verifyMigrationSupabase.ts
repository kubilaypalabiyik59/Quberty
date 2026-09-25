import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { buildIsolatedSupabaseUrl } from '../src/infrastructure/database/migrationPolicy';
import { runMigrationVerification } from './migrationVerification';

const verificationSchema = 'work015_verify_20260909';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const capture = args.length === 1 && args[0] === '--capture-drift-candidate';
  if (args.length > 0 && !capture) {
    throw new Error('usage: tsx scripts/verifyMigrationSupabase.ts [--capture-drift-candidate]');
  }

  const sourceUrl = process.env.WORK_015_SUPABASE_DIRECT_URL ?? '';
  const scopedUrl = buildIsolatedSupabaseUrl(sourceUrl, verificationSchema);
  const admin = new PrismaClient({ datasources: { db: { url: sourceUrl } }, log: ['error'] });
  let created = false;

  try {
    const existing = await admin.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_namespace WHERE nspname = ${verificationSchema}
      ) AS exists
    `;
    if (existing[0]?.exists) {
      throw new Error(`Refusing to reuse existing schema ${verificationSchema}`);
    }

    await admin.$executeRawUnsafe(`CREATE SCHEMA "${verificationSchema}"`);
    created = true;

    const expectedDriftPath = path.join(__dirname, '..', 'prisma', 'drift.snapshot.sql');
    const result = await runMigrationVerification({
      databaseUrl: scopedUrl,
      directUrl: scopedUrl,
      expectedDriftPath: capture ? undefined : expectedDriftPath,
    });

    if (capture) {
      const candidatePath = path.join(__dirname, '..', 'prisma', 'drift.candidate.sql');
      fs.writeFileSync(candidatePath, result.driftSql, { encoding: 'utf8', flag: 'wx' });
      console.log(`Wrote drift candidate for review: ${candidatePath}`);
    } else {
      console.log(`Supabase verification passed for ${result.migrationCount} migration(s).`);
    }
  } finally {
    try {
      if (created) {
        await admin.$executeRawUnsafe(`DROP SCHEMA "${verificationSchema}" CASCADE`);
        const remaining = await admin.$queryRaw<Array<{ exists: boolean }>>`
          SELECT EXISTS (
            SELECT 1 FROM pg_namespace WHERE nspname = ${verificationSchema}
          ) AS exists
        `;
        if (remaining[0]?.exists) {
          throw new Error(`Failed to remove verification schema ${verificationSchema}`);
        }
        console.log(`Removed verification schema ${verificationSchema}.`);
      }
    } finally {
      await admin.$disconnect();
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Supabase migration verification failed: ${message}`);
  process.exitCode = 1;
});
