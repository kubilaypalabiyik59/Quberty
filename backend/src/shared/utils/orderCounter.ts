import { db } from '../../infrastructure/database/client';
import { AppError } from '../errors/AppError';

/**
 * Atomic order number generators — safe under concurrent requests.
 * Uses PostgreSQL ON CONFLICT DO UPDATE (same pattern as factura_counters).
 *
 * Each document type has its own row in order_counters (tenant_id + doc_type).
 * The UPSERT is atomic at the DB level — no race conditions.
 */

type DocType = 'SO' | 'PO' | 'INV' | 'ADJ' | 'TRF';

async function nextCounter(tenantId: string, docType: DocType): Promise<number> {
  try {
    const rows = await db.$queryRaw<{ last_number: number }[]>`
      INSERT INTO order_counters (tenant_id, doc_type, last_number, updated_at)
      VALUES (${tenantId}::uuid, ${docType}, 1, NOW())
      ON CONFLICT (tenant_id, doc_type)
      DO UPDATE SET last_number = order_counters.last_number + 1, updated_at = NOW()
      RETURNING last_number
    `;
    return Number(rows[0].last_number);
  } catch (err: any) {
    if (err?.message?.includes('order_counters') || err?.code === '42P01') {
      throw new AppError('Database schema is out of date. Please run `npm run db:push` in the backend to apply schema changes.', 500);
    }
    throw err;
  }
}

const year = () => new Date().getFullYear();

export async function nextSalesOrderNumber(tenantId: string): Promise<string> {
  const n = await nextCounter(tenantId, 'SO');
  return `SO-${year()}-${String(n).padStart(5, '0')}`;
}

export async function nextPurchaseOrderNumber(tenantId: string): Promise<string> {
  const n = await nextCounter(tenantId, 'PO');
  return `PO-${year()}-${String(n).padStart(5, '0')}`;
}

export async function nextInventoryAdjNumber(tenantId: string): Promise<string> {
  const n = await nextCounter(tenantId, 'ADJ');
  return `ADJ-${year()}-${String(n).padStart(5, '0')}`;
}

export async function nextTransferNumber(tenantId: string): Promise<string> {
  const n = await nextCounter(tenantId, 'TRF');
  return `TRF-${year()}-${String(n).padStart(5, '0')}`;
}
