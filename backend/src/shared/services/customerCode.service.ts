import type { Prisma } from '@prisma/client';
import type { db } from '../../infrastructure/database/client';

/**
 * Next customer code, `CUST-00001` style.
 *
 * Read as MAX of the numeric suffix, never `count() + 1`: a count collides under
 * concurrency and reuses a code after a deletion, which is the same defect as the
 * journal-number bug D-5. Callers that can race should run inside the transaction
 * that creates the customer; the unique `(tenant_id, code)` constraint is the
 * final guard. Shared by CRM lead conversion, `POST /customers` and storefront
 * registration, which used to disagree (WORK-030a).
 */
export async function nextCustomerCode(
  tenantId: string,
  client: Prisma.TransactionClient | typeof db,
): Promise<string> {
  const rows = await client.$queryRaw<{ max: bigint | null }[]>`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '^\\D*', ''), '')::bigint), 0) AS max
      FROM customers
     WHERE tenant_id = ${tenantId}::uuid AND code ~ '^CUST-[0-9]+$'
  `;
  return `CUST-${String(Number(rows[0]?.max ?? 0) + 1).padStart(5, '0')}`;
}
