import { Hono } from 'hono';
import { z } from 'zod';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { validate } from '../../shared/middleware/validate';
import { ok, created } from '../../shared/response';
import { ACCOUNT_CATEGORIES } from '../../shared/services/accountCategory';
import { formatNumber } from '../../shared/services/numberSequence.service';
import {
  highestIssuedNumber,
  evaluateAutomaticResume,
  effectiveFormatRefusal,
  checkManualToAutomatic,
  persistedSequenceFields,
  resumeBehindReason,
  fiscalYearResumeUnsupported,
  FISCAL_YEAR_SCOPE,
} from '../../shared/services/numberSequenceRules';
import { UpdateNumberSequenceSchema } from '../../shared/schemas';
import type { AppEnv } from '../../shared/context';

/**
 * Cross-module setup: the organisation master and the financial dimension
 * framework, plus a readiness summary the Setup hub renders.
 *
 * ── Why this router exists ─────────────────────────────────────────────────
 * Migrations 018–022 built operating units, dimensions, trade agreements and
 * factura lines, and NONE of them had an API or a screen. Configuration that can
 * only be applied by running a script from this repository is not configuration —
 * it makes every new store an errand for whoever wrote the migration, which is
 * exactly what the standing "everything is parametric" rule exists to prevent.
 *
 * ── What lives here and what does not ──────────────────────────────────────
 * The standing rule is module-scoped setup: one module, one Setup area, one
 * Parameters record. So this router deliberately holds only what belongs to NO
 * single module:
 *   · operating units  — the organisation, used by HR, Finance and reporting alike
 *   · financial dimensions — the ledger's axes, used by every posting module
 *   · readiness — a cross-module question by definition
 *
 * Warehouse parameters live under /warehouse, trade agreements under the module
 * that owns the party side (/procurement, /sales/orders), item groups under
 * /products. None of them are duplicated here.
 */
const app = new Hono<AppEnv>();

/* ════════════════════════════════════════════════════════════════════════════
 * OPERATING UNITS — the department master
 * ══════════════════════════════════════════════════════════════════════════ */

const UNIT_TYPES = ['DEPARTMENT', 'COST_CENTER', 'BUSINESS_UNIT', 'VALUE_STREAM', 'RETAIL_CHANNEL'] as const;

app.get('/operating-units', async (c) => {
  const { type } = c.req.query();
  const rows = await db.operatingUnit.findMany({
    where: {
      tenant_id: c.get('tenantId'),
      ...(type ? { unit_type: type } : {}),
    },
    include: {
      parent: { select: { code: true, name: true } },
      manager: { select: { employee_code: true } },
      _count: { select: { staff: true, children: true } },
    },
    orderBy: [{ unit_type: 'asc' }, { code: 'asc' }],
  });
  return ok(c, rows);
});

app.get('/operating-units/types', async (c) =>
  ok(c, UNIT_TYPES.map(t => ({
    value: t,
    // **[OFFICIAL]** the five operating unit types and what each is for.
    label: t.split('_').map(w => w[0] + w.slice(1).toLowerCase()).join(' '),
  }))),
);

app.post('/operating-units', requireRole('admin', 'store_manager'), async (c) => {
  const b = await c.req.json();
  if (!b.code || !b.name) throw new AppError('code and name are required', 400);
  if (!UNIT_TYPES.includes(b.unit_type)) {
    throw new AppError(`unit_type must be one of ${UNIT_TYPES.join(', ')}`, 400);
  }

  const exists = await db.operatingUnit.findFirst({
    where: { tenant_id: c.get('tenantId'), code: b.code },
    select: { id: true, unit_type: true },
  });
  if (exists) {
    // **[OFFICIAL]** the operating unit number "can't be the same as any other
    // operating unit" — across types, not per type.
    throw new AppError(
      `Operating unit code "${b.code}" already exists (as a ${exists.unit_type}). ` +
        `The number is unique across all operating units, not per type.`,
      409,
    );
  }

  const row = await db.operatingUnit.create({
    data: {
      tenant_id: c.get('tenantId'),
      code: b.code,
      name: b.name,
      search_name: b.search_name ?? null,
      memo: b.memo ?? null,
      unit_type: b.unit_type,
      parent_id: b.parent_id ?? null,
      manager_employee_id: b.manager_employee_id ?? null,
    },
  });
  return created(c, row);
});

app.put('/operating-units/:id', requireRole('admin', 'store_manager'), async (c) => {
  const b = await c.req.json();
  const row = await db.operatingUnit.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!row) throw new AppError('Operating unit not found', 404);

  // Its own parent would be a cycle of one; deeper cycles are prevented by walking
  // up the chain, because a hierarchy that loops hangs every report that reads it.
  if (b.parent_id) {
    let cursor: string | null = b.parent_id;
    const seen = new Set<string>([row.id]);
    while (cursor) {
      if (seen.has(cursor)) {
        throw new AppError('That parent would create a loop in the hierarchy.', 400);
      }
      seen.add(cursor);
      const parent: { parent_id: string | null } | null = await db.operatingUnit.findUnique({
        where: { id: cursor },
        select: { parent_id: true },
      });
      cursor = parent?.parent_id ?? null;
    }
  }

  const updated = await db.operatingUnit.update({
    where: { id: row.id },
    data: {
      ...(b.name !== undefined && { name: b.name }),
      ...(b.search_name !== undefined && { search_name: b.search_name }),
      ...(b.memo !== undefined && { memo: b.memo }),
      ...(b.parent_id !== undefined && { parent_id: b.parent_id || null }),
      ...(b.manager_employee_id !== undefined && { manager_employee_id: b.manager_employee_id || null }),
      ...(b.is_active !== undefined && { is_active: !!b.is_active }),
    },
  });
  return ok(c, updated);
});

/* ════════════════════════════════════════════════════════════════════════════
 * FINANCIAL DIMENSIONS
 * ══════════════════════════════════════════════════════════════════════════ */

const VALUE_SOURCES = ['CUSTOM', 'SITE', 'WAREHOUSE', 'OPERATING_UNIT', 'EMPLOYEE', 'PRODUCT_CATEGORY'] as const;

app.get('/dimensions', async (c) => {
  const rows = await db.dimensionAttribute.findMany({
    where: { tenant_id: c.get('tenantId') },
    include: {
      _count: { select: { values: true, rules: true } },
      values: {
        select: { id: true, code: true, name: true, is_active: true, source_id: true },
        orderBy: { code: 'asc' },
      },
      rules: {
        select: { id: true, account_category: true, account_id: true, requirement: true },
      },
    },
    orderBy: { slot: 'asc' },
  });
  return ok(c, rows);
});

app.get('/dimensions/meta', async (c) =>
  ok(c, {
    value_sources: VALUE_SOURCES,
    account_categories: ACCOUNT_CATEGORIES,
    // Four is an allocation, not a ceiling — slot 5 is a nullable ADD COLUMN, which
    // rewrites nothing in PostgreSQL 11+. The UI states the limit rather than
    // letting somebody discover it as a constraint violation.
    max_slots: 4,
  }),
);

app.post('/dimensions', requireRole('admin'), async (c) => {
  const b = await c.req.json();
  if (!b.code || !b.name) throw new AppError('code and name are required', 400);
  if (!VALUE_SOURCES.includes(b.value_source)) {
    throw new AppError(`value_source must be one of ${VALUE_SOURCES.join(', ')}`, 400);
  }
  const slot = Number(b.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > 4) {
    throw new AppError('slot must be 1-4. Slot 5+ needs a migration (one nullable column).', 400);
  }

  const taken = await db.dimensionAttribute.findFirst({
    where: { tenant_id: c.get('tenantId'), legal_entity_id: null, slot },
    select: { code: true },
  });
  if (taken) {
    throw new AppError(
      `Slot ${slot} is already occupied by "${taken.code}". One axis per slot — that is what makes ` +
        `a report grouped on that column mean one thing.`,
      409,
    );
  }

  const row = await db.dimensionAttribute.create({
    data: {
      tenant_id: c.get('tenantId'),
      code: b.code,
      name: b.name,
      slot,
      value_source: b.value_source,
    },
  });
  return created(c, row);
});

app.put('/dimensions/:id', requireRole('admin'), async (c) => {
  const b = await c.req.json();
  const row = await db.dimensionAttribute.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!row) throw new AppError('Dimension not found', 404);

  // The slot and the source are NOT editable. Moving an axis between slots would
  // silently re-interpret every voucher already coded against it, and changing the
  // source would orphan the values already posted. Deactivate and create a new one.
  if ((b.slot !== undefined && Number(b.slot) !== row.slot) ||
      (b.value_source !== undefined && b.value_source !== row.value_source)) {
    throw new AppError(
      `A dimension's slot and value source cannot be changed after it exists: every journal line ` +
        `already coded against it would silently mean something else. Deactivate this one and create a new axis.`,
      409,
      'DIMENSION_IMMUTABLE',
    );
  }

  const updated = await db.dimensionAttribute.update({
    where: { id: row.id },
    data: {
      ...(b.name !== undefined && { name: b.name }),
      ...(b.is_active !== undefined && { is_active: !!b.is_active }),
    },
  });
  return ok(c, updated);
});

/** Values for a CUSTOM axis. Entity-backed axes create theirs on first use. */
app.post('/dimensions/:id/values', requireRole('admin'), async (c) => {
  const attr = await db.dimensionAttribute.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!attr) throw new AppError('Dimension not found', 404);

  if (attr.value_source !== 'CUSTOM') {
    // **[OFFICIAL]** entity-backed values "are not available in the financial
    // dimension framework until the value is used", and renaming is done on the
    // source entity. Hand-adding one would create a value the source does not know.
    throw new AppError(
      `${attr.code} takes its values from ${attr.value_source}. Those appear automatically the first ` +
        `time they are used on a posting, and are renamed on the source record — not here.`,
      400,
      'DIMENSION_ENTITY_BACKED',
    );
  }

  const b = await c.req.json();
  if (!b.code || !b.name) throw new AppError('code and name are required', 400);

  const row = await db.dimensionValue.create({
    data: {
      tenant_id: c.get('tenantId'),
      attribute_id: attr.id,
      code: b.code,
      name: b.name,
    },
  });
  return created(c, row);
});

/**
 * Requirement rules — "revenue must carry a store".
 *
 * Keyed on `Account.category` rather than an account code, so the rule survives a
 * change of chart of accounts and a change of country.
 */
app.put('/dimensions/:id/rules', requireRole('admin'), async (c) => {
  const attr = await db.dimensionAttribute.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!attr) throw new AppError('Dimension not found', 404);

  const { account_category, requirement } = await c.req.json();
  if (!ACCOUNT_CATEGORIES.includes(account_category)) {
    throw new AppError('account_category is not a known category', 400);
  }
  if (!['OPTIONAL', 'REQUIRED'].includes(requirement)) {
    throw new AppError('requirement must be OPTIONAL or REQUIRED', 400);
  }

  const existing = await db.dimensionRule.findFirst({
    where: {
      tenant_id: c.get('tenantId'),
      legal_entity_id: null,
      attribute_id: attr.id,
      account_category,
    },
  });

  const row = existing
    ? await db.dimensionRule.update({ where: { id: existing.id }, data: { requirement } })
    : await db.dimensionRule.create({
        data: {
          tenant_id: c.get('tenantId'),
          attribute_id: attr.id,
          account_category,
          requirement,
        },
      });

  return ok(c, row);
});

/**
 * What making this REQUIRED would cost, BEFORE it is made required.
 *
 * This exists because that exact question came up and could only be answered by
 * writing a one-off script: turning the store dimension on refuses any posting that
 * cannot resolve it, and 14 existing orders could not. Nobody should have to
 * discover that by breaking invoicing.
 */
app.get('/dimensions/:id/impact', async (c) => {
  const attr = await db.dimensionAttribute.findFirst({
    where: { id: c.req.param('id'), tenant_id: c.get('tenantId') },
  });
  if (!attr) throw new AppError('Dimension not found', 404);

  if (attr.value_source !== 'SITE') {
    return ok(c, { supported: false, reason: `Impact analysis is implemented for SITE-backed axes only.` });
  }

  const blocked = await db.salesOrder.findMany({
    where: {
      tenant_id: c.get('tenantId'),
      site_id: null,
      status: { in: ['DRAFT', 'CONFIRMED', 'SHIPPED'] },
    },
    select: { id: true, order_number: true, status: true, total_amount: true, warehouse_id: true },
    orderBy: { order_number: 'asc' },
  });

  return ok(c, {
    supported: true,
    blocked_count: blocked.length,
    blocked_orders: blocked,
    note:
      blocked.length === 0
        ? 'Nothing is blocked. Every open order can resolve this dimension.'
        : `${blocked.length} open order(s) have no site and no warehouse to derive one from. ` +
          `Making this REQUIRED means they cannot be invoiced until a warehouse is set on them.`,
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * NUMBER SEQUENCES — document numbering
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Cross-module by definition — sales, purchase, finance, CRM and the warehouse
 * all draw numbers from the same framework — which is why it belongs in this
 * router and not in any one module's Setup area. D365 files it the same way,
 * under Organization administration → Number sequences.
 *
 * Until now `number_sequences` rows could only be created by running
 * provisionConfiguration.ts from this repository, and `manual` / `continuous`
 * could not be changed at all. Migration 023 gave the factura series to this
 * framework, so leaving it unreachable from the UI would mean the legal invoice
 * series is configured by editing code.
 */

/** The counter and the rendered result, so the screen can show both. */
function describeSequence(s: {
  format: string; next_number: number; current_year: number | null; scope: string;
}) {
  const year = s.scope === 'FISCAL_YEAR' ? (s.current_year ?? new Date().getFullYear()) : new Date().getFullYear();
  return formatNumber(s.format, s.next_number, year);
}

/**
 * The highest FACTURA actually issued for this tenant.
 *
 * `_max` on a text column is lexicographic, so it is NOT used — see
 * `highestIssuedNumber`. The numbers are read and compared as digit strings
 * instead, which is exact and refuses to answer at all once a manual, prefixed
 * number is present.
 */
async function facturaHighestIssued(tenantId: string) {
  const rows = await db.factura.findMany({
    where:  { tenant_id: tenantId },
    select: { factura_number: true },
  });
  return highestIssuedNumber(rows.map((r) => r.factura_number));
}

app.get('/number-sequences', async (c) => {
  const tenantId = c.get('tenantId');
  const rows = await db.numberSequence.findMany({
    where: { tenant_id: tenantId },
    orderBy: [{ reference: 'asc' }],
  });

  // What has actually been issued, so an administrator switching a series back
  // from manual to automatic can see the number to resume above instead of
  // guessing. Only FACTURA is reported: it is the one series where a collision is
  // a legal problem rather than an inconvenience, and a generic
  // reference → table → column registry covering all fifteen would be a lookup
  // table to keep in sync for a question nobody has asked about the other
  // fourteen. Add one when someone needs it.
  const facturaHigh = await facturaHighestIssued(tenantId);

  return ok(c, rows.map((s) => {
    const isFactura = s.reference === 'FACTURA';

    // Evaluated PER ROW, because the answer depends on that row's scope. A
    // fiscal-year factura series is refused on the scope alone; see
    // `fiscalYearResumeUnsupported`.
    const resume = isFactura ? evaluateAutomaticResume(facturaHigh, s.scope) : null;

    // `facturaHigh` is every factura the tenant ever issued, across every year.
    // That is the right history for a LEGAL_ENTITY series and the WRONG one for a
    // FISCAL_YEAR series, whose counter restarts annually — so it is withheld
    // there rather than shown as though it were the number to resume above.
    // Reported as "nothing known" rather than "not comparable": the values are
    // perfectly comparable, it is the QUESTION that does not apply, and the
    // not-comparable message would tell the administrator something untrue about
    // why.
    const reportHistory = isFactura && s.scope !== FISCAL_YEAR_SCOPE;

    return {
      ...s,
      preview: describeSequence(s),
      // Null means "not known", and `highest_issued_comparable` says WHICH kind
      // of not-known it is: nothing issued yet, or issued numbers that cannot be
      // ordered against a counter. The screen must not print a guess either way.
      highest_issued:            reportHistory ? facturaHigh.value : null,
      highest_issued_numeric:    reportHistory ? facturaHigh.numeric : null,
      highest_issued_comparable: reportHistory ? facturaHigh.comparable : true,
      highest_issued_examples:   reportHistory ? facturaHigh.non_numeric : [],
      // Whether this series COULD be switched to automatic at all, with the
      // reason, so the Setup screen can explain a refusal before the
      // administrator flips the switch instead of after.
      automatic_resume_possible: resume ? resume.possible : true,
      automatic_resume_code:     resume ? resume.code : 'OK',
      automatic_resume_reason:   resume ? resume.reason : null,
      // ACKNOWLEDGEMENT_REQUIRED is possible-but-not-guessable, so the screen
      // offers a confirmation rather than a dead end. FISCAL_YEAR_RESUME_UNSUPPORTED
      // is a dead end on purpose, and reports no acknowledgement at all.
      automatic_resume_requires_acknowledgement:
        resume ? resume.requires_acknowledgement : false,
      // Never a value the Int column cannot store.
      minimum_next_number:       resume ? resume.minimum_next_number : null,
    };
  }));
});

app.put('/number-sequences/:id', requireRole('admin'), validate(UpdateNumberSequenceSchema), async (c) => {
  const b = c.get('body') as z.infer<typeof UpdateNumberSequenceSchema>;
  const tenantId = c.get('tenantId');

  const row = await db.numberSequence.findFirst({
    where: { id: c.req.param('id'), tenant_id: tenantId },
  });
  if (!row) throw new AppError('Number sequence not found', 404);

  // `reference` is the key every service looks the sequence up by, so it is not
  // in the schema at all. Renaming it would orphan the series, not rename it.
  //
  // Everything below is already the right TYPE — the schema rejects
  // `{"manual":"false"}` rather than coercing the truthy string to `true`, which
  // is what the previous `!!b.manual` did to the legal invoice series.
  const nextNumber = b.next_number ?? row.next_number;
  const manual     = b.manual     ?? row.manual;
  const format     = b.format     ?? row.format;

  // The EFFECTIVE format, not merely a newly supplied one. A row saved before
  // this validation existed can hold `F-{LE}-{######}`, and a request carrying
  // only `{"manual": false}` would otherwise make it automatic with no format
  // ever inspected — every document it issued would print the braces.
  const formatRefusal = effectiveFormatRefusal(format, manual);
  if (formatRefusal) throw new AppError(formatRefusal.message, 400, formatRefusal.code);

  // ── FACTURA: the legal series ───────────────────────────────────────────────
  //
  // This block used to be guarded by `row.scope !== 'FISCAL_YEAR'`, which was an
  // UNDOCUMENTED BYPASS: a fiscal-year factura series skipped every check below
  // and went manual → automatic unexamined. The scope is now a refusal with its
  // own code, not a reason to fall silent.
  if (row.reference === 'FACTURA') {
    // Decided on the scope alone, and BEFORE the history is read — reading it
    // would answer a different question, and an unusable answer must not be near
    // a decision. Not overridable by `acknowledge_unverifiable_resume`, which is
    // enforced inside `checkManualToAutomatic` rather than here, so there is one
    // place that can say yes.
    const scopeUnsupported = fiscalYearResumeUnsupported(row.scope);

    // `checkManualToAutomatic` needs a history argument even when the scope has
    // already settled the answer. It is not read in that case — the scope
    // refusal is returned first — so the read is skipped rather than performed
    // for a value nothing may use.
    const high = scopeUnsupported
      ? { value: null, numeric: null, comparable: true, non_numeric: [] as string[] }
      : await facturaHighestIssued(tenantId);

    // The manual → automatic contract. Refuses outright on an unsupported scope
    // and at the counter ceiling, and otherwise demands an explicit,
    // acknowledged resumption point when the issued history cannot be ordered.
    // Only evaluated for the request that actually flips the switch, so an
    // already-automatic series is untouched.
    const transition = checkManualToAutomatic(high, {
      wasManual:          row.manual,
      targetManual:       manual,
      formatSupplied:     b.format !== undefined,
      nextNumberSupplied: b.next_number !== undefined,
      acknowledged:       b.acknowledge_unverifiable_resume === true,
    }, row.scope);
    if (transition) throw new AppError(transition.message, 400, transition.code);

    // Guard the one mistake that is not recoverable by editing the row again: on
    // an automatic series, resuming BELOW what has already been issued hands out
    // a number the unique constraint will reject — the next sale fails, at the
    // till. Skipped while the series stays manual, where the user picks each
    // number, and silent on a non-comparable history, which the contract above
    // has already dealt with.
    //
    // Exact digit-string comparison, so a highest issued value above
    // Number.MAX_SAFE_INTEGER is still caught. Reading `high.numeric` here — as
    // this once did — silently skipped the guard in precisely that case.
    //
    // Not run on a FISCAL_YEAR series, and that is a STATED limitation rather
    // than the old silent skip: the comparison it would make is against a
    // tenant-wide maximum spanning every year, which is not the number that
    // series resumes from. The transition above is already refused there, so the
    // only way to reach this line on that scope is a series that was configured
    // automatic and stays automatic; its counter is protected by the factura
    // unique constraint alone until a year-aware history model exists. Recorded
    // as a residual risk, not papered over.
    if (!manual && row.scope !== FISCAL_YEAR_SCOPE) {
      const behind = resumeBehindReason(high, nextNumber);
      if (behind) throw new AppError(behind, 400, 'NUMBER_SEQUENCE_BEHIND');
    }
  }

  // One place decides what is written, and it excludes the request-only
  // acknowledgement by construction rather than by remembering to omit it.
  const updated = await db.numberSequence.update({
    where: { id: row.id },
    data: persistedSequenceFields(b),
  });

  return ok(c, { ...updated, preview: describeSequence(updated) });
});

/* ════════════════════════════════════════════════════════════════════════════
 * READINESS — what the Setup hub shows
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * One question per module: is this configured enough to trade?
 *
 * Deliberately reports FACTS with counts, not a score. "3 of 8 products have no
 * item group" is actionable; "Products 62% configured" is not.
 */
app.get('/readiness', async (c) => {
  const tenantId = c.get('tenantId');

  const [
    sites, warehouses, whWithParams, locations, pickLocations, directives,
    accounts, categorised, profiles, sequences, financeParams,
    taxCodes, taxGroups,
    products, productsWithItemGroup, itemGroups, itemModelGroups,
    dimensions, operatingUnits, employees, employeesWithDept,
    salesParams, purchaseParams, tradeAgreements,
  ] = await Promise.all([
    db.site.count({ where: { tenant_id: tenantId } }),
    db.warehouse.count({ where: { tenant_id: tenantId } }),
    db.warehouseParameters.count({ where: { tenant_id: tenantId } }),
    db.warehouseLocation.count({ where: { tenant_id: tenantId } }),
    db.warehouseLocation.count({ where: { tenant_id: tenantId, is_pick_location: true } }),
    db.locationDirective.count({ where: { tenant_id: tenantId } }),
    db.account.count({ where: { tenant_id: tenantId } }),
    db.account.count({ where: { tenant_id: tenantId, category: { not: null } } }),
    db.postingProfile.count({ where: { tenant_id: tenantId } }),
    db.numberSequence.count({ where: { tenant_id: tenantId } }),
    db.financeParameters.findFirst({ where: { tenant_id: tenantId, legal_entity_id: null } }),
    db.taxCode.count({ where: { tenant_id: tenantId } }),
    db.taxGroup.count({ where: { tenant_id: tenantId } }),
    db.product.count({ where: { tenant_id: tenantId } }),
    db.product.count({ where: { tenant_id: tenantId, item_group_id: { not: null } } }),
    db.itemGroup.count({ where: { tenant_id: tenantId } }),
    db.itemModelGroup.count({ where: { tenant_id: tenantId } }),
    db.dimensionAttribute.count({ where: { tenant_id: tenantId } }),
    db.operatingUnit.count({ where: { tenant_id: tenantId } }),
    db.employee.count({ where: { tenant_id: tenantId } }),
    db.employee.count({ where: { tenant_id: tenantId, department_id: { not: null } } }),
    db.salesParameters.findFirst({ where: { tenant_id: tenantId, legal_entity_id: null } }),
    db.purchaseParameters.findFirst({ where: { tenant_id: tenantId, legal_entity_id: null } }),
    db.tradeAgreement.count({ where: { tenant_id: tenantId } }),
  ]);

  const modules = [
    {
      key: 'organisation',
      label: 'Organisation',
      href: '/setup/organisation',
      // A site and a warehouse are the minimum: `Warehouse.site_id` is NOT NULL and
      // every demand document derives its site from its warehouse.
      blocking: sites === 0 || warehouses === 0,
      facts: [
        { label: 'Sites', value: sites, want: '≥ 1' },
        { label: 'Warehouses', value: warehouses, want: '≥ 1' },
        { label: 'Operating units (departments)', value: operatingUnits, want: 'optional' },
        { label: 'Employees with a department', value: `${employeesWithDept}/${employees}`, want: 'optional' },
      ],
    },
    {
      key: 'finance',
      label: 'Finance',
      href: '/setup/finance',
      // Posting profiles are what stop the ledger being wrong; without them
      // `require_balanced_posting` refuses every document.
      blocking: accounts === 0 || profiles === 0 || sequences === 0,
      facts: [
        { label: 'Accounts', value: accounts, want: '≥ 1' },
        { label: 'Accounts with a category', value: `${categorised}/${accounts}`, want: 'all' },
        { label: 'Posting profiles', value: profiles, want: '≥ 7' },
        { label: 'Number sequences', value: sequences, want: '≥ 1' },
        { label: 'Strict posting', value: financeParams?.require_balanced_posting ? 'on' : 'off', want: 'on' },
        { label: 'Financial dimensions', value: dimensions, want: 'optional' },
      ],
    },
    {
      key: 'tax',
      label: 'Tax',
      href: '/setup/finance#tax',
      blocking: taxCodes === 0 || taxGroups === 0,
      facts: [
        { label: 'Tax codes', value: taxCodes, want: '≥ 1' },
        { label: 'Tax groups', value: taxGroups, want: '≥ 1' },
      ],
    },
    {
      key: 'products',
      label: 'Products',
      href: '/products/setup',
      blocking: itemGroups === 0 || itemModelGroups === 0,
      facts: [
        { label: 'Item groups', value: itemGroups, want: '≥ 1' },
        { label: 'Item model groups', value: itemModelGroups, want: '≥ 1' },
        { label: 'Products with an item group', value: `${productsWithItemGroup}/${products}`, want: 'all' },
      ],
    },
    {
      key: 'warehouse',
      label: 'Warehouse',
      href: '/setup/warehouse',
      // Not blocking: a warehouse with no directive still trades, it simply cannot
      // do directed putaway. Blocking would be wrong — most shops never need it.
      blocking: false,
      facts: [
        { label: 'Locations', value: locations, want: '≥ 1' },
        { label: 'Pick locations', value: pickLocations, want: '≥ 1 to use putaway' },
        { label: 'Warehouses with parameters', value: `${whWithParams}/${warehouses}`, want: 'all' },
        { label: 'Location directives', value: directives, want: '≥ 1 per putaway warehouse' },
      ],
    },
    {
      key: 'sales',
      label: 'Sales',
      href: '/setup/sales',
      blocking: !salesParams,
      facts: [
        { label: 'Parameters record', value: salesParams ? 'yes' : 'MISSING', want: 'yes' },
        { label: 'Default warehouse', value: salesParams?.default_warehouse_id ? 'set' : 'not set', want: 'set' },
        { label: 'Warehouse required on orders', value: salesParams?.require_warehouse_on_sales_order ? 'on' : 'off', want: 'on' },
      ],
    },
    {
      key: 'procurement',
      label: 'Procurement',
      href: '/setup/procurement',
      blocking: !purchaseParams,
      facts: [
        { label: 'Parameters record', value: purchaseParams ? 'yes' : 'MISSING', want: 'yes' },
        { label: 'Trade agreements', value: tradeAgreements, want: 'optional' },
      ],
    },
  ];

  return ok(c, {
    ready: modules.every(m => !m.blocking),
    modules,
  });
});

export default app;
