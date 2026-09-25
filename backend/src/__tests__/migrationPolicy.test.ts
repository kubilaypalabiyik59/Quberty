import {
  assertEphemeralCiDatabaseUrls,
  buildIsolatedSupabaseUrl,
  computeChecksum,
  parseMigrationName,
  splitStatements,
  validateDiscoveredSet,
  validateFileMetadata,
  validateLedger,
  type LedgerRow,
  type MigrationDescriptor,
} from '../infrastructure/database/migrationPolicy';

const checksumA = 'a'.repeat(64);
const checksumB = 'b'.repeat(64);

describe('migration CI database boundary', () => {
  const localUrl = 'postgresql://ci_user:ci_password@127.0.0.1:5432/skarpine_test';

  test('accepts one identical loopback PostgreSQL URL for the disposable database', () => {
    expect(() => assertEphemeralCiDatabaseUrls(localUrl, localUrl)).not.toThrow();
  });

  test.each([
    ['postgresql://ci_user:ci_password@db.example.test:5432/skarpine_test', localUrl, /identical|loopback/i],
    ['postgresql://ci_user:ci_password@127.0.0.1:5432/other', 'postgresql://ci_user:ci_password@127.0.0.1:5432/other', /skarpine_test/i],
    ['mysql://ci_user:ci_password@127.0.0.1:5432/skarpine_test', 'mysql://ci_user:ci_password@127.0.0.1:5432/skarpine_test', /PostgreSQL/i],
    ['not-a-url', 'not-a-url', /invalid/i],
  ])('rejects an unsafe CI database target', (databaseUrl, directUrl, message) => {
    expect(() => assertEphemeralCiDatabaseUrls(databaseUrl, directUrl)).toThrow(message as RegExp);
  });
});

describe('isolated Supabase verification boundary', () => {
  const sourceUrl = 'postgresql://ci_user:ci_password@project.pooler.supabase.com:5432/postgres';

  test('adds only the approved isolated schema to a Supabase test URL', () => {
    const scoped = new URL(buildIsolatedSupabaseUrl(sourceUrl, 'work015_verify_20260909'));
    expect(scoped.hostname).toBe('project.pooler.supabase.com');
    expect(scoped.pathname).toBe('/postgres');
    expect(scoped.searchParams.get('schema')).toBe('work015_verify_20260909');
  });

  test.each([
    ['postgresql://ci_user:ci_password@db.example.test:5432/postgres', 'work015_verify_20260909', /non-Supabase/i],
    ['postgresql://ci_user:ci_password@project.pooler.supabase.com:5432/other', 'work015_verify_20260909', /postgres database/i],
    [`${sourceUrl}?schema=public`, 'work015_verify_20260909', /must not select/i],
    [sourceUrl, 'public', /schema name/i],
  ])('rejects an unsafe Supabase verification target', (url, schema, message) => {
    expect(() => buildIsolatedSupabaseUrl(url, schema)).toThrow(message as RegExp);
  });
});

function migration(name: string, ordinal: number, checksum = checksumA): MigrationDescriptor {
  return { name, ordinal, checksum };
}

function ledger(migration_name: string, ordinal: number, checksum = checksumA): LedgerRow {
  return { migration_name, ordinal, checksum };
}

describe('migration file policy', () => {
  test.each([
    ['001_create_users.sql', { ordinal: 1, slug: 'create_users' }],
    ['000_baseline.sql', { ordinal: 0, slug: 'baseline' }],
  ])('parses %s', (name, expected) => {
    expect(parseMigrationName(name)).toEqual(expected);
  });

  test.each(['01_short.sql', '001_.sql', '001_Upper.sql', '../001_escape.sql', '001_name.txt'])(
    'rejects invalid name %s',
    (name) => expect(parseMigrationName(name)).toBeNull(),
  );

  test('rejects symlinks and non-files', () => {
    expect(() => validateFileMetadata({ name: '001_a.sql', isFile: true, isSymbolicLink: true }))
      .toThrow(/symbolic link/i);
    expect(() => validateFileMetadata({ name: '001_a.sql', isFile: false, isSymbolicLink: false }))
      .toThrow(/regular file/i);
  });

  test('hashes raw bytes deterministically and detects changes', () => {
    const first = computeChecksum(Buffer.from('SELECT 1;'));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(computeChecksum(Buffer.from('SELECT 1;')));
    expect(first).not.toBe(computeChecksum(Buffer.from('SELECT 2;')));
  });

  test('accepts consecutive chains starting at 001 and future 000', () => {
    expect(() => validateDiscoveredSet([migration('001_a.sql', 1), migration('002_b.sql', 2)]))
      .not.toThrow();
    expect(() => validateDiscoveredSet([migration('000_base.sql', 0), migration('001_a.sql', 1)]))
      .not.toThrow();
  });

  test('rejects empty, late-starting, unsorted, duplicate, and gapped chains', () => {
    expect(() => validateDiscoveredSet([])).toThrow(/no migration/i);
    expect(() => validateDiscoveredSet([migration('002_a.sql', 2)])).toThrow(/start/i);
    expect(() => validateDiscoveredSet([migration('002_b.sql', 2), migration('001_a.sql', 1)]))
      .toThrow(/start|unsorted/i);
    expect(() => validateDiscoveredSet([migration('001_a.sql', 1), migration('001_b.sql', 1)]))
      .toThrow(/duplicated/i);
    expect(() => validateDiscoveredSet([migration('001_a.sql', 1), migration('003_c.sql', 3)]))
      .toThrow(/gap/i);
  });

  test('rejects descriptor name/ordinal and checksum mismatches', () => {
    expect(() => validateDiscoveredSet([migration('001_a.sql', 0)])).toThrow(/does not match/i);
    expect(() => validateDiscoveredSet([migration('001_a.sql', 1, 'bad')])).toThrow(/checksum/i);
  });
});

describe('migration ledger policy', () => {
  const discovered = [
    migration('001_a.sql', 1),
    migration('002_b.sql', 2),
    migration('003_c.sql', 3),
  ];

  test('returns the pending suffix for an exact prefix', () => {
    expect(validateLedger(discovered, []).map((item) => item.name)).toEqual([
      '001_a.sql', '002_b.sql', '003_c.sql',
    ]);
    expect(validateLedger(discovered, [ledger('001_a.sql', 1)]).map((item) => item.name))
      .toEqual(['002_b.sql', '003_c.sql']);
    expect(validateLedger(discovered, discovered.map((item) => ledger(item.name, item.ordinal))))
      .toEqual([]);
  });

  test('rejects unknown, duplicate-name, and duplicate-ordinal rows', () => {
    expect(() => validateLedger(discovered, [ledger('999_unknown.sql', 999)])).toThrow(/unknown/i);
    expect(() => validateLedger(discovered, [ledger('001_a.sql', 1), ledger('001_a.sql', 1)]))
      .toThrow(/duplicate ledger migration/i);
    expect(() => validateLedger(discovered, [ledger('001_a.sql', 1), ledger('002_b.sql', 1)]))
      .toThrow(/duplicate ledger ordinal/i);
  });

  test('rejects non-prefix, ordinal, and checksum mismatches', () => {
    expect(() => validateLedger(discovered, [ledger('002_b.sql', 2)])).toThrow(/prefix/i);
    expect(() => validateLedger(discovered, [ledger('001_a.sql', 9)])).toThrow(/ordinal/i);
    expect(() => validateLedger(discovered, [ledger('001_a.sql', 1, 'BAD')])).toThrow(/checksum/i);
    expect(() => validateLedger(discovered, [ledger('001_a.sql', 1, checksumB)]))
      .toThrow(/checksum mismatch/i);
  });
});

describe('PostgreSQL statement policy', () => {
  test('splits statements and preserves quoted semicolons', () => {
    expect(splitStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
    expect(splitStatements("INSERT INTO t VALUES ('a;b');")).toHaveLength(1);
    expect(splitStatements('SELECT "column;name" FROM t;')).toHaveLength(1);
  });

  test('preserves anonymous and named dollar-quoted bodies', () => {
    expect(splitStatements('CREATE FUNCTION f() RETURNS void AS $$ SELECT 1; $$ LANGUAGE sql;'))
      .toHaveLength(1);
    expect(splitStatements('CREATE FUNCTION f() RETURNS void AS $body$ SELECT 1; $body$ LANGUAGE sql;'))
      .toHaveLength(1);
  });

  test('handles line, block, and nested block comments', () => {
    expect(splitStatements('-- a;\nSELECT 1;')).toHaveLength(1);
    expect(splitStatements('/* a; */ SELECT 1;')).toHaveLength(1);
    expect(splitStatements('/* outer /* inner; */ outer */ SELECT 1;')).toHaveLength(1);
  });

  test.each([
    ["SELECT 'unterminated;", /unterminated single/i],
    ['SELECT "unterminated;', /unterminated double/i],
    ['SELECT $$ unterminated;', /unterminated dollar/i],
    ['SELECT 1; /* unterminated', /unterminated block/i],
    ['SELECT 1', /not terminated/i],
    ['', /no executable/i],
    ['-- only comment', /no executable/i],
  ])('rejects malformed or empty SQL', (sql, message) => {
    expect(() => splitStatements(sql)).toThrow(message as RegExp);
  });

  test.each([
    'BEGIN;', 'COMMIT;', 'ROLLBACK;', 'SAVEPOINT x;', 'RELEASE SAVEPOINT x;',
    'START TRANSACTION;', 'END;', 'ABORT;', 'PREPARE TRANSACTION x;',
    '-- note\nBEGIN;', '/* note */ COMMIT;',
    '/* outer /* inner */ outer */ ROLLBACK;',
  ])('rejects runner-owned transaction control: %s', (sql) => {
    expect(() => splitStatements(sql)).toThrow(/transaction-control/i);
  });

  test.each([
    '-- BEGIN\nSELECT 1;',
    '/* COMMIT */ SELECT 1;',
    "INSERT INTO t VALUES ('ROLLBACK');",
    'SELECT "SAVEPOINT" FROM t;',
  ])('does not treat quoted or commented words as transaction control', (sql) => {
    expect(() => splitStatements(sql)).not.toThrow();
  });
});
