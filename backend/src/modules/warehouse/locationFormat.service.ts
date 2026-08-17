import { AppError } from '../../shared/errors/AppError';

/**
 * Location naming and bulk generation — our reading of D365's "location format"
 * plus its "Location setup wizard", reduced to what an SME actually needs.
 *
 * ## What Microsoft has, and what we deliberately did not copy
 *
 * **[OFFICIAL]** D365 splits this across five master tables — zone groups,
 * zones, location types, location formats and location profiles — before a
 * single bin exists:
 *
 *   "Location formats are a naming system for creating unique and consistent
 *    names for the different location bin positions […] The total of all
 *    components in the name, including the separators, can't exceed 10
 *    characters."
 *   learn.microsoft.com/dynamics365/supply-chain/warehousing/tasks/configure-locations-wms-enabled-warehouse
 *
 * We keep **zones and locations** (both already in the schema) and the **naming
 * rule**, and we do NOT create separate master tables for formats, profiles,
 * types or zone groups. A three-store shoe retailer configuring five master
 * tables before it can name a shelf is exactly the enterprise weight this
 * product exists to avoid.
 *
 * **The scope cut is a behaviour cut, not a schema cut.** `WarehouseLocation`
 * already carries `aisle` / `rack` / `shelf` / `bin` as separate columns plus
 * `location_type`, `is_pick_location`, `is_receive_location`, `max_weight` and
 * `max_volume` — which is the data a location profile would hold. When profiles
 * are genuinely needed they become a table those columns point at, not a
 * migration of existing location data.
 *
 * ## Why the 10-character rule is kept even though nothing here requires it
 *
 * It is not arbitrary: it is what keeps a location name scannable on a label
 * and typable on a handheld. Our POS/handheld story is not written yet, and a
 * naming convention is far cheaper to enforce now than to retrofit across a
 * warehouse full of printed labels.
 */

/** One segment of a location name, in order. */
export interface Segment {
  /** What this part means — "Aisle", "Rack", "Shelf", "Bin". */
  label: string;
  /** Inclusive numeric range. */
  from: number;
  to: number;
  /** Zero-padded width, e.g. 2 → "01". */
  width: number;
  /** Character placed AFTER this segment. Empty for the last one. */
  separator: string;
}

export const MAX_LOCATION_NAME = 10;

/**
 * The generated names, or an explanation of why they cannot be generated.
 *
 * Returns a preview rather than writing, because a range that looks small is
 * often not: four segments of 1–10 is ten thousand locations, and finding that
 * out by creating them is expensive to undo.
 */
export interface GenerationPlan {
  codes: string[];
  total: number;
  sample: string[];
  nameLength: number;
}

export function planLocations(segments: Segment[], cap = 2000): GenerationPlan {
  if (!segments.length) throw new AppError('At least one segment is required', 422);

  for (const s of segments) {
    if (!s.label?.trim()) throw new AppError('Every segment needs a label', 422);
    if (!Number.isInteger(s.from) || !Number.isInteger(s.to)) {
      throw new AppError(`Segment "${s.label}": from and to must be whole numbers`, 422);
    }
    if (s.from > s.to) {
      throw new AppError(`Segment "${s.label}": from (${s.from}) is greater than to (${s.to})`, 422);
    }
    if (s.from < 0) throw new AppError(`Segment "${s.label}": from cannot be negative`, 422);
    if (s.width < 1 || s.width > 4) {
      throw new AppError(`Segment "${s.label}": width must be between 1 and 4`, 422);
    }
    if (String(s.to).length > s.width) {
      throw new AppError(
        `Segment "${s.label}": ${s.to} does not fit in ${s.width} character(s). ` +
          `Widen the segment or lower the range.`,
        422,
      );
    }
    if (s.separator.length > 1) {
      throw new AppError(`Segment "${s.label}": separator must be a single character`, 422);
    }
  }

  // **[OFFICIAL]** the 10-character ceiling, separators included.
  const nameLength = segments.reduce((n, s) => n + s.width + s.separator.length, 0);
  if (nameLength > MAX_LOCATION_NAME) {
    throw new AppError(
      `This format produces ${nameLength}-character names, over the ${MAX_LOCATION_NAME}-character ceiling ` +
        `(D365 location format rule — a name longer than this stops being scannable on a label). ` +
        `Shorten a segment width or drop a separator.`,
      422,
    );
  }

  const total = segments.reduce((n, s) => n * (s.to - s.from + 1), 1);
  if (total > cap) {
    throw new AppError(
      `That range would create ${total.toLocaleString()} locations, over the ${cap.toLocaleString()} limit for one run. ` +
        `Narrow the range — an accidental extra digit is the usual cause.`,
      422,
    );
  }

  // Cartesian product, left segment varying slowest, so the list reads in
  // walking order rather than jumping aisles.
  let codes: string[] = [''];
  for (const s of segments) {
    const next: string[] = [];
    for (const prefix of codes) {
      for (let i = s.from; i <= s.to; i++) {
        next.push(prefix + String(i).padStart(s.width, '0') + s.separator);
      }
    }
    codes = next;
  }
  // A trailing separator on the last segment is a formatting slip, not a name.
  codes = codes.map((c) => c.replace(/[^A-Za-z0-9]+$/, ''));

  return { codes, total, sample: codes.slice(0, 5), nameLength };
}

/** Split a generated code back into the columns the schema keeps separately. */
export function segmentsOf(code: string, segments: Segment[]): Record<string, string> {
  const out: Record<string, string> = {};
  let cursor = 0;
  for (const s of segments) {
    out[s.label.toLowerCase()] = code.slice(cursor, cursor + s.width);
    cursor += s.width + s.separator.length;
  }
  return out;
}
