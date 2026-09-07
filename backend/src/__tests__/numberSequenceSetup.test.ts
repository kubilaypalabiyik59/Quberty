/**
 * NUMBER SEQUENCE SETUP TESTS
 *
 * Two defects are pinned here, both of which were invisible on the anchor tenant
 * and would have surfaced on the first tenant configured differently:
 *
 * 1. `PUT /setup/number-sequences/:id` accepted raw JSON and coerced it, so
 *    `{"manual":"false"}` switched the LEGAL invoice series to manual — the
 *    string "false" is truthy — and a format could be saved with a token that is
 *    never substituted and therefore printed verbatim onto a factura.
 *
 * 2. `highest_issued` came from Prisma `_max` on a column that is TEXT since
 *    migration 023, so it was lexicographic. `'99' > '100'`, which is wrong in
 *    the one direction that matters: the guard that stops an automatic series
 *    resuming beneath what was already issued would have let it through, and the
 *    next sale fails at the till on a unique-constraint violation.
 *
 * No database and no HTTP: these are the pure units both routes delegate to.
 */

import { UpdateNumberSequenceSchema } from '../shared/schemas';
import { formatNumber } from '../shared/services/numberSequence.service';
import {
  inspectSequenceFormat,
  highestIssuedNumber,
  evaluateAutomaticResume,
  effectiveFormatRefusal,
  checkManualToAutomatic,
  persistedSequenceFields,
  resumeBehindReason,
  fiscalYearResumeUnsupported,
  FISCAL_YEAR_SCOPE,
  NEXT_NUMBER_MAX,
} from '../shared/services/numberSequenceRules';

/**
 * The scope every existing rule was written against. Spelled out here so that a
 * test asserting legal-entity behaviour cannot be mistaken for one that simply
 * forgot to pass a scope — which is the shape of the defect this parameter
 * exists to close.
 */
const LEGAL_ENTITY = 'LEGAL_ENTITY';

// ── Format grammar ────────────────────────────────────────────────────────────

describe('inspectSequenceFormat()', () => {
  it('counts the counter token and accepts {YYYY}', () => {
    expect(inspectSequenceFormat('JE-{YYYY}-{#####}')).toEqual({ counters: 1, unknown: [], malformed: null });
    expect(inspectSequenceFormat('{######}')).toEqual({ counters: 1, unknown: [], malformed: null });
  });

  it('reports a format with no counter at all', () => {
    // Not rejected here — a MANUAL series legitimately has no counter. The route
    // decides, because only it knows the row's effective `manual` value.
    expect(inspectSequenceFormat('F-{YYYY}')).toEqual({ counters: 0, unknown: [], malformed: null });
  });

  it('flags {LE}, which has never been implemented', () => {
    // The schema comment claimed it was supported. formatNumber() substitutes
    // {YYYY} and {#+} only, so this would print the literal braces on a factura.
    expect(formatNumber('F-{LE}-{######}', 1, 2026)).toBe('F-{LE}-000001');
    expect(inspectSequenceFormat('F-{LE}-{######}')).toEqual({ counters: 1, unknown: ['{LE}'], malformed: null });
  });

  it('flags every other unknown token', () => {
    expect(inspectSequenceFormat('{BRANCH}-{MM}-{####}').unknown).toEqual(['{BRANCH}', '{MM}']);
  });

  it('counts two counters as two', () => {
    expect(inspectSequenceFormat('{###}-{###}').counters).toBe(2);
  });

  describe('malformed braces', () => {
    // A regex that only matches balanced {...} pairs cannot see any of these, and
    // every one of them would be PRINTED VERBATIM on a legal invoice.
    it('rejects a token that is opened and never closed before the next one', () => {
      const r = inspectSequenceFormat('F-{YYYY-{######}');
      expect(r.malformed).toBeTruthy();
    });
    it('rejects an unterminated counter at the end', () => {
      const r = inspectSequenceFormat('F-{YYYY}-{######');
      expect(r.malformed).toBeTruthy();
      expect(formatNumber('F-{YYYY}-{######', 1, 2026)).toBe('F-2026-{######');
    });
    it('rejects nested braces', () => {
      expect(inspectSequenceFormat('F-{{YYYY}}-{######}').malformed).toBeTruthy();
    });
    it('rejects a stray closing brace', () => {
      expect(inspectSequenceFormat('F-}{######}').malformed).toBeTruthy();
    });
    it('rejects an empty token', () => {
      expect(inspectSequenceFormat('F-{}-{######}').malformed).toBeTruthy();
    });
    it('leaves a well-formed format unflagged', () => {
      expect(inspectSequenceFormat('F-{YYYY}-{######}').malformed).toBeNull();
    });
  });
});

// ── Request validation ────────────────────────────────────────────────────────

const parse = (body: unknown) => UpdateNumberSequenceSchema.safeParse(body);

describe('UpdateNumberSequenceSchema', () => {
  it('accepts a well-formed partial update', () => {
    const r = parse({ manual: true, next_number: 34, format: '{######}' });
    expect(r.success).toBe(true);
  });

  it('accepts an empty body — every field is optional', () => {
    expect(parse({}).success).toBe(true);
  });

  describe('booleans must be real booleans', () => {
    it('REJECTS the string "false", which the old code read as true', () => {
      // This is the defect: `!!"false"` === true, so this payload switched the
      // legal invoice series to manual.
      expect(parse({ manual: 'false' }).success).toBe(false);
    });
    it('rejects 0 and 1', () => {
      expect(parse({ continuous: 1 }).success).toBe(false);
      expect(parse({ is_active: 0 }).success).toBe(false);
    });
  });

  describe('next_number', () => {
    it('rejects a numeric string', () => {
      expect(parse({ next_number: '34' }).success).toBe(false);
    });
    it('rejects zero, negatives and fractions', () => {
      expect(parse({ next_number: 0 }).success).toBe(false);
      expect(parse({ next_number: -1 }).success).toBe(false);
      expect(parse({ next_number: 1.5 }).success).toBe(false);
    });
    it('accepts 1', () => {
      expect(parse({ next_number: 1 }).success).toBe(true);
    });
    it('accepts the highest value the Int column can store', () => {
      expect(NEXT_NUMBER_MAX).toBe(2_147_483_647);
      expect(parse({ next_number: NEXT_NUMBER_MAX }).success).toBe(true);
    });
    it('REJECTS 2147483648, which PostgreSQL integer cannot hold', () => {
      // Without this the request reached Prisma and failed as a database error
      // rather than a stated limit.
      expect(parse({ next_number: 2_147_483_648 }).success).toBe(false);
    });
  });

  describe('name and format are bounded non-empty strings', () => {
    it('rejects an empty or whitespace-only value', () => {
      expect(parse({ name: '' }).success).toBe(false);
      expect(parse({ name: '   ' }).success).toBe(false);
      expect(parse({ format: '   ' }).success).toBe(false);
    });
    it('rejects an over-long value', () => {
      expect(parse({ name: 'x'.repeat(81) }).success).toBe(false);
      expect(parse({ format: 'x'.repeat(61) }).success).toBe(false);
    });
  });

  describe('format tokens', () => {
    it('rejects {LE} rather than storing a format that prints it literally', () => {
      const r = parse({ format: 'F-{LE}-{######}' });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0].message).toContain('{LE}');
    });
    it('rejects any other unknown token', () => {
      expect(parse({ format: '{BRANCH}-{####}' }).success).toBe(false);
    });
    it('rejects the three malformed-brace formats', () => {
      expect(parse({ format: 'F-{YYYY-{######}' }).success).toBe(false);
      expect(parse({ format: 'F-{YYYY}-{######' }).success).toBe(false);
      expect(parse({ format: 'F-{{YYYY}}-{######}' }).success).toBe(false);
    });
    it('rejects more than one counter token', () => {
      expect(parse({ format: '{###}-{###}' }).success).toBe(false);
    });
    it('accepts a counter-less format — a manual series has no counter', () => {
      // Whether this is legal depends on the row's `manual` flag, which the route
      // checks. The schema must not pre-empt it.
      expect(parse({ format: 'F-{YYYY}' }).success).toBe(true);
    });
  });

  describe('reference is immutable', () => {
    it('rejects the field outright rather than silently dropping it', () => {
      // `.strict()`: a client that thinks it renamed the series must be told it
      // did not. Every service looks the sequence up BY reference.
      expect(parse({ reference: 'CREDIT_NOTE' }).success).toBe(false);
    });
    it('rejects any other unknown field', () => {
      expect(parse({ tenant_id: 'x' }).success).toBe(false);
    });
  });

  describe('acknowledge_unverifiable_resume is request-only', () => {
    it('is accepted as a boolean and defaults to FALSE when absent', () => {
      // An absent field must never read as consent.
      const absent = parse({ manual: false });
      expect(absent.success).toBe(true);
      if (absent.success) expect(absent.data.acknowledge_unverifiable_resume).toBe(false);

      const given = parse({ manual: false, acknowledge_unverifiable_resume: true });
      expect(given.success).toBe(true);
      if (given.success) expect(given.data.acknowledge_unverifiable_resume).toBe(true);
    });

    it('rejects a non-boolean, so a truthy string cannot stand in for consent', () => {
      expect(parse({ acknowledge_unverifiable_resume: 'yes' }).success).toBe(false);
    });

    it('is NEVER written to the row', () => {
      const written = persistedSequenceFields({
        manual: false,
        format: '{######}',
        next_number: 101,
        acknowledge_unverifiable_resume: true,
      });
      expect(written).toEqual({ manual: false, format: '{######}', next_number: 101 });
      expect(Object.keys(written)).not.toContain('acknowledge_unverifiable_resume');
    });

    it('writes only the fields the request actually sent', () => {
      expect(persistedSequenceFields({ is_active: false })).toEqual({ is_active: false });
      expect(persistedSequenceFields({})).toEqual({});
    });
  });
});

// ── Highest issued ────────────────────────────────────────────────────────────

describe('highestIssuedNumber()', () => {
  it('orders "99" BELOW "100" — the lexicographic defect', () => {
    // Prisma `_max` on this text column returns '99'. Resuming at 100 would then
    // be allowed, and the next factura would collide with the existing 100.
    const r = highestIssuedNumber(['1', '99', '100']);
    expect(r.value).toBe('100');
    expect(r.numeric).toBe(100);
    expect(r.comparable).toBe(true);
  });

  it('handles the padded Bolivian form, where lexicographic order happens to agree', () => {
    const r = highestIssuedNumber(['000001', '000099', '000100']);
    expect(r.value).toBe('000100');
    expect(r.numeric).toBe(100);
    // Returned as STORED, so the screen shows the number that was printed.
    expect(r.value).toHaveLength(6);
  });

  it('compares padded and unpadded values of the same series correctly', () => {
    expect(highestIssuedNumber(['000100', '99']).value).toBe('000100');
    expect(highestIssuedNumber(['99', '000100']).value).toBe('000100');
  });

  it('REFUSES to answer once a prefixed manual number exists', () => {
    // 'A-04-0001918' is what a Bolivian pre-printed form carries. It cannot be
    // ordered against a counter, and Number() would make it NaN.
    const r = highestIssuedNumber(['000001', 'A-04-0001918', '000002']);
    expect(r.comparable).toBe(false);
    expect(r.value).toBeNull();
    expect(r.numeric).toBeNull();
    expect(r.non_numeric).toContain('A-04-0001918');
  });

  it('does not treat a prefixed value as merely a bigger string', () => {
    // Lexicographically 'F-1' > '000900'. Answering at all here would be a guess.
    expect(highestIssuedNumber(['000900', 'F-1']).value).toBeNull();
  });

  it('reports nothing-issued as a known answer, not an unknown one', () => {
    const r = highestIssuedNumber([]);
    expect(r.value).toBeNull();
    expect(r.comparable).toBe(true);
    expect(r.non_numeric).toEqual([]);
  });

  it('orders exactly beyond the safe-integer range without a numeric claim', () => {
    const huge = '9007199254740993'; // 2^53 + 1
    const r = highestIssuedNumber(['9007199254740992', huge]);
    expect(r.value).toBe(huge);
    // The ordering is exact; the numeric field declines rather than rounding.
    expect(r.numeric).toBeNull();
    expect(r.comparable).toBe(true);
  });

  it('caps the reported examples so one bad tenant cannot flood the response', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    expect(highestIssuedNumber(many).non_numeric).toHaveLength(5);
  });
});

// ── The effective route decision ──────────────────────────────────────────────
//
// These cover the guard the ROUTE applies, not just the maximum finder. The
// defect they pin: the guard read `highest.numeric`, which is null above
// Number.MAX_SAFE_INTEGER, so it silently allowed a resume that collides.

describe('resumeBehindReason()', () => {
  it('REFUSES next_number 1 when 9007199254740993 is already issued', () => {
    // 2^53 + 1. `numeric` is null here, so the old guard skipped entirely and
    // this proposal was accepted.
    const high = highestIssuedNumber(['9007199254740993']);
    expect(high.numeric).toBeNull();

    const reason = resumeBehindReason(high, 1);
    expect(reason).toBeTruthy();
    expect(reason).toContain('9007199254740993');
  });

  it('refuses a proposal equal to the highest issued', () => {
    expect(resumeBehindReason(highestIssuedNumber(['000100']), 100)).toBeTruthy();
  });

  it('allows a proposal above the highest issued', () => {
    expect(resumeBehindReason(highestIssuedNumber(['000100']), 101)).toBeNull();
  });

  it('compares by value, not by string length or padding', () => {
    const high = highestIssuedNumber(['000099']);
    expect(resumeBehindReason(high, 99)).toBeTruthy();
    expect(resumeBehindReason(high, 100)).toBeNull();
  });

  it('says nothing when the history cannot be compared at all', () => {
    // A prefixed manual number: the guard cannot apply, and the refusal to switch
    // to automatic is raised by evaluateAutomaticResume instead.
    expect(resumeBehindReason(highestIssuedNumber(['A-04-0001918']), 1)).toBeNull();
  });

  it('does not suggest a next number the column cannot store', () => {
    const reason = resumeBehindReason(highestIssuedNumber(['2147483647']), 1);
    expect(reason).toBeTruthy();
    expect(reason).not.toContain('2147483648');
  });
});

describe('evaluateAutomaticResume(, LEGAL_ENTITY)', () => {
  it('allows a normal padded Bolivian series and names the next safe number', () => {
    const r = evaluateAutomaticResume(highestIssuedNumber(['000031', '000032', '000033']), LEGAL_ENTITY);
    expect(r.possible).toBe(true);
    expect(r.code).toBe('OK');
    expect(r.minimum_next_number).toBe(34);
  });

  it('allows an empty history, starting at 1', () => {
    const r = evaluateAutomaticResume(highestIssuedNumber([]), LEGAL_ENTITY);
    expect(r.possible).toBe(true);
    expect(r.minimum_next_number).toBe(1);
  });

  it('does not make automatic IMPOSSIBLE after a prefixed manual number — it asks', () => {
    // Pre-printed stock is the expected reason to run manual at all, so refusing
    // forever would trap every tenant that ever used it. Possible, but only with
    // an explicit human decision.
    const r = evaluateAutomaticResume(highestIssuedNumber(['000001', 'A-04-0001918']), LEGAL_ENTITY);
    expect(r.possible).toBe(true);
    expect(r.code).toBe('ACKNOWLEDGEMENT_REQUIRED');
    expect(r.requires_acknowledgement).toBe(true);
    expect(r.reason).toContain('A-04-0001918');
    // Still refuses to invent the resumption point.
    expect(r.minimum_next_number).toBeNull();
  });

  it('REFUSES automatic when the highest issued is exactly the Int ceiling', () => {
    // 2147483647 + 1 cannot be stored, so there is no safe number to resume at.
    const r = evaluateAutomaticResume(highestIssuedNumber(['2147483647']), LEGAL_ENTITY);
    expect(r.possible).toBe(false);
    expect(r.code).toBe('COUNTER_LIMIT_REACHED');
    expect(r.minimum_next_number).toBeNull();
    expect(r.reason).toContain('2147483647');
  });

  it('still allows automatic one below the ceiling', () => {
    const r = evaluateAutomaticResume(highestIssuedNumber(['2147483646']), LEGAL_ENTITY);
    expect(r.possible).toBe(true);
    expect(r.minimum_next_number).toBe(NEXT_NUMBER_MAX);
  });

  it('REFUSES automatic far above the safe-integer range', () => {
    const r = evaluateAutomaticResume(highestIssuedNumber(['9007199254740993']), LEGAL_ENTITY);
    expect(r.possible).toBe(false);
    expect(r.code).toBe('COUNTER_LIMIT_REACHED');
    expect(r.minimum_next_number).toBeNull();
  });

  it('preserves the padded display value exactly as issued', () => {
    const high = highestIssuedNumber(['000033']);
    expect(high.value).toBe('000033');
    expect(evaluateAutomaticResume(high, LEGAL_ENTITY).minimum_next_number).toBe(34);
  });
});

// ── The EFFECTIVE format, including one already stored ────────────────────────
//
// The hole this closes: the route validated only a newly SUPPLIED format, so a
// row saved before that validation existed could be turned automatic by a
// request carrying nothing but {"manual": false}.

describe('effectiveFormatRefusal()', () => {
  it('refuses a legacy stored {LE} format when the sequence becomes automatic', () => {
    const r = effectiveFormatRefusal('F-{LE}-{######}', false);
    expect(r).not.toBeNull();
    expect(r!.code).toBe('NUMBER_SEQUENCE_FORMAT_UNSUPPORTED_TOKEN');
    expect(r!.message).toContain('{LE}');
  });

  it('refuses a legacy stored malformed format, and says it is malformed', () => {
    const r = effectiveFormatRefusal('F-{YYYY-{######}', false);
    expect(r).not.toBeNull();
    // The two failures are named differently, so the administrator is told which
    // one to fix.
    expect(r!.code).toBe('NUMBER_SEQUENCE_FORMAT_MALFORMED');
  });

  it('accepts the valid control case', () => {
    expect(effectiveFormatRefusal('{######}', false)).toBeNull();
    expect(effectiveFormatRefusal('F-{YYYY}-{######}', false)).toBeNull();
  });

  it('refuses an automatic format with no counter', () => {
    const r = effectiveFormatRefusal('F-{YYYY}', false);
    expect(r!.code).toBe('NUMBER_SEQUENCE_FORMAT_INVALID');
  });

  it('allows a manual format with no counter, but still refuses bad braces', () => {
    expect(effectiveFormatRefusal('F-{YYYY}', true)).toBeNull();
    expect(effectiveFormatRefusal('F-{YYYY-{######}', true)).not.toBeNull();
    expect(effectiveFormatRefusal('F-{LE}-{######}', true)).not.toBeNull();
  });
});

// ── The manual → automatic transition contract ────────────────────────────────

const req = (over: Partial<Parameters<typeof checkManualToAutomatic>[1]> = {}) => ({
  wasManual: true,
  targetManual: false,
  formatSupplied: false,
  nextNumberSupplied: false,
  acknowledged: false,
  ...over,
});

describe('checkManualToAutomatic()', () => {
  const prefixed  = highestIssuedNumber(['000001', 'A-04-0001918']);
  const digitOnly = highestIssuedNumber(['000100']);
  const atCeiling = highestIssuedNumber(['2147483647']);

  it('is silent when nothing is transitioning', () => {
    expect(checkManualToAutomatic(prefixed, req({ targetManual: true }), LEGAL_ENTITY)).toBeNull();
    expect(checkManualToAutomatic(prefixed, req({ wasManual: false }), LEGAL_ENTITY)).toBeNull();
  });

  it('allows a digit-only history straight through, with nothing supplied', () => {
    // Nothing to acknowledge: the system can order this history itself, and
    // resumeBehindReason guards the number.
    expect(checkManualToAutomatic(digitOnly, req(), LEGAL_ENTITY)).toBeNull();
  });

  describe('a prefixed manual history', () => {
    it('is REJECTED without the acknowledgement', () => {
      const r = checkManualToAutomatic(prefixed, req({ formatSupplied: true, nextNumberSupplied: true }), LEGAL_ENTITY);
      expect(r!.code).toBe('NUMBER_SEQUENCE_ACKNOWLEDGEMENT_REQUIRED');
    });

    it('is REJECTED when acknowledged but no format is supplied', () => {
      const r = checkManualToAutomatic(prefixed, req({ acknowledged: true, nextNumberSupplied: true }), LEGAL_ENTITY);
      expect(r!.code).toBe('NUMBER_SEQUENCE_EXPLICIT_RESUME_REQUIRED');
    });

    it('is REJECTED when acknowledged but no next number is supplied', () => {
      const r = checkManualToAutomatic(prefixed, req({ acknowledged: true, formatSupplied: true }), LEGAL_ENTITY);
      expect(r!.code).toBe('NUMBER_SEQUENCE_EXPLICIT_RESUME_REQUIRED');
    });

    it('is ACCEPTED when acknowledged with both stated in the same request', () => {
      const r = checkManualToAutomatic(
        prefixed,
        req({ acknowledged: true, formatSupplied: true, nextNumberSupplied: true }),
        LEGAL_ENTITY,
      );
      expect(r).toBeNull();
    });
  });

  it('an acknowledgement CANNOT override the counter ceiling', () => {
    // No decision can produce a storable number above 2147483647, so this is not
    // a matter of authority.
    const r = checkManualToAutomatic(
      atCeiling,
      req({ acknowledged: true, formatSupplied: true, nextNumberSupplied: true }),
      LEGAL_ENTITY,
    );
    expect(r).not.toBeNull();
    expect(r!.code).toBe('NUMBER_SEQUENCE_COUNTER_LIMIT_REACHED');
  });
});

// ── Preparing a manual series, then returning to automatic ────────────────────

describe('preparing a manual sequence for automatic resumption', () => {
  it('accepts format and next_number 101 while manual, then the switch', () => {
    const high = highestIssuedNumber(['000100']);

    // 1. Prepare a valid automatic format while the series is still manual.
    expect(effectiveFormatRefusal('{######}', true)).toBeNull();

    // 2. Set a safe next number. The server's own minimum is what the screen
    //    shows, and 101 is not behind.
    expect(evaluateAutomaticResume(high, LEGAL_ENTITY).minimum_next_number).toBe(101);
    expect(resumeBehindReason(high, 101)).toBeNull();
    expect(resumeBehindReason(high, 100)).toBeTruthy();

    // 3. Switch manual off. A digit-only history needs no acknowledgement.
    expect(checkManualToAutomatic(high, req(), LEGAL_ENTITY)).toBeNull();
    expect(effectiveFormatRefusal('{######}', false)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * FISCAL_YEAR — the bypass, and the contract that replaces it
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * The defect: `PUT /setup/number-sequences/:id` guarded the FACTURA history with
 *
 *     if (row.scope !== 'FISCAL_YEAR' && row.reference === 'FACTURA')
 *
 * so a FISCAL_YEAR factura series passed manual → automatic having been checked
 * by nothing at all — not the acknowledgement, not the counter ceiling, not the
 * resume-behind guard. The tests below are written to FAIL if that silence ever
 * comes back: each one asserts a specific refusal for an input that the old code
 * waved through.
 */
describe('a FISCAL_YEAR factura series', () => {
  const prefixed  = highestIssuedNumber(['000001', 'A-04-0001918']);
  const digitOnly = highestIssuedNumber(['000100']);
  const atCeiling = highestIssuedNumber(['2147483647']);
  const empty     = highestIssuedNumber([]);

  it('is reported as unable to resume automatic numbering, with its own code', () => {
    const r = evaluateAutomaticResume(digitOnly, FISCAL_YEAR_SCOPE);
    expect(r.possible).toBe(false);
    expect(r.code).toBe('FISCAL_YEAR_RESUME_UNSUPPORTED');
    expect(r.requires_acknowledgement).toBe(false);
    expect(r.minimum_next_number).toBeNull();
    // Actionable, not merely a refusal: it says what to do instead.
    expect(r.reason).toContain('manual');
  });

  it('is decided by the SCOPE, whatever the history says', () => {
    // The old bypass was invisible precisely because a clean digit-only history
    // looks fine. Every one of these would have been permitted.
    for (const high of [empty, digitOnly, prefixed, atCeiling]) {
      expect(evaluateAutomaticResume(high, FISCAL_YEAR_SCOPE).code)
        .toBe('FISCAL_YEAR_RESUME_UNSUPPORTED');
    }
  });

  it('REFUSES the manual → automatic transition with a specific error code', () => {
    const r = checkManualToAutomatic(digitOnly, req(), FISCAL_YEAR_SCOPE);
    expect(r).not.toBeNull();
    expect(r!.code).toBe('NUMBER_SEQUENCE_FISCAL_YEAR_RESUME_UNSUPPORTED');
  });

  it('cannot be overridden by the acknowledgement, or by stating both values', () => {
    // The acknowledgement means "a person checked the issued documents and chose
    // a resumption point". Here the system cannot describe the series at all, so
    // there is nothing for that person to be confirming.
    const r = checkManualToAutomatic(
      digitOnly,
      req({ acknowledged: true, formatSupplied: true, nextNumberSupplied: true }),
      FISCAL_YEAR_SCOPE,
    );
    expect(r).not.toBeNull();
    expect(r!.code).toBe('NUMBER_SEQUENCE_FISCAL_YEAR_RESUME_UNSUPPORTED');
  });

  it('does NOT refuse anything other than that transition', () => {
    // Staying manual, and an already-automatic series being edited, are both
    // untouched — the contract is about resumption, not about the scope being
    // unusable.
    expect(checkManualToAutomatic(digitOnly, req({ targetManual: true }), FISCAL_YEAR_SCOPE)).toBeNull();
    expect(checkManualToAutomatic(digitOnly, req({ wasManual: false }), FISCAL_YEAR_SCOPE)).toBeNull();
  });

  it('is refused for EVERY request shape the route can produce', () => {
    // The bypass was an `if` in the route, which no unit test can see. What CAN
    // be proved is that the decision the route now delegates to unconditionally
    // has no permissive branch: every combination of the three fields a client
    // controls, against every history, refuses with the same code. If a future
    // change adds an escape hatch, this matrix fails rather than a single
    // representative case passing by luck.
    const histories = { empty, digitOnly, prefixed, atCeiling };
    const flags = [false, true];

    for (const [label, high] of Object.entries(histories)) {
      for (const formatSupplied of flags) {
        for (const nextNumberSupplied of flags) {
          for (const acknowledged of flags) {
            const r = checkManualToAutomatic(
              high,
              req({ formatSupplied, nextNumberSupplied, acknowledged }),
              FISCAL_YEAR_SCOPE,
            );
            expect({ label, formatSupplied, nextNumberSupplied, acknowledged, code: r?.code })
              .toEqual({
                label, formatSupplied, nextNumberSupplied, acknowledged,
                code: 'NUMBER_SEQUENCE_FISCAL_YEAR_RESUME_UNSUPPORTED',
              });
          }
        }
      }
    }
  });

  it('is the ONLY scope that behaves this way', () => {
    expect(fiscalYearResumeUnsupported(FISCAL_YEAR_SCOPE)).not.toBeNull();
    expect(fiscalYearResumeUnsupported(LEGAL_ENTITY)).toBeNull();
    expect(fiscalYearResumeUnsupported('COMPANY')).toBeNull();
    expect(fiscalYearResumeUnsupported('')).toBeNull();
  });
});

/**
 * The counterweight: LEGAL_ENTITY must be exactly what it was. If the scope
 * parameter had been given a default, or been tested in the wrong direction,
 * these are the assertions that would have caught it.
 */
describe('a LEGAL_ENTITY factura series is unchanged', () => {
  const digitOnly = highestIssuedNumber(['000100']);
  const prefixed  = highestIssuedNumber(['000001', 'A-04-0001918']);
  const atCeiling = highestIssuedNumber(['2147483647']);

  it('still resumes on a digit-only history', () => {
    const r = evaluateAutomaticResume(digitOnly, LEGAL_ENTITY);
    expect(r.possible).toBe(true);
    expect(r.code).toBe('OK');
    expect(r.minimum_next_number).toBe(101);
    expect(checkManualToAutomatic(digitOnly, req(), LEGAL_ENTITY)).toBeNull();
  });

  it('still ASKS on a prefixed history rather than refusing', () => {
    expect(evaluateAutomaticResume(prefixed, LEGAL_ENTITY).code).toBe('ACKNOWLEDGEMENT_REQUIRED');
    expect(
      checkManualToAutomatic(
        prefixed,
        req({ acknowledged: true, formatSupplied: true, nextNumberSupplied: true }),
        LEGAL_ENTITY,
      ),
    ).toBeNull();
  });

  it('still refuses at the counter ceiling, with the ceiling code', () => {
    expect(checkManualToAutomatic(atCeiling, req(), LEGAL_ENTITY)!.code)
      .toBe('NUMBER_SEQUENCE_COUNTER_LIMIT_REACHED');
  });
});
