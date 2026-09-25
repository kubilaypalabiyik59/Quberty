import 'dotenv/config';
import path from 'path';
import { assertEphemeralCiDatabaseUrls } from '../src/infrastructure/database/migrationPolicy';
import { runMigrationVerification } from './migrationVerification';

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const directUrl = process.env.DIRECT_URL ?? '';
  assertEphemeralCiDatabaseUrls(databaseUrl, directUrl);

  const expectedDriftPath = path.join(__dirname, '..', 'prisma', 'drift.snapshot.sql');
  const result = await runMigrationVerification({ databaseUrl, directUrl, expectedDriftPath });
  console.log(`Migration CI verification passed for ${result.migrationCount} migration(s).`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration CI verification failed: ${message}`);
  process.exitCode = 1;
});
