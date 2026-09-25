import type { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { reserve, release, issueReserved } from '../../shared/services/stockLedger.service';
import { AppError } from '../../shared/errors/AppError';

import { logger } from '../../shared/logger';
import { nextSalesOrderNumber } from '../../shared/utils/orderCounter';
import { computeDocumentTax } from '../../shared/services/documentTax.service';
import { postJournal } from '../../shared/services/journal.service';
import { contextForSalesOrder } from '../../shared/services/dimension.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { resolveItemPolicies, groupByItemGroup } from '../../shared/services/itemPolicy.service';
import { resolveInventoryDimensions } from '../../shared/services/inventoryDimension.service';
import { assertTenantReferences } from '../../shared/services/tenantReference.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { resolveDocumentCurrency, assertDocumentCurrencySupported } from '../../shared/services/currency/documentCurrency';

const warehouseService = new WarehouseService();

/** Statuses from which an order's reserved stock can be shipped. */
const SHIPPABLE = ['CONFIRMED', 'PICKING', 'PACKED'];

type Tx = Prisma.TransactionClient;

/**
 * An order that ships or is cancelled has no picking left to do. Open pick work for
 * it is cancelled in the same transaction, so a worker cannot later complete it and
 * move stock for an order that is gone (WORK-043 review).
 */
async function closeOpenPickWork(tx: Tx, tenantId: string, orderId: string) {
  await tx.warehouseWork.updateMany({
    where: {
      tenant_id: tenantId, reference_id: orderId, work_type: 'PICK',
      reference_type: { in: ['SALES_ORDER', 'sales_order'] }, status: { in: ['OPEN', 'IN_PROGRESS'] },
    },
    data: { status: 'CANCELLED' },
  });
}

/** Hold an order's stocked lines in its warehouse (shared by ERP and storefront confirm). */
export async function reserveOrderStock(
  tx: Tx,
  tenantId: string,
  order: { id: string; order_number: string; warehouse_id: string | null; lines: Array<{ id: string; product_id: string; variant_id: string | null; quantity: number }> },
) {
  const policies = await resolveItemPolicies(tenantId, order.lines.map((l) => l.product_id), tx);
  const stocked = order.lines.filter((l) => policies.get(l.product_id)?.stocked !== false);
  if (stocked.length === 0) return;
  if (!order.warehouse_id) {
    throw new AppError(
      `${order.order_number} has no warehouse, so its stock cannot be reserved. Set the warehouse on the order.`,
      422,
      'ORDER_WAREHOUSE_REQUIRED',
    );
  }
  await reserve(tx, {
    tenantId,
    sourceType: 'SALES_ORDER',
    sourceId: order.id,
    warehouseId: order.warehouse_id,
    lines: stocked.map((l) => ({ product_id: l.product_id, variant_id: l.variant_id ?? null, quantity: l.quantity, line_id: l.id })),
  });
}

/**
 * Post COGS for an issue from the cost it actually consumed, one debit/credit pair
 * per item group.
 *
 * [OFFICIAL] the inventory posting profile resolves by item Table | Group | All,
 * so products in different item groups may post COGS and inventory to different
 * accounts. Non-stocked lines never reach here: they consume no layers.
 * `require_balanced_posting` decides whether an unresolved account throws.
 */
export async function postIssueCogs(
  tx: Tx,
  tenantId: string,
  opts: {
    costByProduct: Map<string, number>;
    document: string;
    sourceModule: string;
    sourceId: string;
    userId: string | null;
    dimensionsFor: () => Promise<any>;
    reverse?: boolean;
    description?: string;
  },
) {
  const productIds = [...opts.costByProduct.keys()];
  if (productIds.length === 0) return;
  const policies = await resolveItemPolicies(tenantId, productIds, tx);
  const buckets = groupByItemGroup(
    productIds,
    policies,
    (id) => id,
    (id) => opts.costByProduct.get(id) ?? 0,
  ).filter((b) => b.amount > 0);
  if (buckets.length === 0) return;

  const resolved = [];
  for (const b of buckets) {
    const acc = await resolvePostingAccounts_orExplain(tenantId, ['COGS', 'INVENTORY'] as const, {
      document: `COGS for ${opts.document}${b.itemGroupCode ? ` (${b.itemGroupCode})` : ''}`,
      itemGroupId: b.itemGroupId ?? undefined,
      client: tx,
    });
    if (acc) resolved.push({ bucket: b, acc });
  }
  if (resolved.length === 0) return;

  const dimensions = await opts.dimensionsFor();
  await postJournal({
    tenantId,
    tx,
    description: opts.description ?? `COGS: ${opts.document}`,
    source: { module: opts.sourceModule, id: opts.sourceId },
    userId: opts.userId,
    dimensions,
    lines: resolved.flatMap(({ bucket, acc }) => {
      const label = bucket.itemGroupCode ? ` [${bucket.itemGroupCode}]` : '';
      return opts.reverse
        ? [
            { accountId: acc.INVENTORY, debit: bucket.amount, description: `Inventory back${label} — ${opts.document}` },
            { accountId: acc.COGS, credit: bucket.amount, description: `COGS reversal${label} — ${opts.document}` },
          ]
        : [
            { accountId: acc.COGS, debit: bucket.amount, description: `COGS${label} — ${opts.document}` },
            { accountId: acc.INVENTORY, credit: bucket.amount, description: `Inventory out${label} — ${opts.document}` },
          ];
    }),
  });
}

/**
 * Coerce a date-only value to something Prisma will accept for a `@db.Date`.
 *
 * A form sends `"2026-09-30"`. Prisma rejects it — "premature end of input,
 * expected ISO-8601 DateTime" — so passing the string straight through fails at
 * runtime while type-checking cleanly. An invalid string returns null rather
 * than throwing: a mistyped promise date should not lose the whole order, and a
 * null promise is a state the panel already handles honestly (it reports
 * `unknown`, never on-time).
 */
function toDateOrNull(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(`${v}`.length === 10 ? `${v}T00:00:00.000Z` : `${v}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class SalesService {
  /**
   * Create a new Sales Order (Draft state)
   */
  async createOrder(tenantId: string, data: CreateOrderDto, createdBy: string) {
    // Validate lines
    if (!data.lines || data.lines.length === 0) {
      throw new AppError('Sales order must have at least one line');
    }

    // Storage dimensions before anything is written. `data.site_id` is
    // deliberately ignored — site is the warehouse's site and is never taken
    // from the caller; accepting both let them disagree, which is how every
    // order ended up with a null site while some had a warehouse.
    const dims = await resolveInventoryDimensions(
      tenantId,
      { warehouseId: data.warehouse_id, documentKind: 'sales order' },
    );

    // Before the number is drawn, so a refused order spends no number.
    await assertTenantReferences(tenantId, { customerId: data.customer_id ?? null, lines: data.lines });

    const orderNumber = await nextSalesOrderNumber(tenantId);

    // Calculate totals
    let subtotal = 0;
    const linesWithTotals = data.lines.map((line, idx) => {
      const lineTotal = line.quantity * line.unit_price * (1 - (line.discount_pct ?? 0) / 100);
      subtotal += lineTotal;
      return { ...line, line_total: lineTotal, sort_order: idx };
    });

    // Was `TAX.iva(subtotal)` — the hardcoded Bolivian 13%, applied to every
    // tenant regardless of their own configuration. Now resolved from the tenant's
    // tax setup, which for Bolivia produces exactly the same number.
    const orderTax = await computeDocumentTax(tenantId, subtotal, {
      partyId: data.customer_id ?? null,
    });
    const taxAmount = orderTax.vat;
    const totalAmount = subtotal - (data.discount_amount ?? 0);

    // The ledger decides the currency; a request may only name one the tenant has
    // activated. A currency other than the ledger's accounting currency is refused
    // here rather than at invoice: an order that can never be invoiced is worse for
    // the user than a clear refusal, and the column stays so WORK-026 opens it by
    // deleting a guard.
    const currency = await resolveDocumentCurrency(tenantId, data.currency);
    await assertDocumentCurrencySupported(tenantId, currency, {
      errorCode: 'SALES_FX_NOT_IMPLEMENTED',
      capability: 'Sales orders and invoices',
    });

    const order = await db.salesOrder.create({
      data: {
        tenant_id: tenantId,
        order_number: orderNumber,
        customer_id: data.customer_id,
        source: data.source ?? 'manual',
        status: 'DRAFT',
        site_id: dims.site_id,
        warehouse_id: dims.warehouse_id,
        requested_delivery_date: toDateOrNull(data.requested_delivery_date),
        currency,
        subtotal,
        discount_amount: data.discount_amount ?? 0,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        shipping_address: data.shipping_address,
        notes: data.notes,
        created_by: createdBy,
        lines: {
          create: linesWithTotals.map((l) => ({
            product_id: l.product_id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            unit_price: l.unit_price,
            discount_pct: l.discount_pct ?? 0,
            line_total: l.line_total,
            sort_order: l.sort_order,
          })),
        },
      },
      include: { lines: true, customer: true },
    });

    return order;
  }

  /**
   * Confirm order: DRAFT → CONFIRMED.
   *
   * One transaction: the status is claimed first (a second confirm finds nothing
   * to claim), then every stocked line is held in the order's warehouse through
   * InventoryReservation rows. A line that cannot be covered refuses the whole
   * order and nothing is held.
   */
  async confirmOrder(tenantId: string, orderId: string, userId: string) {
    const order = await this.getOrderOrThrow(tenantId, orderId);

    if (order.status !== 'DRAFT') {
      throw new AppError(`Cannot confirm order in ${order.status} status`);
    }

    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.salesOrder.updateMany({
        where: { id: orderId, tenant_id: tenantId, status: 'DRAFT' },
        data: { status: 'CONFIRMED', confirmed_at: new Date() },
      });
      if (claimed.count === 0) {
        throw new AppError(`${order.order_number} is no longer a draft.`, 409, 'ORDER_STATUS_CHANGED');
      }

      await reserveOrderStock(tx, tenantId, order);

      return tx.salesOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true } });
    });

    // Wave assignment runs after the reservation committed. It is best-effort: a
    // failure here must not report an error for an order that is confirmed and
    // holds its stock (a retry would create a second order). The order can still be
    // picked; the failure is logged for the warehouse to act on.
    if (order.warehouse_id) {
      try {
        await warehouseService.addOrderToWave(tenantId, orderId, order.warehouse_id);
      } catch (err) {
        logger.error({ err, tenantId, order: order.order_number }, 'Confirmed order could not be added to a wave');
      }
    }

    return updated;
  }

  /**
   * Ship order: CONFIRMED | PICKING | PACKED → SHIPPED.
   *
   * One transaction: claim the status, issue exactly the stock the order holds —
   * consuming FIFO cost layers at the locations it holds them — post COGS from the
   * layers consumed, and write the shipment. Any failure rolls every part back, so
   * a retried shipment can never deduct twice.
   */
  async shipOrder(tenantId: string, orderId: string, userId: string, shipmentData?: ShipmentDto) {
    const order = await this.getOrderOrThrow(tenantId, orderId);

    if (!SHIPPABLE.includes(order.status)) {
      throw new AppError(`Cannot ship order in ${order.status} status`);
    }

    // [OFFICIAL] "Picking requirements" prevents posting a packing slip before a
    // picking list is posted, and applies to ALL inventory issues for the item,
    // not only to sales orders.
    // learn.microsoft.com/dynamics365/supply-chain/cost-management/inventory-costing-faq
    {
      const gatePolicies = await resolveItemPolicies(
        tenantId,
        order.lines.map((l: any) => l.product_id),
      );
      const needPicking = order.lines.filter(
        (l: any) => gatePolicies.get(l.product_id)?.pickingRequirements,
      );
      if (needPicking.length > 0) {
        const picked = await db.warehouseWork.count({
          where: {
            tenant_id: tenantId,
            // Pick work was created with the lower-case reference until WORK-043.
            reference_type: { in: ['SALES_ORDER', 'sales_order'] },
            reference_id: orderId,
            work_type: 'PICK',
            status: 'COMPLETED',
          },
        });
        if (picked === 0) {
          throw new AppError(
            `${needPicking.length} line(s) on ${order.order_number} require a completed picking ` +
              `list before the shipment can be posted. Complete the warehouse pick work first.`,
            409,
            'PICKING_REQUIRED',
          );
        }
      }
    }

    return db.$transaction(async (tx) => {
      const claimed = await tx.salesOrder.updateMany({
        where: { id: orderId, tenant_id: tenantId, status: { in: SHIPPABLE } },
        data: { status: 'SHIPPED', shipped_at: new Date() },
      });
      if (claimed.count === 0) {
        throw new AppError(`${order.order_number} has already been shipped or cancelled.`, 409, 'ORDER_STATUS_CHANGED');
      }

      await closeOpenPickWork(tx, tenantId, orderId);

      const issue = await issueReserved(tx, {
        sourceType: 'SALES_ORDER',
        sourceId: orderId,
        lines: order.lines.map((l: any) => ({ product_id: l.product_id, variant_id: l.variant_id ?? null, quantity: l.quantity })),
        meta: {
          tenantId,
          transactionType: 'OUTBOUND',
          referenceType: 'SALES_ORDER',
          referenceId: orderId,
          referenceNumber: order.order_number,
          notes: `Shipment of ${order.order_number}`,
          userId,
        },
      });

      await postIssueCogs(tx, tenantId, {
        costByProduct: issue.costByProduct,
        document: order.order_number,
        sourceModule: 'SALES_COGS',
        sourceId: orderId,
        userId,
        dimensionsFor: () => contextForSalesOrder(tenantId, orderId, tx),
      });

      // Create shipment record
      await tx.shipment.create({
        data: {
          tenant_id: tenantId,
          shipment_number: `SHP-${Date.now()}`,
          order_id: orderId,
          status: 'SHIPPED',
          carrier: shipmentData?.carrier,
          tracking_number: shipmentData?.tracking_number,
          shipped_at: new Date(),
          from_warehouse_id: order.warehouse_id,
        },
      });

      // Update customer lifetime value
      if (order.customer_id) {
        await tx.customer.update({
          where: { id: order.customer_id },
          data: {
            lifetime_value: { increment: order.total_amount },
            total_orders: { increment: 1 },
          },
        });
      }

      return tx.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    });
  }

  /**
   * Cancel an order that has not shipped. Frees exactly the holds this order has —
   * in any status that can hold stock — and nothing belonging to another order.
   * An invoiced order is not cancelled: its factura is a legal document that
   * must be annulled or credited first.
   */
  async cancelOrder(tenantId: string, orderId: string, userId: string) {
    const order = await this.getOrderOrThrow(tenantId, orderId);

    if (['SHIPPED', 'COMPLETED', 'RETURNED', 'VOIDED', 'CANCELLED'].includes(order.status)) {
      throw new AppError(`Cannot cancel order in ${order.status} status`);
    }
    if (order.invoice_id) {
      throw new AppError(
        `${order.order_number} has been invoiced. Annul the factura or post a return instead of cancelling.`,
        409,
        'ORDER_INVOICED',
      );
    }

    return db.$transaction(async (tx) => {
      const claimed = await tx.salesOrder.updateMany({
        where: { id: orderId, tenant_id: tenantId, status: order.status, invoice_id: null },
        data: { status: 'CANCELLED' },
      });
      if (claimed.count === 0) {
        throw new AppError(`${order.order_number} changed while it was being cancelled.`, 409, 'ORDER_STATUS_CHANGED');
      }
      await release(tx, { tenantId, sourceType: 'SALES_ORDER', sourceId: orderId });
      await closeOpenPickWork(tx, tenantId, orderId);
      return tx.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    });
  }

  async getOrders(tenantId: string, filters: OrderFilters) {
    const where: any = { tenant_id: tenantId };

    if (filters.status) where.status = filters.status;
    if (filters.customer_id) where.customer_id = filters.customer_id;
    if (filters.site_id) where.site_id = filters.site_id;
    if (filters.from) where.created_at = { gte: new Date(filters.from) };
    if (filters.to) where.created_at = { ...where.created_at, lte: new Date(filters.to) };

    const page = Number(filters.page) || 1;
    const limit = Number(filters.limit) || 20;

    const [orders, total] = await Promise.all([
      db.salesOrder.findMany({
        where,
        include: {
          customer: { select: { first_name: true, last_name: true, code: true } },
          lines: true,
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.salesOrder.count({ where }),
    ]);

    return { orders, total, page, limit };
  }

  private async getOrderOrThrow(tenantId: string, orderId: string) {
    const order = await db.salesOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId },
      include: { lines: true },
    });
    if (!order) throw new AppError('Sales order not found', 404);
    return order;
  }

}

// DTOs
interface CreateOrderDto {
  customer_id?: string;
  source?: 'manual' | 'storefront' | 'import';
  /**
   * `site_id` is deliberately NOT accepted. Site is the warehouse's site and is
   * derived by `inventoryDimension.service.ts`. Accepting it from the caller
   * would let the two disagree, and a denormalised copy that disagrees with its
   * source is worse than no copy at all.
   */
  warehouse_id?: string;
  /** What was promised to the customer. Drives the panel's health ratio. */
  requested_delivery_date?: Date | string | null;
  currency?: string;
  discount_amount?: number;
  shipping_address?: object;
  notes?: string;
  lines: {
    product_id: string;
    variant_id?: string;
    quantity: number;
    unit_price: number;
    discount_pct?: number;
  }[];
}

interface ShipmentDto {
  carrier?: string;
  tracking_number?: string;
}

interface OrderFilters {
  status?: string;
  customer_id?: string;
  site_id?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}
