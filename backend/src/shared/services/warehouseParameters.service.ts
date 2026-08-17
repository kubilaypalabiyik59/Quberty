import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';

/**
 * Warehouse management parameters, resolved for one warehouse.
 *
 * **[OFFICIAL]** D365 sets warehouse behaviour on the individual warehouse rather
 * than globally — *Default inventory status ID* lives on the Warehouse FastTab —
 * and that is the shape this business needs: shops where a receipt is immediately
 * sellable, and a distribution warehouse with directed putaway, at once.
 *
 * A warehouse with no row behaves exactly as the product did before migration 017.
 * That is deliberate: "not configured" and "configured off" must be the same
 * behaviour, or applying a migration would change what a tenant sees.
 */

export type AvailabilityScope = 'ALL_LOCATIONS' | 'PICK_LOCATIONS_ONLY';

export interface ResolvedWarehouseParameters {
  requirePutaway: boolean;
  requirePickWork: boolean;
  availabilityCounts: AvailabilityScope;
  defaultReceiveLocationId: string | null;
}

const DEFAULTS: ResolvedWarehouseParameters = {
  requirePutaway: false,
  requirePickWork: false,
  availabilityCounts: 'ALL_LOCATIONS',
  defaultReceiveLocationId: null,
};

type Client = Prisma.TransactionClient | typeof db;

export async function resolveWarehouseParameters(
  warehouseId: string | null | undefined,
  client: Client = db,
): Promise<ResolvedWarehouseParameters> {
  if (!warehouseId) return DEFAULTS;

  const row = await client.warehouseParameters.findUnique({
    where: { warehouse_id: warehouseId },
    select: {
      require_putaway: true,
      require_pick_work: true,
      availability_counts: true,
      default_receive_location_id: true,
    },
  });
  if (!row) return DEFAULTS;

  return {
    requirePutaway: row.require_putaway,
    requirePickWork: row.require_pick_work,
    availabilityCounts: row.availability_counts as AvailabilityScope,
    defaultReceiveLocationId: row.default_receive_location_id,
  };
}

/**
 * The location filter that decides what counts as available in a warehouse.
 *
 * Returns a Prisma `where` fragment for `InventoryStock.location`, or `undefined`
 * when everything counts.
 *
 * **[OFFICIAL]** the distinction it encodes: in a two-step inbound flow the receipt
 * records that goods arrived, and only the putaway "makes the items available to
 * pick". Stock sitting in a receiving location is genuinely on hand and genuinely
 * not sellable, and until this existed the product could not express the difference
 * — which is how a sales order failed for want of stock that was visibly in the
 * building.
 */
export function availabilityLocationFilter(
  params: ResolvedWarehouseParameters,
): { is_pick_location: boolean } | undefined {
  return params.availabilityCounts === 'PICK_LOCATIONS_ONLY'
    ? { is_pick_location: true }
    : undefined;
}
