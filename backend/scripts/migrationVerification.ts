import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { discoverMigrations, runMigrationEngine, type DiscoveredMigration } from './migrationEngine';

type LedgerRow = { migration_name: string; ordinal: number; checksum: string };

export interface MigrationVerificationOptions {
  databaseUrl: string;
  directUrl: string;
  expectedDriftPath?: string;
}

export interface MigrationVerificationResult {
  driftSql: string;
  migrationCount: number;
}

function createClient(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } }, log: ['error'] });
}

async function assertCurrentSchemaEmpty(url: string): Promise<void> {
  const prisma = createClient(url);
  try {
    const [{ relation_count, enum_count }] = await prisma.$queryRaw<
      [{ relation_count: string; enum_count: string }]
    >`
      SELECT
        (SELECT COUNT(*)::text
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema()
            AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) AS relation_count,
        (SELECT COUNT(*)::text
           FROM pg_type t
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = current_schema()
            AND t.typtype = 'e') AS enum_count
    `;
    if (relation_count !== '0' || enum_count !== '0') {
      throw new Error(
        `Expected an empty verification schema; found ${relation_count} relation(s) and ${enum_count} enum(s)`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyAtomicRollback(
  url: string,
  migrations: readonly DiscoveredMigration[],
): Promise<void> {
  const marker = 'WORK_015_EXPECTED_ROLLBACK';
  try {
    await runMigrationEngine(url, migrations, {
      appliedBy: 'work-015-atomicity',
      log: () => undefined,
      beforeLedgerInsert: (migration) => {
        if (migration.ordinal === 0) throw new Error(marker);
      },
    });
    throw new Error('Atomicity probe unexpectedly completed');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(marker)) throw error;
  }
  await assertCurrentSchemaEmpty(url);
}

async function readLedger(url: string): Promise<LedgerRow[]> {
  const prisma = createClient(url);
  try {
    return await prisma.$queryRaw<LedgerRow[]>`
      SELECT migration_name, ordinal, checksum
        FROM skarpine_schema_migrations
       ORDER BY ordinal
    `;
  } finally {
    await prisma.$disconnect();
  }
}

function verifyLedger(migrations: readonly DiscoveredMigration[], ledger: readonly LedgerRow[]): void {
  if (ledger.length !== migrations.length) {
    throw new Error(`Ledger contains ${ledger.length} rows; expected ${migrations.length}`);
  }
  for (let index = 0; index < migrations.length; index++) {
    const migration = migrations[index];
    const row = ledger[index];
    if (
      row.migration_name !== migration.name ||
      row.ordinal !== migration.ordinal ||
      row.checksum !== migration.checksum
    ) {
      throw new Error(`Ledger mismatch at ordinal ${migration.ordinal}: ${migration.name}`);
    }
  }
}

async function verifyConcurrencyAndRepeatability(
  url: string,
  migrations: readonly DiscoveredMigration[],
): Promise<void> {
  const [left, right] = await Promise.all([
    runMigrationEngine(url, migrations, { appliedBy: 'work-015-concurrency-a', log: () => undefined }),
    runMigrationEngine(url, migrations, { appliedBy: 'work-015-concurrency-b', log: () => undefined }),
  ]);
  const lengths = [left.appliedNames.length, right.appliedNames.length].sort((a, b) => a - b);
  if (lengths[0] !== 0 || lengths[1] !== migrations.length) {
    throw new Error(`Concurrent runners applied ${lengths.join(' and ')} migrations`);
  }
  verifyLedger(migrations, await readLedger(url));

  const repeat = await runMigrationEngine(url, migrations, {
    appliedBy: 'work-015-repeatability',
    log: () => undefined,
  });
  if (repeat.appliedNames.length !== 0) {
    throw new Error(`Repeat run applied ${repeat.appliedNames.length} migration(s)`);
  }
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function readSchemaDrift(databaseUrl: string, directUrl: string): string {
  const prismaCliPath = require.resolve('prisma/build/index.js');
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const result = spawnSync(
    process.execPath,
    [
      prismaCliPath,
      'migrate',
      'diff',
      '--from-url',
      directUrl,
      '--to-schema-datamodel',
      schemaPath,
      '--script',
    ],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: directUrl },
      shell: false,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Prisma drift command failed with exit code ${result.status}: ${result.stderr}`);
  }
  // Prisma may emit one or two terminal newlines depending on the schema
  // diff it generated. The reviewed snapshot is a semantic artifact; compare
  // a deterministic single trailing newline so an empty diff cannot fail only
  // because of formatter output.
  return normalizeLineEndings(result.stdout).replace(/\n+$/, '\n');
}

export async function runMigrationVerification(
  options: MigrationVerificationOptions,
): Promise<MigrationVerificationResult> {
  await assertCurrentSchemaEmpty(options.directUrl);
  const migrations = discoverMigrations();
  if (migrations[0]?.ordinal !== 0) throw new Error('Migration chain does not start with 000');

  await verifyAtomicRollback(options.directUrl, migrations);
  await verifyConcurrencyAndRepeatability(options.directUrl, migrations);
  const driftSql = readSchemaDrift(options.databaseUrl, options.directUrl);

  if (options.expectedDriftPath) {
    if (!fs.existsSync(options.expectedDriftPath)) {
      throw new Error(`Reviewed drift snapshot is missing: ${options.expectedDriftPath}`);
    }
    const expected = normalizeLineEndings(fs.readFileSync(options.expectedDriftPath, 'utf8'));
    if (driftSql !== expected) {
      throw new Error(`Schema drift differs from the reviewed snapshot: ${options.expectedDriftPath}`);
    }
  }

  return { driftSql, migrationCount: migrations.length };
}
