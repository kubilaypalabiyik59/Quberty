import 'dotenv/config';
import { discoverMigrations, runMigrationEngine } from './migrationEngine';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    throw new Error(`usage: tsx scripts/applyMigration.ts (unexpected arguments: ${args.join(' ')})`);
  }

  const url = process.env.DIRECT_URL;
  if (!url) {
    throw new Error('DIRECT_URL is not set — refusing to run DDL through the pooler.');
  }

  await runMigrationEngine(url, discoverMigrations(), {
    appliedBy: process.env.MIGRATION_APPLIED_BY ?? '',
    appVersion: process.env.npm_package_version,
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Migration failed: ${message}`);
  process.exitCode = 1;
});
