import { db } from '../../infrastructure/database/client';
import { AppError } from '../errors/AppError';

/**
 * Atomic order number generators — safe under concurrent requests.
 * Uses PostgreSQL ON CONFLICT DO UPDATE (same pattern as factura_counters).
 *
 * Each document type has its own row in order_counters (tenant_id + doc_type).
 * The UPSERT is atomic at the DB level — no race conditions.
 */

type DocType = 'SO' | 'PO' | 'INV' | 'ADJ' | 'TRF' | 'JE';

/**
 * `currentMax` lets the counter self-heal when the order_counters row is behind
 * the actual documents already in the table (e.g. rows created by the seed, an
 * import, or before this counter table existed). Same GREATEST() guard that
 * factura_counters uses — the counter can never hand out a number that already
 * exists.
 */
async function nextCounter(tenantId: string, docType: DocType, currentMax = 0): Promise<number> {
  try {
    const rows = await db.$queryRaw<{ last_number: number }[]>`
      INSERT INTO order_counters (tenant_id, doc_type, last_number, updated_at)
      VALUES (${tenantId}::uuid, ${docType}, GREATEST(1, ${currentMax} + 1), NOW())
      ON CONFLICT (tenant_id, doc_type)
      DO UPDATE SET
        last_number = GREATEST(order_counters.last_number + 1, ${currentMax} + 1),
        updated_at  = NOW()
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

/**
 * Highest numeric suffix already used for a given document number column.
 * Numbers are formatted `PREFIX-YYYY-NNNNN`, so we parse the trailing segment.
 * Returns 0 when the table is empty.
 */
async function maxDocSuffix(table: 'sales_orders' | 'purchase_orders', column: 'order_number' | 'po_number', tenantId: string): Promise<number> {
  // Document numbers are `PREFIX-YYYY-NNNNN`; the 3rd dash-segment is the counter.
  const sql = `
    SELECT COALESCE(MAX(NULLIF(split_part("${column}", '-', 3), '')::bigint), 0) AS max
    FROM "${table}"
    WHERE tenant_id = $1::uuid
  `;
  const rows = await db.$queryRawUnsafe<{ max: bigint | number }[]>(sql, tenantId);
  return Number(rows[0]?.max ?? 0);
}

const year = () => new Date().getFullYear();

export async function nextSalesOrderNumber(tenantId: string): Promise<string> {
  const max = await maxDocSuffix('sales_orders', 'order_number', tenantId);
  const n = await nextCounter(tenantId, 'SO', max);
  return `SO-${year()}-${String(n).padStart(5, '0')}`;
}

export async function nextPurchaseOrderNumber(tenantId: string): Promise<string> {
  const max = await maxDocSuffix('purchase_orders', 'po_number', tenantId);
  const n = await nextCounter(tenantId, 'PO', max);
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

/**
 * Atomic journal entry number — safe under concurrent transactions.
 * Returns format: JE-000001
 */
export async function nextJournalEntryNumber(tenantId: string): Promise<string> {
  const n = await nextCounter(tenantId, 'JE');
  return `JE-${String(n).padStart(6, '0')}`;
}
