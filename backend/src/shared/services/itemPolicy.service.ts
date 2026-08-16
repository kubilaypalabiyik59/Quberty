import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { logger } from '../logger';

/**
 * The item model group and item group, resolved for a set of products.
 *
 * WHY THIS EXISTS
 *
 * Migrations 008 and 009 made both groups configurable, and for a while nothing
 * read them — which is worse than not having them, because a user who sets
 * `stocked = false` reasonably expects the system to stop keeping inventory for
 * that item. This is the single place that answers "what does this product's
 * configuration say", so posting and inventory cannot drift apart.
 *
 * ── FALLBACK IS EXACTLY TODAY'S BEHAVIOUR ──────────────────────────────────
 * A product with no item model group is treated as stocked, posting both
 * physical and financial, with no process gates, costed by
 * `InventoryParameters.costing_method`. That is precisely what the system did
 * before groups existed, so assigning nothing changes nothing.
 *
 * A product with no item group resolves `itemGroupId = null`, which makes the
 * posting profile fall through to the ALL scope — again, today's behaviour.
 */

export interface ItemPolicy {
  productId: string;
  /** Null → posting profiles resolve at the ALL scope, as before. */
  itemGroupId: string | null;
  itemGroupCode: string | null;

  costingMethod: string;
  /** False → no inventory subledger; cost is expensed. */
  stocked: boolean;
  postPhysicalInventory: boolean;
  postFinancialInventory: boolean;
  accrueLiabilityOnReceipt: boolean;
  postDeferredRevenueOnDelivery: boolean;

  registrationRequirements: boolean;
  receivingRequirements: boolean;
  pickingRequirements: boolean;
  deductionRequirements: boolean;

  /** True when no item model group is assigned and the defaults above are the fallback. */
  isDefault: boolean;
  modelGroupCode: string | null;
}

type Client = Prisma.TransactionClient | typeof db;

function fallback(productId: string, costingMethod: string): ItemPolicy {
  return {
    productId,
    itemGroupId: null,
    itemGroupCode: null,
    costingMethod,
    stocked: true,
    postPhysicalInventory: true,
    postFinancialInventory: true,
    accrueLiabilityOnReceipt: true,
    postDeferredRevenueOnDelivery: false,
    registrationRequirements: false,
    receivingRequirements: false,
    pickingRequirements: false,
    deductionRequirements: false,
    isDefault: true,
    modelGroupCode: null,
  };
}

/**
 * Resolve policy for many products at once. Batched deliberately: posting runs
 * over every line of a document and one query per line would be the kind of
 * thing that is fine with eight products and not with eight hundred.
 */
export async function resolveItemPolicies(
  tenantId: string,
  productIds: string[],
  client: Client = db,
): Promise<Map<string, ItemPolicy>> {
  const unique = [...new Set(productIds)].filter(Boolean);
  const out = new Map<string, ItemPolicy>();
  if (unique.length === 0) return out;

  const params = await client.inventoryParameters.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: null },
    select: { costing_method: true },
  });
  const tenantCosting = params?.costing_method ?? 'FIFO';

  const products = await client.product.findMany({
    where: { id: { in: unique }, tenant_id: tenantId },
    select: {
      id: true,
      item_group: { select: { id: true, code: true } },
      item_model_group: {
        select: {
          code: true,
          costing_method: true,
          stocked: true,
          post_physical_inventory: true,
          post_financial_inventory: true,
          accrue_liability_on_receipt: true,
          post_deferred_revenue_on_delivery: true,
          registration_requirements: true,
          receiving_requirements: true,
          picking_requirements: true,
          deduction_requirements: true,
          is_active: true,
        },
      },
    },
  });

  for (const p of products) {
    const g = p.item_model_group;

    // An INACTIVE model group falls back rather than silently applying settings
    // somebody has deactivated. Loud, because it is a configuration mistake.
    if (g && !g.is_active) {
      logger.warn(
        { tenantId, productId: p.id, modelGroup: g.code },
        'Item model group is inactive — falling back to tenant defaults for this product',
      );
    }

    out.set(p.id, {
      productId: p.id,
      itemGroupId: p.item_group?.id ?? null,
      itemGroupCode: p.item_group?.code ?? null,
      ...(g && g.is_active
        ? {
            costingMethod: g.costing_method,
            stocked: g.stocked,
            postPhysicalInventory: g.post_physical_inventory,
            postFinancialInventory: g.post_financial_inventory,
            accrueLiabilityOnReceipt: g.accrue_liability_on_receipt,
            postDeferredRevenueOnDelivery: g.post_deferred_revenue_on_delivery,
            registrationRequirements: g.registration_requirements,
            receivingRequirements: g.receiving_requirements,
            pickingRequirements: g.picking_requirements,
            deductionRequirements: g.deduction_requirements,
            isDefault: false,
            modelGroupCode: g.code,
          }
        : {
            costingMethod: tenantCosting,
            stocked: true,
            postPhysicalInventory: true,
            postFinancialInventory: true,
            accrueLiabilityOnReceipt: true,
            postDeferredRevenueOnDelivery: false,
            registrationRequirements: false,
            receivingRequirements: false,
            pickingRequirements: false,
            deductionRequirements: false,
            isDefault: true,
            modelGroupCode: g?.code ?? null,
          }),
    });
  }

  // Products that no longer exist still get a policy, so a caller never has to
  // handle an undefined and accidentally skip a line.
  for (const id of unique) if (!out.has(id)) out.set(id, fallback(id, tenantCosting));

  return out;
}

export async function resolveItemPolicy(
  tenantId: string,
  productId: string,
  client: Client = db,
): Promise<ItemPolicy> {
  return (await resolveItemPolicies(tenantId, [productId], client)).get(productId)!;
}

/* ─────────────────────── splitting a document by item group ───────────────── */

export interface GroupedAmount<T> {
  itemGroupId: string | null;
  itemGroupCode: string | null;
  amount: number;
  lines: T[];
}

/**
 * Split document lines into one bucket per item group.
 *
 * **[OFFICIAL]** the inventory posting profile resolves by `Item code =
 * Table | Group | All | Category`, so two products in different item groups can
 * legitimately post their inventory and COGS to different accounts. A single
 * journal line for the whole document cannot express that — it is why the item
 * group axis was unreachable and why posting has to group before it posts.
 * learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting-profiles
 *
 * Lines whose product resolves to no item group land in the `null` bucket, which
 * resolves at the ALL scope — one bucket, one account, exactly as before.
 */
export function groupByItemGroup<T>(
  lines: T[],
  policies: Map<string, ItemPolicy>,
  productIdOf: (line: T) => string,
  amountOf: (line: T) => number,
): GroupedAmount<T>[] {
  const buckets = new Map<string, GroupedAmount<T>>();

  for (const line of lines) {
    const policy = policies.get(productIdOf(line));
    const key = policy?.itemGroupId ?? '__ALL__';
    const existing = buckets.get(key);
    const amount = amountOf(line);

    if (existing) {
      existing.amount = Number((existing.amount + amount).toFixed(2));
      existing.lines.push(line);
    } else {
      buckets.set(key, {
        itemGroupId: policy?.itemGroupId ?? null,
        itemGroupCode: policy?.itemGroupCode ?? null,
        amount: Number(amount.toFixed(2)),
        lines: [line],
      });
    }
  }

  return [...buckets.values()];
}
