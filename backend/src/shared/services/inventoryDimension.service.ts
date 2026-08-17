import { db } from '../../infrastructure/database/client';
import { AppError } from '../errors/AppError';
import { logger } from '../logger';

/**
 * Resolving the storage dimensions of a demand document.
 *
 * ## The rule this file exists to enforce
 *
 * **Site is never captured. Site is the warehouse's site.**
 *
 * `warehouses.site_id` is NOT NULL, so every warehouse belongs to exactly one
 * site and an order's site is a derivation, not an input. The copy on the
 * document is a denormalisation for query convenience — the operations panel
 * groups by geography constantly and should not join through warehouses every
 * time — but a denormalised copy that anything else may write is a copy that
 * will eventually disagree with its source. So it is written here and nowhere
 * else.
 *
 * ## Why the warehouse is a parameter and the site is not
 *
 * **[OFFICIAL]** Microsoft draws exactly this line:
 *
 *   "The site dimension is mandatory, and you can set the warehouse dimension
 *    to be mandatory. When a dimension is mandatory, a dimension value must be
 *    entered on all inventory transactions."
 *   learn.microsoft.com/dynamics365/supply-chain/master-planning/master-plan-multisite-functionality
 *
 *   "the demand order carries the mandatory dimensions of site, warehouse, and
 *    inventory status […] the demand order is expected to indicate where the
 *    order must be shipped from (that is, what site and warehouse)."
 *   learn.microsoft.com/dynamics365/supply-chain/warehousing/flexible-warehouse-level-dimension-reservation
 *
 * That second sentence is not abstract here. Until this service existed, 41 of
 * 51 sales orders could not say where they shipped from, and the return path
 * consequently restored stock to whichever row `findFirst` reached first.
 *
 * ## What this is NOT
 *
 * It is not a location directive. Choosing the *bin* inside a warehouse is the
 * warehouse module's job and already exists. This decides only the dimensions
 * above location, which is the boundary Microsoft's reservation hierarchy draws.
 */

/** Where a resolved warehouse came from. Logged, so a surprise is traceable. */
export type DimensionOrigin =
  | 'explicit'        // the caller passed one
  | 'register'        // the POS register session it was sold from
  | 'parameter'       // SalesParameters.default_warehouse_id
  | 'sole-warehouse'  // the tenant has exactly one, so there is no choice
  | 'none';           // nothing resolved, and the tenant permits that

export interface ResolvedDimensions {
  warehouse_id: string | null;
  /** Always `warehouse.site_id`, or null when there is no warehouse. */
  site_id: string | null;
  origin: DimensionOrigin;
}

export interface DimensionContext {
  /** A warehouse named on the request. Wins over everything else. */
  warehouseId?: string | null;
  /** POS: the open register session, which carries its own warehouse. */
  registerSessionId?: string | null;
  /** For log lines that a human has to interpret later. */
  documentKind?: string;
}

type Client = typeof db | Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Resolve `{ warehouse_id, site_id }` for a demand document.
 *
 * Precedence is deliberate and runs most-specific first, the same shape as
 * `postingProfile.service.ts`:
 *
 *   explicit → register session → tenant parameter → sole warehouse → none
 *
 * The sole-warehouse step is last rather than first on purpose: it is correct
 * only by accident of the tenant's size, and a tenant that later opens a second
 * warehouse must not silently change behaviour. Once a second one exists, the
 * step stops firing and the parameter is consulted instead — which is why the
 * parameter is worth setting even for a single-warehouse tenant.
 *
 * Throws when the tenant has `require_warehouse_on_sales_order` and nothing
 * resolved. It never guesses.
 */
export async function resolveInventoryDimensions(
  tenantId: string,
  ctx: DimensionContext = {},
  client: Client = db,
): Promise<ResolvedDimensions> {
  const params = await client.salesParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: null },
    select: { default_warehouse_id: true, require_warehouse_on_sales_order: true },
  });

  const candidates: { id: string; origin: DimensionOrigin }[] = [];

  if (ctx.warehouseId) {
    candidates.push({ id: ctx.warehouseId, origin: 'explicit' });
  }

  if (!candidates.length && ctx.registerSessionId) {
    const session = await client.registerSession.findFirst({
      where: { id: ctx.registerSessionId, tenant_id: tenantId },
      select: { warehouse_id: true },
    });
    if (session?.warehouse_id) {
      candidates.push({ id: session.warehouse_id, origin: 'register' });
    }
  }

  if (!candidates.length && params?.default_warehouse_id) {
    candidates.push({ id: params.default_warehouse_id, origin: 'parameter' });
  }

  if (!candidates.length) {
    // `take: 2` rather than `findFirst`: the point is to learn whether the
    // choice is genuinely unambiguous, and findFirst cannot tell "the only one"
    // from "the first of several".
    const all = await client.warehouse.findMany({
      where: { tenant_id: tenantId, is_active: true },
      select: { id: true },
      take: 2,
    });
    if (all.length === 1) {
      candidates.push({ id: all[0].id, origin: 'sole-warehouse' });
    }
  }

  const picked = candidates[0];

  if (!picked) {
    if (params?.require_warehouse_on_sales_order) {
      throw new AppError(
        'This document needs a warehouse and none could be resolved. ' +
          'Pass warehouse_id, open the register against a warehouse, or set ' +
          'Sales parameters → default warehouse. ' +
          'Without it the document cannot say where it ships from, so stock ' +
          'movements and returns have nothing to aim at.',
        422,
      );
    }
    logger.warn(
      { tenantId, documentKind: ctx.documentKind ?? 'demand document' },
      'No warehouse resolved; document will carry no site and will not appear in any geographic report',
    );
    return { warehouse_id: null, site_id: null, origin: 'none' };
  }

  const warehouse = await client.warehouse.findFirst({
    where: { id: picked.id, tenant_id: tenantId },
    select: { id: true, site_id: true },
  });

  // A warehouse from another tenant, or one that has been deleted. Never fall
  // back silently — a cross-tenant dimension is worse than a missing one.
  if (!warehouse) {
    throw new AppError(
      `Warehouse ${picked.id} does not exist for this tenant (resolved via: ${picked.origin}).`,
      422,
    );
  }

  return { warehouse_id: warehouse.id, site_id: warehouse.site_id, origin: picked.origin };
}

/**
 * The site for a warehouse already chosen elsewhere.
 *
 * For paths that copy a warehouse from an upstream document — quotation to
 * order, requisition to purchase order — where the warehouse is settled and
 * only the derived site is wanted.
 */
export async function siteOfWarehouse(
  warehouseId: string | null | undefined,
  client: Client = db,
): Promise<string | null> {
  if (!warehouseId) return null;
  const w = await client.warehouse.findUnique({
    where: { id: warehouseId },
    select: { site_id: true },
  });
  return w?.site_id ?? null;
}
