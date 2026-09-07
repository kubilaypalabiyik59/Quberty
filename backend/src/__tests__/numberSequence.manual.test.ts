import { allocateNumber, formatNumber } from '../shared/services/numberSequence.service';

/**
 * The automatic/manual switch on a number sequence.
 *
 * **[OFFICIAL]** D365 puts this flag on the sequence itself, not in a module
 * parameter — "specify whether the number sequence is manual, and continuous or
 * non-continuous" — which is what lets FACTURA be typed by hand from pre-printed
 * stock while CREDIT_NOTE stays generated, in one tenant.
 * learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/organization-administration/tasks/set-up-number-sequences-individual-basis
 *
 * What these tests are actually protecting is the pair of REFUSALS. Handing back
 * a generated number when the operator typed one, or generating one when the
 * sequence is supposed to be manual, both produce a legal document carrying a
 * number nobody chose — and neither would fail loudly.
 */

const rows: Record<string, any> = {};
let updateCalls = 0;

jest.mock('../infrastructure/database/client', () => ({
  db: {
    numberSequence: {
      findFirst: jest.fn(async ({ where }: any) => rows[where.reference] ?? null),
    },
    $queryRaw: jest.fn(async () => {
      updateCalls += 1;
      return [{ allocated: 41, year_used: 2026 }];
    }),
  },
}));

const seq = (over: Partial<any> = {}) => ({
  id: '00000000-0000-0000-0000-000000000001',
  format: '{######}',
  continuous: false,
  manual: false,
  scope: 'LEGAL_ENTITY',
  next_number: 42,
  current_year: null,
  is_active: true,
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k];
  updateCalls = 0;
});

describe('formatNumber', () => {
  it('renders the Bolivian factura format as the clients used to render it', () => {
    // The clients ran `String(n).padStart(6, '0')`, so `{######}` is what keeps
    // every already-issued number byte-identical after migration 023.
    expect(formatNumber('{######}', 1, 2026)).toBe('000001');
    expect(formatNumber('{######}', 247, 2026)).toBe('000247');
  });

  it('carries a prefix and a year without the caller knowing', () => {
    expect(formatNumber('F-{YYYY}-{#####}', 42, 2026)).toBe('F-2026-00042');
  });
});

describe('an automatic sequence', () => {
  it('generates the number and ignores nothing', async () => {
    rows.FACTURA = seq();
    const n = await allocateNumber({ tenantId: 't', reference: 'FACTURA' });
    expect(n).toBe('000041');
    expect(updateCalls).toBe(1);
  });

  it('REFUSES a number supplied by the caller', async () => {
    rows.FACTURA = seq();
    await expect(
      allocateNumber({ tenantId: 't', reference: 'FACTURA', manualNumber: '000999' }),
    ).rejects.toThrow(/generates its own numbers/);
    // The counter must not have moved: a rejected request that still burned a
    // number would put a gap in a series the tenant believes is unbroken.
    expect(updateCalls).toBe(0);
  });
});

describe('a manual sequence', () => {
  it('returns exactly what was typed, whatever the format says', async () => {
    rows.FACTURA = seq({ manual: true });
    const n = await allocateNumber({
      tenantId: 't', reference: 'FACTURA', manualNumber: '  A-04-0001918  ',
    });
    // Trimmed, but not reformatted, not padded, not validated against `{######}`.
    // Authority-issued stock does not have to match our own format — rejecting it
    // would defeat the point of the switch.
    expect(n).toBe('A-04-0001918');
  });

  it('does not touch the counter', async () => {
    rows.FACTURA = seq({ manual: true });
    await allocateNumber({ tenantId: 't', reference: 'FACTURA', manualNumber: '7' });
    expect(updateCalls).toBe(0);
  });

  it('REFUSES to invent one when the operator supplied nothing', async () => {
    rows.FACTURA = seq({ manual: true });
    await expect(
      allocateNumber({ tenantId: 't', reference: 'FACTURA' }),
    ).rejects.toThrow(/must be supplied/);
    await expect(
      allocateNumber({ tenantId: 't', reference: 'FACTURA', manualNumber: '   ' }),
    ).rejects.toThrow(/must be supplied/);
  });

  it('is allowed even while the sequence is continuous, with no transaction', async () => {
    // Gaplessness is about a counter nobody is drawing from here, so the
    // continuous guard must not fire. A tenant on pre-printed stock that is
    // legally gapless is exactly the case where both flags are on.
    rows.FACTURA = seq({ manual: true, continuous: true });
    await expect(
      allocateNumber({ tenantId: 't', reference: 'FACTURA', manualNumber: '000042' }),
    ).resolves.toBe('000042');
  });
});

describe('a continuous automatic sequence', () => {
  it('refuses to allocate outside the caller transaction', async () => {
    // This is the defect migration 023 fixes: all three factura allocators drew
    // the number before opening the transaction that wrote the document, so any
    // failure after allocation burned a legally sequential number.
    rows.FACTURA = seq({ continuous: true });
    await expect(
      allocateNumber({ tenantId: 't', reference: 'FACTURA' }),
    ).rejects.toThrow(/must be allocated inside a transaction/);
  });
});
