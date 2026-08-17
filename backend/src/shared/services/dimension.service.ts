import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { logger } from '../logger';
import { AppError } from '../errors/AppError';

/**
 * Financial dimension resolution — the one place a journal line gets coded.
 *
 * Design and the Learn grounding: docs/architecture/FINANCIAL_DIMENSIONS.md.
 * Migration 018 created the tables; this file is what makes them mean something.
 *
 * ── Why there is exactly one of these ──────────────────────────────────────
 * `postJournal()` is the single journal writer (commit def8122). Dimension
 * defaulting is therefore applied in ONE function. That was the whole precondition
 * for this work: with the sixteen hand-built line arrays that preceded it, a missed
 * call site would still post, still balance, and simply be uncoded — indistinguishable
 * in every report from a genuine data gap.
 *
 * ── The rule that is not negotiable ────────────────────────────────────────
 * **Never invent a value.** **[OFFICIAL]** Microsoft concedes the framework
 * "can't determine whether a blank dimension value was intentionally left blank, or
 * whether the default entry wasn't made", and its own workaround is a dimension
 * value literally named `Blank`. We do not take that. NULL means *not coded*, and
 * every report shows an explicit "(unassigned)" bucket with its amount.
 * https://learn.microsoft.com/dynamics365/finance/general-ledger/dimensions-default-values
 */

/** 1..4 — which `journal_lines.dimension_N_id` column an axis occupies. */
export type DimensionSlot = 1 | 2 | 3 | 4;

export type DimensionValueSource =
  | 'CUSTOM'
  | 'SITE'
  | 'WAREHOUSE'
  | 'OPERATING_UNIT'
  | 'EMPLOYEE'
  | 'PRODUCT_CATEGORY';

/**
 * What the posting caller knows about the transaction. Every field is optional:
 * a context that resolves nothing produces four NULLs, which is a legitimate
 * answer and not an error unless a rule says otherwise.
 */
export interface DimensionContext {
  /** Highest precedence — attribute CODE → dimension value ID. Used by corrections
   *  and adjustments, which know exactly what they are re-coding. */
  explicit?: Record<string, string>;

  // Entity-backed sources, taken from the source document.
  siteId?: string | null;
  warehouseId?: string | null;
  /** The organisational department — an `OperatingUnit`. */
  operatingUnitId?: string | null;
  employeeId?: string | null;
  productCategoryId?: string | null;

  // Master-data defaulting sources (step 3).
  customerId?: string | null;
  supplierId?: string | null;
  productId?: string | null;
}

export interface ResolvedSlots {
  dimension_1_id: string | null;
  dimension_2_id: string | null;
  dimension_3_id: string | null;
  dimension_4_id: string | null;
}

export const EMPTY_SLOTS: ResolvedSlots = {
  dimension_1_id: null,
  dimension_2_id: null,
  dimension_3_id: null,
  dimension_4_id: null,
};

type Client = Prisma.TransactionClient | typeof db;

interface AttributeRow {
  id: string;
  code: string;
  name: string;
  slot: number;
  value_source: string;
}

const slotKey = (slot: number) =>
  `dimension_${slot}_id` as keyof ResolvedSlots;

/**
 * The tenant's active axes. Returns [] for a tenant that has never been
 * provisioned, which is what keeps this whole feature inert until somebody
 * switches it on.
 */
export async function activeAttributes(
  tenantId: string,
  legalEntityId: string | null,
  client: Client = db,
): Promise<AttributeRow[]> {
  return client.dimensionAttribute.findMany({
    where: { tenant_id: tenantId, legal_entity_id: legalEntityId, is_active: true },
    select: { id: true, code: true, name: true, slot: true, value_source: true },
    orderBy: { slot: 'asc' },
  });
}

/** Which context field backs which source, and where its code and name come from. */
async function readBackingEntity(
  tenantId: string,
  source: string,
  ctx: DimensionContext,
  client: Client,
): Promise<{ sourceId: string; code: string; name: string } | null> {
  switch (source) {
    case 'SITE': {
      if (!ctx.siteId) return null;
      const r = await client.site.findFirst({
        where: { id: ctx.siteId, tenant_id: tenantId },
        select: { id: true, code: true, name: true },
      });
      return r ? { sourceId: r.id, code: r.code, name: r.name } : null;
    }
    case 'WAREHOUSE': {
      if (!ctx.warehouseId) return null;
      const r = await client.warehouse.findFirst({
        where: { id: ctx.warehouseId, tenant_id: tenantId },
        select: { id: true, code: true, name: true },
      });
      return r ? { sourceId: r.id, code: r.code, name: r.name } : null;
    }
    case 'OPERATING_UNIT': {
      if (!ctx.operatingUnitId) return null;
      const r = await client.operatingUnit.findFirst({
        where: { id: ctx.operatingUnitId, tenant_id: tenantId, is_active: true },
        select: { id: true, code: true, name: true },
      });
      return r ? { sourceId: r.id, code: r.code, name: r.name } : null;
    }
    case 'EMPLOYEE': {
      if (!ctx.employeeId) return null;
      const r = await client.employee.findFirst({
        where: { id: ctx.employeeId, tenant_id: tenantId },
        select: { id: true, employee_code: true },
      });
      return r ? { sourceId: r.id, code: r.employee_code, name: r.employee_code } : null;
    }
    case 'PRODUCT_CATEGORY': {
      if (!ctx.productCategoryId) return null;
      const r = await client.productCategory.findFirst({
        where: { id: ctx.productCategoryId, tenant_id: tenantId },
        select: { id: true, code: true, name: true },
      });
      return r ? { sourceId: r.id, code: r.code, name: r.name } : null;
    }
    default:
      // CUSTOM has no backing entity — its values are hand-maintained and can only
      // arrive through `explicit` or a master-data default.
      return null;
  }
}

/**
 * Find, or create on first use, the dimension value for a backing row.
 *
 * **[OFFICIAL]** entity-backed values "are not available in the financial dimension
 * framework until the value is used in a transaction, a posting definition, or a
 * journal" — the value list is deliberately NOT a mirror of the backing table.
 * https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-dimensions#financial-dimension-types
 *
 * The name is refreshed from the source on every use, because **[OFFICIAL]** renaming
 * an entity-backed value is done on the source entity and never on the value list.
 */
async function ensureEntityValue(
  tenantId: string,
  attribute: AttributeRow,
  entity: { sourceId: string; code: string; name: string },
  client: Client,
): Promise<string> {
  const existing = await client.dimensionValue.findFirst({
    where: { tenant_id: tenantId, attribute_id: attribute.id, source_id: entity.sourceId },
    select: { id: true, name: true, is_active: true },
  });

  if (existing) {
    if (existing.name !== entity.name) {
      await client.dimensionValue.update({
        where: { id: existing.id },
        data: { name: entity.name },
      });
    }
    return existing.id;
  }

  // Truncated rather than rejected: **[OFFICIAL]** the 30-character limit is real,
  // but refusing to post a sale because a warehouse has a long code would be the
  // dimension framework breaking trading, which is never the right trade.
  const code = entity.code.slice(0, 30).replace(/\s+/g, '_');

  try {
    const created = await client.dimensionValue.create({
      data: {
        tenant_id: tenantId,
        attribute_id: attribute.id,
        code,
        name: entity.name,
        source_id: entity.sourceId,
      },
      select: { id: true },
    });
    return created.id;
  } catch (e: any) {
    // Two concurrent postings can race to first-use the same value. The unique
    // index is the arbiter; re-read rather than fail the document.
    if (e?.code === 'P2002') {
      const raced = await client.dimensionValue.findFirst({
        where: { tenant_id: tenantId, attribute_id: attribute.id, source_id: entity.sourceId },
        select: { id: true },
      });
      if (raced) return raced.id;
    }
    throw e;
  }
}

/**
 * Master-data defaults — step 3 of the precedence chain.
 *
 * **[OFFICIAL]** D365 fills remaining blanks from the customer / vendor / bank /
 * fixed asset / project / ledger defaults, and "an already-defaulted value is not
 * overridden". We have four entity types; the order below is fixed and stated so
 * that a line carrying both a customer and a product is deterministic.
 */
const MASTER_ORDER: Array<{ type: string; key: keyof DimensionContext }> = [
  { type: 'CUSTOMER', key: 'customerId' },
  { type: 'SUPPLIER', key: 'supplierId' },
  { type: 'EMPLOYEE', key: 'employeeId' },
  { type: 'PRODUCT', key: 'productId' },
];

/**
 * Resolve every configured axis for one transaction.
 *
 * Precedence, most specific first (FINANCIAL_DIMENSIONS.md §6.3):
 *   1. explicit — the caller named the value
 *   2. document — the entity-backed source on the document itself
 *   3. master data — a default assigned to the customer / supplier / employee / product
 *   4. nothing → NULL
 */
export async function resolveDimensions(
  tenantId: string,
  legalEntityId: string | null,
  ctx: DimensionContext,
  client: Client = db,
): Promise<ResolvedSlots> {
  const attributes = await activeAttributes(tenantId, legalEntityId, client);
  if (attributes.length === 0) return { ...EMPTY_SLOTS };

  const slots: ResolvedSlots = { ...EMPTY_SLOTS };

  for (const attr of attributes) {
    // ── 1. Explicit ────────────────────────────────────────────────────────
    const explicit = ctx.explicit?.[attr.code];
    if (explicit) {
      slots[slotKey(attr.slot)] = explicit;
      continue;
    }

    // ── 2. Document (entity-backed) ────────────────────────────────────────
    const entity = await readBackingEntity(tenantId, attr.value_source, ctx, client);
    if (entity) {
      slots[slotKey(attr.slot)] = await ensureEntityValue(tenantId, attr, entity, client);
      continue;
    }

    // ── 3. Master-data default ─────────────────────────────────────────────
    let defaulted: string | null = null;
    for (const { type, key } of MASTER_ORDER) {
      const entityId = ctx[key] as string | null | undefined;
      if (!entityId) continue;

      const assignment = await client.defaultDimensionAssignment.findFirst({
        where: {
          tenant_id: tenantId,
          entity_type: type,
          entity_id: entityId,
          attribute_id: attr.id,
        },
        select: { value_id: true },
      });
      if (assignment) {
        defaulted = assignment.value_id;
        break;
      }
    }

    // ── 4. NULL. Not an error here — `assertRequiredDimensions` decides that.
    slots[slotKey(attr.slot)] = defaulted;
  }

  return slots;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Document → context
 *
 * The posting call sites do NOT assemble a context by hand. Fifteen call sites
 * each picking their own fields is the same shape as the sixteen hand-built line
 * arrays that `postJournal` replaced, and it fails the same way: one site that
 * forgets `site_id` posts an uncoded voucher that still balances.
 *
 * These helpers cost one small query per voucher and make "how a sales order is
 * coded" a single fact.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A sales order — the POS sale, the invoice, the payment, the return and the COGS
 * relief all code from the same order.
 *
 * `site_id` is the derived copy of `warehouse.site_id` written by migration 011's
 * resolver. It is read here rather than re-derived, deliberately: FINANCIAL_
 * DIMENSIONS §6.3 says reuse that resolver, do not write a second one.
 */
export async function contextForSalesOrder(
  tenantId: string,
  orderId: string,
  client: Client = db,
): Promise<DimensionContext> {
  const order = await client.salesOrder.findFirst({
    where: { id: orderId, tenant_id: tenantId },
    select: { site_id: true, warehouse_id: true, customer_id: true },
  });
  if (!order) return {};
  return {
    siteId: order.site_id,
    warehouseId: order.warehouse_id,
    customerId: order.customer_id,
  };
}

/** A purchase order — receipt, vendor invoice and AP payment all code from it. */
export async function contextForPurchaseOrder(
  tenantId: string,
  purchaseOrderId: string,
  client: Client = db,
): Promise<DimensionContext> {
  const po = await client.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenant_id: tenantId },
    select: { site_id: true, warehouse_id: true, supplier_id: true },
  });
  if (!po) return {};
  return {
    siteId: po.site_id,
    warehouseId: po.warehouse_id,
    supplierId: po.supplier_id,
  };
}

/**
 * An employee — payroll.
 *
 * This is the one place the DEPARTMENT axis has a natural source today, which is
 * why the department master had to exist before the axis could mean anything.
 * The store comes from `assigned_site_id`.
 */
export async function contextForEmployee(
  tenantId: string,
  employeeId: string,
  client: Client = db,
): Promise<DimensionContext> {
  const e = await client.employee.findFirst({
    where: { id: employeeId, tenant_id: tenantId },
    select: { id: true, assigned_site_id: true, department_id: true },
  });
  if (!e) return {};
  return {
    siteId: e.assigned_site_id,
    operatingUnitId: e.department_id,
    employeeId: e.id,
  };
}

/**
 * Enforce the requirement rules on the lines about to be written.
 *
 * The rule is keyed on `Account.category` — the country-independent classification
 * from migration 003 — with an optional per-account override. FINANCIAL_DIMENSIONS
 * §5 cut D365's account-structure tree and kept this, its degenerate case, so
 * "revenue and COGS must carry a store" survives a change of chart of accounts and
 * a change of country.
 *
 * Behaviour follows `require_balanced_posting` exactly, as posting.service.ts does:
 * throw when strict, log at ERROR and continue when not. No third behaviour, and
 * never silence.
 *
 * **NOT IMPLEMENTED, and stated rather than left to be discovered:**
 * `DimensionRule.fixed_value_id` — **[OFFICIAL]** D365's *fixed dimension*, where
 * the value on the main account replaces whatever is on the line at posting time.
 * The column exists as the documented hook. Nothing reads it.
 */
export async function assertRequiredDimensions(
  tenantId: string,
  legalEntityId: string | null,
  document: string,
  lines: Array<{ accountId: string } & ResolvedSlots>,
  client: Client = db,
): Promise<void> {
  const attributes = await activeAttributes(tenantId, legalEntityId, client);
  if (attributes.length === 0) return;

  const rules = await client.dimensionRule.findMany({
    where: {
      tenant_id: tenantId,
      legal_entity_id: legalEntityId,
      requirement: 'REQUIRED',
    },
    select: { attribute_id: true, account_category: true, account_id: true },
  });
  if (rules.length === 0) return;

  const accountIds = [...new Set(lines.map(l => l.accountId))];
  const accounts = await client.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, code: true, name: true, category: true },
  });
  const byId = new Map(accounts.map(a => [a.id, a]));

  const failures: string[] = [];

  for (const line of lines) {
    const account = byId.get(line.accountId);
    if (!account) continue;

    for (const attr of attributes) {
      // Most specific first: a rule naming this exact account beats a rule naming
      // its category. Same shape as the posting-profile resolver.
      const specific = rules.find(r => r.attribute_id === attr.id && r.account_id === account.id);
      const byCategory = rules.find(
        r => r.attribute_id === attr.id && r.account_category && r.account_category === account.category,
      );
      if (!specific && !byCategory) continue;

      if (line[slotKey(attr.slot)] == null) {
        failures.push(
          `${account.code} ${account.name} requires the ${attr.code} dimension (${attr.name}), which did not resolve`,
        );
      }
    }
  }

  if (failures.length === 0) return;

  const params = await client.financeParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
    select: { require_balanced_posting: true },
  });
  // An unprovisioned tenant defaults to strict, for the same reason as everywhere
  // else in this codebase: the tenant nobody configured is the one whose silent
  // posting caused the original damage.
  const strict = params?.require_balanced_posting ?? true;

  const detail = [...new Set(failures)].join('; ');

  if (strict) {
    logger.error({ tenantId, document, detail }, 'Posting blocked: required financial dimension unresolved');
    throw new AppError(
      `${document} cannot be posted: ${detail}.`,
      500,
      'DIMENSION_REQUIRED_UNRESOLVED',
    );
  }

  logger.error(
    { tenantId, document, detail },
    'Voucher posted with a REQUIRED financial dimension missing — require_balanced_posting is false',
  );
}
