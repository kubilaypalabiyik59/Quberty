import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  ADVISORY_LOCK_KEY,
  LEDGER_BOOTSTRAP_DDL,
  computeChecksum,
  parseMigrationName,
  splitStatements,
  validateDiscoveredSet,
  validateFileMetadata,
  validateLedger,
  type LedgerRow,
  type MigrationDescriptor,
} from '../src/infrastructure/database/migrationPolicy';

export interface DiscoveredMigration extends MigrationDescriptor {
  bytes: Buffer;
}

export interface MigrationEngineOptions {
  appliedBy: string;
  appVersion?: string;
  log?: (message: string) => void;
  /** Programmatic verification hook. The command-line runner never sets it. */
  beforeLedgerInsert?: (migration: Readonly<DiscoveredMigration>) => void | Promise<void>;
}

export interface MigrationEngineResult {
  appliedNames: string[];
}

export const DEFAULT_SQL_DIRECTORY = path.join(__dirname, '..', 'prisma', 'sql');

export function discoverMigrations(sqlDirectory = DEFAULT_SQL_DIRECTORY): DiscoveredMigration[] {
  const migrations: DiscoveredMigration[] = [];

  for (const name of fs.readdirSync(sqlDirectory).filter((entry) => entry.toLowerCase().endsWith('.sql'))) {
    const fullPath = path.join(sqlDirectory, name);
    const stat = fs.lstatSync(fullPath);
    validateFileMetadata({ name, isFile: stat.isFile(), isSymbolicLink: stat.isSymbolicLink() });

    const parsed = parseMigrationName(name)!;
    const bytes = fs.readFileSync(fullPath);
    migrations.push({ name, ordinal: parsed.ordinal, checksum: computeChecksum(bytes), bytes });
  }

  migrations.sort((left, right) => left.ordinal - right.ordinal);
  validateDiscoveredSet(migrations);
  return migrations;
}

export async function runMigrationEngine(
  url: string,
  migrations: readonly DiscoveredMigration[],
  options: MigrationEngineOptions,
): Promise<MigrationEngineResult> {
  const appliedBy = options.appliedBy.trim();
  const appVersion = options.appVersion?.trim() || 'unknown';
  const log = options.log ?? console.log;
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });

  try {
    const appliedNames = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          `SELECT 1 AS locked FROM pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`,
        );

        for (const ddl of LEDGER_BOOTSTRAP_DDL) {
          await tx.$executeRawUnsafe(ddl);
        }

        const ledger = await tx.$queryRaw<LedgerRow[]>`
          SELECT migration_name, ordinal, checksum
            FROM skarpine_schema_migrations
           ORDER BY ordinal
        `;

        if (ledger.length === 0) {
          const [{ count }] = await tx.$queryRaw<[{ count: string }]>`
            SELECT COUNT(*)::text AS count
              FROM information_schema.tables
             WHERE table_schema = current_schema()
               AND table_type = 'BASE TABLE'
               AND table_name <> 'skarpine_schema_migrations'
          `;
          if (Number.parseInt(count, 10) > 0) {
            throw new Error('EXISTING_DATABASE_REQUIRES_BASELINE');
          }
        }

        const pending = validateLedger([...migrations], ledger) as DiscoveredMigration[];
        if (pending.length === 0) {
          log('No pending migrations. Database is up to date.');
          return [];
        }
        if (!appliedBy) {
          throw new Error('MIGRATION_APPLIED_BY must be set and non-blank when migrations are pending');
        }

        log(`Applying ${pending.length} migration(s) as "${appliedBy}"...`);
        const applied: string[] = [];
        for (const migration of pending) {
          const statements = splitStatements(migration.bytes.toString('utf8'));
          const startedAt = Date.now();
          for (const statement of statements) {
            await tx.$executeRawUnsafe(statement);
          }
          const durationMs = Date.now() - startedAt;

          await options.beforeLedgerInsert?.(migration);
          await tx.$executeRaw`
            INSERT INTO skarpine_schema_migrations
              (migration_name, ordinal, checksum, applied_by, duration_ms, app_version)
            VALUES
              (${migration.name}, ${migration.ordinal}, ${migration.checksum},
               ${appliedBy}, ${durationMs}, ${appVersion})
          `;
          applied.push(migration.name);
          log(`Applied ${migration.name} in ${durationMs}ms`);
        }
        return applied;
      },
      { timeout: 300_000, maxWait: 30_000 },
    );

    return { appliedNames };
  } finally {
    await prisma.$disconnect();
  }
}
