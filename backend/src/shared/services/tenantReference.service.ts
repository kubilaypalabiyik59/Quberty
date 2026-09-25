import type { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../errors/AppError';

type Client = Prisma.TransactionClient | typeof db;

export interface TenantReferences {
  customerId?: string | null;
  taxGroupId?: string | null;
  lines?: Array<{ product_id: string; variant_id?: string | null }>;
  /**
   * Warehouse locations, keyed by the request field that carried each one. A
   * location counts as the tenant's only when the location row AND its zone's
   * warehouse both belong to the tenant.
   */
  locations?: Record<string, string | null | undefined>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Refuses a document that points at another tenant's master data.
 *
 * Every id a caller supplies — customer, tax group, product, variant — must
 * exist under the caller's tenant, and each variant must belong to its line's
 * product. Row-level tenancy (CLAUDE.md §7) is only as strong as the foreign
 * keys a request is allowed to carry; without this a tenant-A order could hold
 * tenant-B's customer and later write that customer's lifetime value.
 *
 * The error names the offending field, never the other tenant's data.
 */
export async function assertTenantReferences(
  tenantId: string,
  refs: TenantReferences,
  client: Client = db,
): Promise<void> {
  const bad: string[] = [];
  const valid = (id: string | null | undefined, field: string) => {
    if (id && !UUID.test(id)) { bad.push(field); return false; }
    return !!id;
  };

  if (valid(refs.customerId, 'customer_id')) {
    const n = await client.customer.count({ where: { id: refs.customerId!, tenant_id: tenantId } });
    if (n === 0) bad.push('customer_id');
  }

  if (valid(refs.taxGroupId, 'tax_group_id')) {
    const n = await client.taxGroup.count({ where: { id: refs.taxGroupId!, tenant_id: tenantId } });
    if (n === 0) bad.push('tax_group_id');
  }

  const lines = (refs.lines ?? []).map((l, i) => ({ ...l, i }));
  const productLines = lines.filter((l) => valid(l.product_id, `lines[${l.i}].product_id`));
  if (productLines.length) {
    const found = await client.product.findMany({
      where: { id: { in: [...new Set(productLines.map((l) => l.product_id))] }, tenant_id: tenantId },
      select: { id: true },
    });
    const known = new Set(found.map((p) => p.id));
    for (const l of productLines) if (!known.has(l.product_id)) bad.push(`lines[${l.i}].product_id`);
  }

  const variantLines = lines.filter((l) => valid(l.variant_id, `lines[${l.i}].variant_id`));
  if (variantLines.length) {
    const variants = await client.productVariant.findMany({
      where: { id: { in: [...new Set(variantLines.map((l) => l.variant_id!))] }, tenant_id: tenantId },
      select: { id: true, product_id: true },
    });
    const owner = new Map(variants.map((v) => [v.id, v.product_id]));
    for (const l of variantLines) if (owner.get(l.variant_id!) !== l.product_id) bad.push(`lines[${l.i}].variant_id`);
  }

  const locations = Object.entries(refs.locations ?? {}).filter(([field, id]) => valid(id, field));
  if (locations.length) {
    const found = await client.warehouseLocation.findMany({
      where: {
        id: { in: [...new Set(locations.map(([, id]) => id!))] },
        tenant_id: tenantId,
        zone: { tenant_id: tenantId, warehouse: { tenant_id: tenantId } },
      },
      select: { id: true },
    });
    const known = new Set(found.map((l) => l.id));
    for (const [field, id] of locations) if (!known.has(id!)) bad.push(field);
  }

  if (bad.length) {
    throw new AppError(`Unknown reference for this tenant: ${[...new Set(bad)].join(', ')}`, 422, 'FOREIGN_REFERENCE');
  }
}
