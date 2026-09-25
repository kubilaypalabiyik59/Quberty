import crypto from 'crypto';

export interface FileMetadata {
  name: string;
  isFile: boolean;
  isSymbolicLink: boolean;
}

export interface MigrationDescriptor {
  name: string;
  ordinal: number;
  checksum: string;
}

export interface LedgerRow {
  migration_name: string;
  ordinal: number;
  checksum: string;
}

export const MIGRATION_NAME_RE = /^(\d{3})_([a-z][a-z0-9_]*)\.sql$/;
export const CHECKSUM_RE = /^[0-9a-f]{64}$/;
export const ADVISORY_LOCK_KEY = 39264738947263;

export function assertEphemeralCiDatabaseUrls(databaseUrl: string, directUrl: string): void {
  if (databaseUrl !== directUrl) {
    throw new Error('Migration CI requires DATABASE_URL and DIRECT_URL to be identical');
  }

  let parsed: URL;
  try {
    parsed = new URL(directUrl);
  } catch {
    throw new Error('Migration CI database URL is invalid');
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Migration CI requires a PostgreSQL URL');
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('Migration CI refuses non-loopback databases');
  }
  if (decodeURIComponent(parsed.pathname) !== '/skarpine_test') {
    throw new Error('Migration CI requires the disposable skarpine_test database');
  }
}

export function buildIsolatedSupabaseUrl(rawUrl: string, schema: string): string {
  if (!/^work015_verify_[a-z0-9_]+$/.test(schema)) {
    throw new Error('Invalid WORK-015 verification schema name');
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Supabase verification URL is invalid');
  }
  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Supabase verification requires a PostgreSQL URL');
  }
  if (!parsed.hostname.endsWith('.supabase.com')) {
    throw new Error('Supabase verification refuses a non-Supabase host');
  }
  if (decodeURIComponent(parsed.pathname) !== '/postgres') {
    throw new Error('Supabase verification requires the test project postgres database');
  }
  if (parsed.searchParams.has('schema')) {
    throw new Error('Supabase verification source URL must not select an existing schema');
  }

  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

export const LEDGER_BOOTSTRAP_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS skarpine_schema_migrations (
    migration_name TEXT        NOT NULL,
    ordinal        INTEGER     NOT NULL CHECK (ordinal >= 0),
    checksum       TEXT        NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by     TEXT        NOT NULL,
    duration_ms    INTEGER     NOT NULL CHECK (duration_ms >= 0),
    app_version    TEXT        NOT NULL,
    CONSTRAINT skarpine_schema_migrations_pkey PRIMARY KEY (migration_name)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS skarpine_schema_migrations_ordinal_uidx
     ON skarpine_schema_migrations (ordinal)`,
];

export function parseMigrationName(name: string): { ordinal: number; slug: string } | null {
  const match = MIGRATION_NAME_RE.exec(name);
  if (!match) return null;
  return { ordinal: Number.parseInt(match[1], 10), slug: match[2] };
}

export function validateFileMetadata(meta: FileMetadata): void {
  if (!parseMigrationName(meta.name)) {
    throw new Error(`Invalid migration filename: ${meta.name}`);
  }
  if (meta.isSymbolicLink) {
    throw new Error(`Migration file must not be a symbolic link: ${meta.name}`);
  }
  if (!meta.isFile) {
    throw new Error(`Migration path is not a regular file: ${meta.name}`);
  }
}

export function validateDiscoveredSet(descriptors: MigrationDescriptor[]): void {
  if (descriptors.length === 0) throw new Error('No migration files found');

  for (const descriptor of descriptors) {
    const parsed = parseMigrationName(descriptor.name);
    if (!parsed) throw new Error(`Invalid migration filename: ${descriptor.name}`);
    if (parsed.ordinal !== descriptor.ordinal) {
      throw new Error(`Migration ordinal does not match filename: ${descriptor.name}`);
    }
    if (!CHECKSUM_RE.test(descriptor.checksum)) {
      throw new Error(`Invalid migration checksum: ${descriptor.name}`);
    }
  }

  const first = descriptors[0].ordinal;
  if (first !== 0 && first !== 1) {
    throw new Error(`Migration chain must start at ordinal 000 or 001, got ${first}`);
  }

  for (let index = 1; index < descriptors.length; index++) {
    const previous = descriptors[index - 1];
    const current = descriptors[index];
    if (current.ordinal <= previous.ordinal) {
      throw new Error(`Migration ordinals are unsorted or duplicated: ${previous.name}, ${current.name}`);
    }
    const expected = previous.ordinal + 1;
    if (current.ordinal !== expected) {
      throw new Error(
        `Gap in migration ordinals: expected ${String(expected).padStart(3, '0')}, got ${current.ordinal}`,
      );
    }
  }
}

export function computeChecksum(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function validateLedger(
  discovered: MigrationDescriptor[],
  ledger: LedgerRow[],
): MigrationDescriptor[] {
  const seenNames = new Set<string>();
  const seenOrdinals = new Set<number>();

  for (const row of ledger) {
    if (seenNames.has(row.migration_name)) {
      throw new Error(`Duplicate ledger migration: ${row.migration_name}`);
    }
    if (seenOrdinals.has(row.ordinal)) {
      throw new Error(`Duplicate ledger ordinal: ${row.ordinal}`);
    }
    seenNames.add(row.migration_name);
    seenOrdinals.add(row.ordinal);
  }

  if (ledger.length > discovered.length) {
    throw new Error('Ledger contains more entries than the migration chain');
  }

  const knownNames = new Set(discovered.map((item) => item.name));
  for (const row of ledger) {
    if (!knownNames.has(row.migration_name)) {
      throw new Error(`Unknown migration in ledger: ${row.migration_name}`);
    }
  }

  for (let index = 0; index < ledger.length; index++) {
    const row = ledger[index];
    const descriptor = discovered[index];
    if (row.migration_name !== descriptor.name) {
      throw new Error(
        `Ledger is not a migration-chain prefix at position ${index}: ` +
          `found ${row.migration_name}, expected ${descriptor.name}`,
      );
    }
    if (row.ordinal !== descriptor.ordinal) {
      throw new Error(`Ledger ordinal mismatch for ${row.migration_name}`);
    }
    if (!CHECKSUM_RE.test(row.checksum)) {
      throw new Error(`Invalid ledger checksum for ${row.migration_name}`);
    }
    if (row.checksum !== descriptor.checksum) {
      throw new Error(`Checksum mismatch for ${row.migration_name}: migration history was modified`);
    }
  }

  return discovered.slice(ledger.length);
}

type SplitterState =
  | 'NORMAL'
  | 'SINGLE_QUOTE'
  | 'DOUBLE_QUOTE'
  | 'DOLLAR_QUOTE'
  | 'LINE_COMMENT'
  | 'BLOCK_COMMENT';

function skipWhitespaceAndComments(statement: string, start: number): number {
  let index = start;
  while (index < statement.length) {
    if (/\s/.test(statement[index])) {
      index++;
      continue;
    }
    if (statement[index] === '-' && statement[index + 1] === '-') {
      index += 2;
      while (index < statement.length && statement[index] !== '\n') index++;
      continue;
    }
    if (statement[index] === '/' && statement[index + 1] === '*') {
      index += 2;
      let depth = 1;
      while (index < statement.length && depth > 0) {
        if (statement[index] === '/' && statement[index + 1] === '*') {
          depth++;
          index += 2;
        } else if (statement[index] === '*' && statement[index + 1] === '/') {
          depth--;
          index += 2;
        } else {
          index++;
        }
      }
      continue;
    }
    break;
  }
  return index;
}

function firstExecutableWords(statement: string): string[] {
  const words: string[] = [];
  let index = 0;
  while (words.length < 2) {
    index = skipWhitespaceAndComments(statement, index);
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(statement.slice(index));
    if (!match) break;
    words.push(match[0].toUpperCase());
    index += match[0].length;
  }
  return words;
}

function assertNoTransactionControl(statement: string): void {
  const [first, second] = firstExecutableWords(statement);
  const forbiddenFirst = new Set(['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'END', 'ABORT']);
  const forbiddenPair =
    (first === 'RELEASE' && second === 'SAVEPOINT') ||
    (first === 'START' && second === 'TRANSACTION') ||
    (first === 'PREPARE' && second === 'TRANSACTION');
  if (forbiddenFirst.has(first) || forbiddenPair) {
    throw new Error(`Transaction-control statement not allowed in migration: ${[first, second].filter(Boolean).join(' ')}`);
  }
}

export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = '';
  let index = 0;
  let state: SplitterState = 'NORMAL';
  let blockDepth = 0;
  let dollarTag = '';

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (state === 'NORMAL') {
      if (char === '-' && next === '-') {
        state = 'LINE_COMMENT';
        buffer += '--';
        index += 2;
      } else if (char === '/' && next === '*') {
        state = 'BLOCK_COMMENT';
        blockDepth = 1;
        buffer += '/*';
        index += 2;
      } else if (char === "'") {
        state = 'SINGLE_QUOTE';
        buffer += char;
        index++;
      } else if (char === '"') {
        state = 'DOUBLE_QUOTE';
        buffer += char;
        index++;
      } else if (char === '$') {
        const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(index));
        if (match) {
          dollarTag = match[0];
          state = 'DOLLAR_QUOTE';
          buffer += dollarTag;
          index += dollarTag.length;
        } else {
          buffer += char;
          index++;
        }
      } else if (char === ';') {
        const statement = buffer.trim();
        if (firstExecutableWords(statement).length > 0) statements.push(statement);
        buffer = '';
        index++;
      } else {
        buffer += char;
        index++;
      }
      continue;
    }

    if (state === 'SINGLE_QUOTE') {
      buffer += char;
      index++;
      if (char === "'" && next === "'") {
        buffer += next;
        index++;
      } else if (char === "'") {
        state = 'NORMAL';
      }
      continue;
    }

    if (state === 'DOUBLE_QUOTE') {
      buffer += char;
      index++;
      if (char === '"' && next === '"') {
        buffer += next;
        index++;
      } else if (char === '"') {
        state = 'NORMAL';
      }
      continue;
    }

    if (state === 'DOLLAR_QUOTE') {
      if (sql.startsWith(dollarTag, index)) {
        buffer += dollarTag;
        index += dollarTag.length;
        state = 'NORMAL';
      } else {
        buffer += char;
        index++;
      }
      continue;
    }

    if (state === 'LINE_COMMENT') {
      buffer += char;
      index++;
      if (char === '\n') state = 'NORMAL';
      continue;
    }

    if (char === '/' && next === '*') {
      blockDepth++;
      buffer += '/*';
      index += 2;
    } else if (char === '*' && next === '/') {
      blockDepth--;
      buffer += '*/';
      index += 2;
      if (blockDepth === 0) state = 'NORMAL';
    } else {
      buffer += char;
      index++;
    }
  }

  if (state === 'SINGLE_QUOTE') throw new Error('Unterminated single-quoted string');
  if (state === 'DOUBLE_QUOTE') throw new Error('Unterminated double-quoted identifier');
  if (state === 'DOLLAR_QUOTE') throw new Error(`Unterminated dollar-quoted string: ${dollarTag}`);
  if (state === 'BLOCK_COMMENT') throw new Error('Unterminated block comment');

  if (firstExecutableWords(buffer).length > 0) {
    throw new Error('SQL statement not terminated with semicolon');
  }
  if (statements.length === 0) {
    throw new Error('Migration file contains no executable SQL statements');
  }
  for (const statement of statements) assertNoTransactionControl(statement);
  return statements;
}
