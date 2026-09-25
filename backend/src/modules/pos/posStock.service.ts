import type { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';

type Client = Prisma.TransactionClient | typeof db;

/**
 * Store scoping for the register (WORK-029).
 *
 * A register sells from one physical store. The session carries that warehouse
 * and every stock movement of the sale stays inside it — Commerce store
 * inventory works against the store's own warehouse. The stock issue and its
 * cost are the shared stock ledger's (`stockLedger.service.ts`, WORK-043/044).
 */

/**
 * The warehouse a register session sells from: the explicit choice, validated
 * against the tenant, or the tenant's only active warehouse. Deliberately no
 * fallback to `SalesParameters.default_warehouse_id` — a register's location is
 * a physical fact, and that default would send every store's till to one
 * warehouse.
 */
export async function resolveRegisterWarehouse(
  tenantId: string,
  requested: string | null | undefined,
  client: Client = db,
): Promise<{ warehouse_id: string; site_id: string }> {
  if (requested) {
    const wh = await client.warehouse.findFirst({
      where: { id: requested, tenant_id: tenantId, is_active: true },
      select: { id: true, site_id: true },
    });
    if (!wh) throw new AppError('Warehouse not found for this tenant', 422, 'FOREIGN_REFERENCE');
    return { warehouse_id: wh.id, site_id: wh.site_id };
  }
  const all = await client.warehouse.findMany({
    where: { tenant_id: tenantId, is_active: true },
    select: { id: true, site_id: true },
    take: 2,
  });
  if (all.length === 1) return { warehouse_id: all[0].id, site_id: all[0].site_id };
  throw new AppError(
    'Choose the warehouse this register sells from.',
    422,
    'POS_SESSION_WAREHOUSE_REQUIRED',
  );
}
