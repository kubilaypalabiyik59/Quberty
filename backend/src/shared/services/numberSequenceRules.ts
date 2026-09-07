/**
 * Number-sequence rules — pure, no Prisma, no HTTP, no environment.
 *
 * Everything here decides something about a LEGAL document number, so all of it
 * has to be testable on its own. The route reads a row, calls these, and turns a
 * decision into an AppError; it contributes no rules of its own.
 */

/**
 * The counter column is `Int` in Prisma, which is PostgreSQL `integer` — signed
 * 32-bit. A `next_number` above this cannot be stored at all, so it is a schema
 * limit rather than a policy, and it is defined once here rather than repeated
 * as a literal in the request schema, the route and the UI.
 */
export const NEXT_NUMBER_MIN = 1;
export const NEXT_NUMBER_MAX = 2_147_483_647;

/* ══════════════════════════════════════════════════════════════════════════
 * Digit-string comparison
 * ════════════════════════════════════════════════════════════════════════ */

function withoutLeadingZeros(digits: string): string {
  const trimmed = digits.replace(/^0+/, '');
  return trimmed === '' ? '0' : trimmed;
}

/**
 * True when digit-only `a` is strictly greater than digit-only `b`, at any
 * magnitude. Length first, then lexical — exact where `Number()` starts rounding
 * above 2^53, which is the whole reason this exists rather than a subtraction.
 */
export function digitsExceed(a: string, b: string): boolean {
  const left  = withoutLeadingZeros(a);
  const right = withoutLeadingZeros(b);
  if (left.length !== right.length) return left.length > right.length;
  return left > right;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Format grammar
 * ════════════════════════════════════════════════════════════════════════ */

const COUNTER_TOKEN = /^#+$/;
const YEAR_TOKEN    = 'YYYY';

export interface FormatTokenReport {
  counters:  number;
  unknown:   string[];
  /** Set when the braces themselves are wrong; `counters`/`unknown` are then unreliable. */
  malformed: string | null;
}

/**
 * Parse a sequence format character by character rather than with a regex over
 * balanced `{...}` groups.
 *
 * A regex that only matches balanced pairs cannot see the cases that matter:
 * `F-{YYYY-{######}` (a token opened and never closed, the next `{` swallowed),
 * `F-{YYYY}-{######` (an unterminated counter), and `F-{{YYYY}}-{######}`
 * (nested braces). Each of those would pass an unknown-token check and then be
 * printed VERBATIM onto a legal invoice, because `formatNumber` substitutes only
 * what it recognises and leaves everything else alone.
 *
 * The grammar accepted here is: literal text, zero or more `{YYYY}`, and counter
 * tokens `{#+}`. How MANY counters are allowed is the caller's decision — a
 * manual series legitimately has none — so this only counts them.
 */
export function inspectSequenceFormat(format: string): FormatTokenReport {
  const report: FormatTokenReport = { counters: 0, unknown: [], malformed: null };

  let i = 0;
  while (i < format.length) {
    const ch = format[i];

    if (ch === '}') {
      report.malformed = `Unmatched '}' at position ${i + 1}.`;
      return report;
    }
    if (ch !== '{') { i += 1; continue; }

    const close = format.indexOf('}', i + 1);
    if (close === -1) {
      report.malformed = `A '{' at position ${i + 1} is never closed.`;
      return report;
    }

    const token = format.slice(i + 1, close);
    if (token.includes('{')) {
      report.malformed = `Nested '{' inside the token at position ${i + 1}.`;
      return report;
    }
    if (token.length === 0) {
      report.malformed = `Empty token '{}' at position ${i + 1}.`;
      return report;
    }

    if (COUNTER_TOKEN.test(token)) report.counters += 1;
    else if (token !== YEAR_TOKEN) report.unknown.push(`{${token}}`);

    i = close + 1;
  }

  return report;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Highest issued
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * The highest document number actually issued, for a series whose numbers are
 * TEXT since migration 023.
 *
 * `_max` on a string column — Prisma's and SQL's — is LEXICOGRAPHIC, so `'99'`
 * beats `'100'`. That is wrong in the one direction that matters: it lets an
 * automatic series resume beneath a number already issued, and the next sale
 * then fails on the unique constraint, at the till.
 *
 * Padded Bolivian numbers (`000099` / `000100`) happen to sort correctly, which
 * is why the defect could sit unnoticed on the anchor tenant.
 *
 * A manual series carries whatever the tax authority printed — `A-04-0001918`.
 * That is not comparable to a counter at all, so when ANY issued value is not
 * digits-only the answer is explicitly **not comparable** and `value` is null.
 */
export interface HighestIssued {
  /** The issued number exactly as stored, padding included. Null when unknown. */
  value: string | null;
  /** Its counter value, only when that is representable as a safe integer. */
  numeric: number | null;
  /** False when at least one issued number is not digits-only. */
  comparable: boolean;
  /** Up to five of the values that blocked comparison, for the message. */
  non_numeric: string[];
}

export function highestIssuedNumber(issued: readonly string[]): HighestIssued {
  const nonNumeric = issued.filter((n) => !/^\d+$/.test(n));

  if (nonNumeric.length > 0) {
    return { value: null, numeric: null, comparable: false, non_numeric: nonNumeric.slice(0, 5) };
  }
  if (issued.length === 0) {
    // Nothing issued is a knowable answer, not an unknown one.
    return { value: null, numeric: null, comparable: true, non_numeric: [] };
  }

  let best = issued[0];
  for (const candidate of issued) {
    if (digitsExceed(candidate, best)) best = candidate;
  }

  const asNumber = Number(withoutLeadingZeros(best));
  return {
    value:       best,
    numeric:     Number.isSafeInteger(asNumber) ? asNumber : null,
    comparable:  true,
    non_numeric: [],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * The effective automatic-numbering decisions
 * ════════════════════════════════════════════════════════════════════════ */

export type AutomaticResumeCode =
  | 'OK'
  | 'ACKNOWLEDGEMENT_REQUIRED'
  | 'COUNTER_LIMIT_REACHED'
  | 'FISCAL_YEAR_RESUME_UNSUPPORTED';

/**
 * The one scope value these rules branch on, named once rather than spelled as a
 * literal in the rules, the routes and the tests. It matches what
 * `allocateNumber` tests to decide whether the counter resets on a new year.
 */
export const FISCAL_YEAR_SCOPE = 'FISCAL_YEAR';

export interface AutomaticResume {
  /**
   * Can this series become automatic at all? TRUE for ACKNOWLEDGEMENT_REQUIRED —
   * it is possible, it just needs a person to take responsibility first.
   */
  possible: boolean;
  code: AutomaticResumeCode;
  /** True when the transition needs `acknowledge_unverifiable_resume`. */
  requires_acknowledgement: boolean;
  /** Why it is not a plain yes. Null when it is. */
  reason: string | null;
  /**
   * The lowest `next_number` that would not collide. Null when it cannot be
   * derived — NEVER a value the `Int` column cannot hold.
   */
  minimum_next_number: number | null;
}

/**
 * A FACTURA series scoped to the fiscal year cannot be returned to automatic
 * numbering, and the refusal is on the SCOPE ALONE — no invoice history is read,
 * because none of the history this system can read answers the question.
 *
 * `allocateNumber` resets a FISCAL_YEAR counter to 1 on the first allocation of a
 * new year, so "what number does the counter resume from" is a question about
 * the invoices issued IN THIS YEAR, for THIS legal entity. The only history
 * available is every factura the tenant ever issued, stored as text, across
 * every year — a different question with a different answer. Deriving the right
 * one means either inventing fiscal-calendar semantics or parsing the counter
 * back out of a rendered format, and both are guesses that end up printed on a
 * legal document.
 *
 * So this fails CLOSED, and stays closed until a year- and legal-entity-aware
 * invoice history model exists. It is deliberately NOT overridable by
 * `acknowledge_unverifiable_resume`: that acknowledgement means a person looked
 * at the issued documents and chose a resumption point for a series this system
 * can at least describe. Here it cannot describe the series at all, so there is
 * nothing for an administrator to be confirming.
 *
 * ── The bypass this replaces ────────────────────────────────────────────────
 * The setup route guarded FACTURA history only when `scope !== 'FISCAL_YEAR'`,
 * with no comment and no test. A FISCAL_YEAR factura series therefore passed
 * manual → automatic with no check of ANY kind — not the acknowledgement, not
 * the counter ceiling, not the resume-behind guard. Silence is the part that was
 * wrong; refusing is defensible, skipping quietly is not.
 */
export function fiscalYearResumeUnsupported(scope: string): AutomaticResume | null {
  if (scope !== FISCAL_YEAR_SCOPE) return null;
  return {
    possible: false,
    code: 'FISCAL_YEAR_RESUME_UNSUPPORTED',
    requires_acknowledgement: false,
    reason:
      `This series resets its counter every fiscal year, and the system cannot establish which ` +
      `invoices belong to the current one — the issued numbers are stored as text and carry no ` +
      `year that can be compared against a counter. Resuming automatic numbering would restart ` +
      `the counter at a number that may already have been issued, and the next sale would be ` +
      `refused at the till. Leave this series on manual entry. Automatic numbering on a ` +
      `fiscal-year factura series needs a year-aware invoice history that does not exist yet; ` +
      `a series scoped to the legal entity does not have this limitation.`,
    minimum_next_number: null,
  };
}

/**
 * The lowest `next_number` that would not reissue something already issued.
 *
 * Null when it cannot be derived at all: a non-comparable history has no order,
 * and a history at or above the counter ceiling has no storable successor. Both
 * of those are refusals elsewhere; this function only answers the arithmetic, so
 * that `evaluateAutomaticResume` and `resumeBehindReason` cannot drift apart on
 * what the safe number is.
 */
function minimumResumeFrom(highest: HighestIssued): number | null {
  if (!highest.comparable) return null;
  // Nothing issued: an automatic series simply starts wherever it is set.
  if (highest.value === null) return NEXT_NUMBER_MIN;
  // `highest >= NEXT_NUMBER_MAX` expressed without Number(), so it holds for a
  // value far above the safe-integer range.
  if (!digitsExceed(String(NEXT_NUMBER_MAX), highest.value)) return null;
  // Below the ceiling, so it fits in an int32 and Number() is exact here.
  return Number(withoutLeadingZeros(highest.value)) + 1;
}

/**
 * Whether an automatic series can resume above what has been issued.
 *
 * `scope` is REQUIRED rather than defaulted. A default would reintroduce exactly
 * the defect this parameter exists to close: a caller that forgot the scope
 * would silently get the legal-entity answer for a fiscal-year series.
 *
 * Four answers, deliberately distinct:
 *
 *  FISCAL_YEAR_RESUME_UNSUPPORTED — decided on the scope alone, before the
 *    history is even consulted. See `fiscalYearResumeUnsupported`.
 *
 *  OK — a digit-only history below the counter ceiling. `minimum_next_number`
 *    is the first safe value.
 *
 *  ACKNOWLEDGEMENT_REQUIRED — a manually typed, non-numeric number is already
 *    issued (`A-04-0001918`), so nothing can be ordered against a counter. This
 *    is NOT permanently impossible: pre-printed stock is the expected reason to
 *    run manual in the first place, so refusing forever would trap every tenant
 *    that ever used it. The system will not GUESS the resumption point, but an
 *    administrator who has looked at the issued documents may state it — see
 *    `checkManualToAutomatic`.
 *
 *  COUNTER_LIMIT_REACHED — the highest issued number is at or above the `Int`
 *    ceiling. No acknowledgement can override this: there is no storable value
 *    to resume at, so it needs a schema migration, not a decision.
 */
export function evaluateAutomaticResume(
  highest: HighestIssued,
  scope: string,
): AutomaticResume {
  // Scope FIRST. On a fiscal-year series the history below is not merely
  // unknown, it answers a different question — so it must not be consulted at
  // all, let alone allowed to produce a permissive answer.
  const scopeRefusal = fiscalYearResumeUnsupported(scope);
  if (scopeRefusal) return scopeRefusal;

  if (!highest.comparable) {
    const example = highest.non_numeric[0];
    return {
      possible: true,
      code: 'ACKNOWLEDGEMENT_REQUIRED',
      requires_acknowledgement: true,
      reason:
        `This tenant has issued manually typed invoice numbers` +
        (example ? ` such as '${example}'` : '') +
        `, which cannot be ordered against a counter. Returning to automatic numbering is ` +
        `possible, but the format and the next number must be stated explicitly and confirmed ` +
        `by someone who has checked the issued documents.`,
      minimum_next_number: null,
    };
  }

  const minimum = minimumResumeFrom(highest);

  if (highest.value === null) {
    return {
      possible: true, code: 'OK', requires_acknowledgement: false,
      reason: null, minimum_next_number: minimum,
    };
  }

  if (minimum === null) {
    return {
      possible: false,
      code: 'COUNTER_LIMIT_REACHED',
      requires_acknowledgement: false,
      reason:
        `Invoice ${highest.value} has already been issued, which is at or beyond the highest ` +
        `counter this system can store (${NEXT_NUMBER_MAX}). Automatic numbering cannot resume ` +
        `above it without widening the counter column, so the series must stay manual.`,
      minimum_next_number: null,
    };
  }

  return {
    possible: true, code: 'OK', requires_acknowledgement: false,
    reason: null, minimum_next_number: minimum,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * The effective format, and the manual → automatic transition
 * ════════════════════════════════════════════════════════════════════════ */

export interface RuleRefusal {
  code: string;
  message: string;
}

/**
 * Whether a sequence may be SAVED with this format.
 *
 * The format checked here is the EFFECTIVE one — the request's value if it sent
 * a format, otherwise the value already stored. That distinction is the whole
 * point: a row saved before this validation existed can hold `F-{LE}-{######}`,
 * and a request carrying only `{"manual": false}` would otherwise turn it
 * automatic without any format ever being inspected. Every document it then
 * issued would print `F-{LE}-000001`.
 *
 * Malformed braces and unsupported tokens are refused in both modes, because
 * both are printed verbatim onto a legal document. The counter requirement
 * applies only to automatic mode: a manual series has no counter to render.
 */
export function effectiveFormatRefusal(format: string, manual: boolean): RuleRefusal | null {
  const { counters, unknown, malformed } = inspectSequenceFormat(format);

  if (malformed) {
    return {
      code: 'NUMBER_SEQUENCE_FORMAT_MALFORMED',
      message:
        `The format currently stored for this sequence is malformed: ${malformed} ` +
        `'${format}' would be printed onto documents exactly as written. Send a corrected ` +
        `format with this change.`,
    };
  }
  if (unknown.length > 0) {
    return {
      code: 'NUMBER_SEQUENCE_FORMAT_UNSUPPORTED_TOKEN',
      message:
        `The format '${format}' contains unsupported token${unknown.length > 1 ? 's' : ''} ` +
        `${unknown.join(', ')}. Only {YYYY} and a counter such as {######} are substituted; ` +
        `anything else is printed literally on the document. Send a corrected format with this ` +
        `change.`,
    };
  }
  if (!manual && counters !== 1) {
    return {
      code: 'NUMBER_SEQUENCE_FORMAT_INVALID',
      message:
        `An automatic sequence needs exactly one counter token, such as {######}. '${format}' ` +
        `has ${counters === 0 ? 'none' : `${counters}`}, so ` +
        `${counters === 0 ? 'every document would be issued with the same number' : 'the number would be ambiguous'}.`,
    };
  }
  return null;
}

/** Everything the update request may carry, including request-only fields. */
export interface SequenceUpdateInput {
  name?:        string;
  format?:      string;
  manual?:      boolean;
  continuous?:  boolean;
  is_active?:   boolean;
  next_number?: number;
  /** Request-only. Must never reach the row. */
  acknowledge_unverifiable_resume?: boolean;
}

/**
 * The subset of an update that is actually written to `number_sequences`.
 *
 * One place decides this, so "the acknowledgement is not persisted" is a fact
 * that can be tested rather than a property of how carefully somebody spelled
 * out an object literal in a route. `acknowledge_unverifiable_resume` is a
 * statement about one request — that a person checked the issued documents — not
 * a property of the sequence, and there is no column for it.
 */
export function persistedSequenceFields(b: SequenceUpdateInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (b.name        !== undefined) data.name        = b.name;
  if (b.format      !== undefined) data.format      = b.format;
  if (b.continuous  !== undefined) data.continuous  = b.continuous;
  if (b.manual      !== undefined) data.manual      = b.manual;
  if (b.is_active   !== undefined) data.is_active   = b.is_active;
  if (b.next_number !== undefined) data.next_number = b.next_number;
  return data;
}

/** What the request asked for, reduced to the facts this decision needs. */
export interface ManualToAutomaticRequest {
  wasManual:          boolean;
  targetManual:       boolean;
  formatSupplied:     boolean;
  nextNumberSupplied: boolean;
  acknowledged:       boolean;
}

/**
 * The manual → automatic transition contract.
 *
 * Returns null when the transition may proceed. The three refusals it can
 * produce are all about the same question — what number does the counter resume
 * from — answered differently depending on what is knowable:
 *
 *  · digit-only history      the system knows; `resumeBehindReason` guards it
 *  · non-comparable history  the system cannot know, so a PERSON must state it,
 *                            explicitly, in the same request that flips the
 *                            switch — format and next number together with an
 *                            acknowledgement that they checked the documents
 *  · counter at the ceiling  nobody can state it, because no storable value
 *                            exists. Not overridable by acknowledgement.
 *  · fiscal-year scope       the question itself is not answerable from the
 *                            history this system stores. Also not overridable —
 *                            see `fiscalYearResumeUnsupported`.
 *
 * `scope` is the ROW's scope, not anything the request may carry: the update
 * schema has no `scope` field, and a client must not be able to argue its way
 * into a different set of rules.
 */
export function checkManualToAutomatic(
  highest: HighestIssued,
  req: ManualToAutomaticRequest,
  scope: string,
): RuleRefusal | null {
  const becomingAutomatic = req.wasManual && !req.targetManual;
  if (!becomingAutomatic) return null;

  const resume = evaluateAutomaticResume(highest, scope);

  // Checked FIRST and separately, BEFORE the acknowledgement is even read: an
  // acknowledgement cannot conjure a number the column cannot store, nor a
  // history the system cannot read.
  if (!resume.possible) {
    return {
      code: `NUMBER_SEQUENCE_${resume.code}`,
      message: `This sequence cannot be switched to automatic numbering. ${resume.reason}`,
    };
  }

  if (!resume.requires_acknowledgement) return null;

  if (!req.acknowledged) {
    return {
      code: 'NUMBER_SEQUENCE_ACKNOWLEDGEMENT_REQUIRED',
      message:
        `${resume.reason} Send acknowledge_unverifiable_resume together with the format and the ` +
        `next number to confirm that the issued documents have been checked and that the chosen ` +
        `series is deliberate.`,
    };
  }
  if (!req.formatSupplied || !req.nextNumberSupplied) {
    return {
      code: 'NUMBER_SEQUENCE_EXPLICIT_RESUME_REQUIRED',
      message:
        `Returning this sequence to automatic numbering requires the format AND the next number ` +
        `to be stated in the same request. Inheriting either from the stored row would mean the ` +
        `system chose part of a legal series that it has already said it cannot verify.`,
    };
  }
  return null;
}

/**
 * Whether a proposed `next_number` would hand out a number already issued.
 *
 * The comparison is on digit strings, so it does NOT silently pass when the
 * highest issued value is above `Number.MAX_SAFE_INTEGER` — which is exactly
 * what happened while this guard read `highest.numeric`, because that field is
 * null there.
 *
 * Returns null when the proposal is safe.
 */
export function resumeBehindReason(highest: HighestIssued, proposed: number): string | null {
  if (!highest.comparable || highest.value === null) return null;

  if (digitsExceed(String(proposed), highest.value)) return null;

  // The arithmetic only — deliberately NOT `evaluateAutomaticResume`, which
  // would need a scope this guard has no business branching on. Whether the
  // series may become automatic at all is `checkManualToAutomatic`'s question;
  // this one is only "does this number collide", and it is the same answer for
  // every scope.
  const minimum = minimumResumeFrom(highest);
  const advice = minimum !== null
    ? `Resume at ${minimum} or higher.`
    : `The counter cannot be set above ${highest.value} — see the automatic-numbering warning on ` +
      `this sequence.`;

  return (
    `Invoice ${highest.value} has already been issued, so the series cannot resume at ${proposed} — ` +
    `the next invoice would be rejected as a duplicate. ${advice}`
  );
}
