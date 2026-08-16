import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';

import { logger } from '../../shared/logger';
import { nextSalesOrderNumber } from '../../shared/utils/orderCounter';
import { computeDocumentTax } from '../../shared/services/documentTax.service';
import { nextJournalVoucher } from '../../shared/services/numberSequence.service';
import { resolvePostingAccounts_orExplain } from '../../shared/services/posting.service';
import { resolveItemPolicies, groupByItemGroup } from '../../shared/services/itemPolicy.service';
import { InventoryService } from '../inventory/inventory.service';
import { WarehouseService } from '../warehouse/warehouse.service';

const inventoryService = new InventoryService();
const warehouseService = new WarehouseService();

export class SalesService {
  /**
   * Create a new Sales Order (Draft state)
   */
  async createOrder(tenantId: string, data: CreateOrderDto, createdBy: string) {
    // Validate lines
    if (!data.lines || data.lines.length === 0) {
      throw new AppError('Sales order must have at least one line');
    }

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

    const order = await db.salesOrder.create({
      data: {
        tenant_id: tenantId,
        order_number: orderNumber,
        customer_id: data.customer_id,
        source: data.source ?? 'manual',
        status: 'DRAFT',
        site_id: data.site_id,
        warehouse_id: data.warehouse_id,
        currency: data.currency ?? 'BOB',
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
   * Confirm order: DRAFT → CONFIRMED
   * Reserves stock for all line items
   */
  async confirmOrder(tenantId: string, orderId: string, userId: string) {
    const order = await this.getOrderOrThrow(tenantId, orderId);

    if (order.status !== 'DRAFT') {
      throw new AppError(`Cannot confirm order in ${order.status} status`);
    }

    // Check and reserve stock for each line
    for (const line of order.lines) {
      const available = await inventoryService.getAvailableStock(
        tenantId,
        line.product_id,
        line.variant_id,
        order.warehouse_id
      );

      if (available < line.quantity) {
        const product = await db.product.findUnique({ where: { id: line.product_id }, select: { name: true, sku: true } });
        throw new AppError(
          `Insufficient stock for ${product?.name} (${product?.sku}). Available: ${available}, Required: ${line.quantity}`
        );
      }
    }

    // Reserve stock
    await inventoryService.reserveStock(tenantId, order.lines, orderId);

    const updated = await db.salesOrder.update({
      where: { id: orderId },
      data: { status: 'CONFIRMED', confirmed_at: new Date() },
      include: { lines: true },
    });

    // Create picking wave for warehouse
    if (order.warehouse_id) {
      await warehouseService.addOrderToWave(tenantId, orderId, order.warehouse_id);
    }

    return updated;
  }

  /**
   * Ship order: PACKED → SHIPPED
   * Decrements actual inventory (removes reservation)
   */
  async shipOrder(tenantId: string, orderId: string, userId: string, shipmentData?: ShipmentDto) {
    const order = await this.getOrderOrThrow(tenantId, orderId);

    if (!['CONFIRMED', 'PACKED'].includes(order.status)) {
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
            reference_type: 'SALES_ORDER',
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

    // Deduct stock and record transactions
    await inventoryService.fulfillOrder(tenantId, order);

    // ── Auto GL Journal Entry: COGS, per item group ───────────────────────────
    //
    // Two configuration rules are honoured here, and until they were wired both
    // were merely declared:
    //
    //   stocked = false          the item has no inventory subledger, so there
    //                            is nothing to relieve and no COGS to post. Its
    //                            cost was already expensed on the way in.
    //
    //   item group               [OFFICIAL] the inventory posting profile
    //                            resolves by item Table | Group | All, so two
    //                            products in different groups may post COGS and
    //                            inventory to different accounts. One journal
    //                            line for the whole order cannot express that.
    //
    // Result: one debit/credit PAIR per item group, and non-stocked lines are
    // excluded from the calculation entirely rather than valued at zero.
    {
      const productIds = order.lines.map((l: any) => l.product_id);
      const policies = await resolveItemPolicies(tenantId, productIds);

      const products = await db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, cost_price: true },
      });
      const costMap = new Map(products.map((p: any) => [p.id, Number(p.cost_price ?? 0)]));

      const stockedLines = order.lines.filter((l: any) => policies.get(l.product_id)?.stocked !== false);
      const skipped = order.lines.length - stockedLines.length;
      if (skipped > 0) {
        logger.info(
          { tenantId, order: order.order_number, skipped },
          'COGS skipped for non-stocked lines — their cost is expensed, not relieved from inventory',
        );
      }

      const buckets = groupByItemGroup(
        stockedLines,
        policies,
        (l: any) => l.product_id,
        (l: any) => l.quantity * (costMap.get(l.product_id) ?? 0),
      ).filter((b) => b.amount > 0);

      if (buckets.length > 0) {
        // Resolve per bucket so a group-scoped profile can win over the ALL one.
        const resolved = [];
        for (const b of buckets) {
          const acc = await resolvePostingAccounts_orExplain(
            tenantId, ['COGS', 'INVENTORY'] as const,
            {
              document: `COGS for ${order.order_number}${b.itemGroupCode ? ` (${b.itemGroupCode})` : ''}`,
              itemGroupId: b.itemGroupId ?? undefined,
            },
          );
          if (acc) resolved.push({ bucket: b, acc });
        }

        if (resolved.length > 0) {
          const entryNumber = await nextJournalVoucher(tenantId);
          await db.journalEntry.create({
            data: {
              tenant_id: tenantId,
              entry_number: entryNumber,
              entry_date: new Date(),
              description: `COGS: ${order.order_number}`,
              source_module: 'SALES_COGS',
              source_id: orderId,
              status: 'POSTED',
              posted_at: new Date(),
              created_by: userId,
              lines: {
                create: resolved.flatMap(({ bucket, acc }) => {
                  const label = bucket.itemGroupCode ? ` [${bucket.itemGroupCode}]` : '';
                  return [
                    { account_id: acc.COGS,      debit_amount: bucket.amount, credit_amount: 0,            description: `COGS${label} — ${order.order_number}` },
                    { account_id: acc.INVENTORY, debit_amount: 0,             credit_amount: bucket.amount, description: `Inventory out${label} — ${order.order_number}` },
                  ];
                }),
              },
            },
          });
        }
      }
      // The swallowing `catch` that used to wrap this block is gone. A shipment
      // that cannot post its COGS entry must not quietly succeed — that is D-4.
      // `resolvePostingAccounts_orExplain` decides throw-vs-log-and-skip from the
      // tenant's require_balanced_posting parameter.
    }

    // Create shipment record
    const shipmentNumber = `SHP-${Date.now()}`;
    await db.shipment.create({
      data: {
        tenant_id: tenantId,
        shipment_number: shipmentNumber,
        order_id: orderId,
        status: 'SHIPPED',
        carrier: shipmentData?.carrier,
        tracking_number: shipmentData?.tracking_number,
        shipped_at: new Date(),
        from_warehouse_id: order.warehouse_id,
      },
    });

    const updated = await db.salesOrder.update({
      where: { id: orderId },
      data: { status: 'SHIPPED', shipped_at: new Date() },
    });

    // Update customer lifetime value
    if (order.customer_id) {
      await db.customer.update({
        where: { id: order.customer_id },
        data: {
          lifetime_value: { increment: order.total_amount },
          total_orders: { increment: 1 },
        },
      });
    }

    return updated;
  }

  async cancelOrder(tenantId: string, orderId: string, userId: string) {
    const order = await this.getOrderOrThrow(tenantId, orderId);

    if (['SHIPPED', 'COMPLETED'].includes(order.status)) {
      throw new AppError(`Cannot cancel order in ${order.status} status`);
    }

    // Release reserved stock if confirmed
    if (order.status === 'CONFIRMED') {
      await inventoryService.releaseReservation(tenantId, order.lines, orderId);
    }

    return db.salesOrder.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
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
  site_id?: string;
  warehouse_id?: string;
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
