import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { TAX } from '../../config/tax';
import { logger } from '../../shared/logger';
import { nextSalesOrderNumber } from '../../shared/utils/orderCounter';
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

    // Prices already include IVA 13% (Bolivia law) — extract the tax from the price
    const taxAmount = TAX.iva(subtotal);
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

    // Deduct stock and record transactions
    await inventoryService.fulfillOrder(tenantId, order);

    // ── Auto GL Journal Entry: COGS ────────────────────────────────────────────
    // Dr 5101 Costo de Ventas  — cost of goods shipped
    // Cr 1110 Inventario       — inventory asset reduced
    try {
      const [cogsAccount, inventoryAccount] = await Promise.all([
        db.account.findFirst({ where: { tenant_id: tenantId, code: '5101' } }),
        db.account.findFirst({ where: { tenant_id: tenantId, code: '1110' } }),
      ]);

      if (cogsAccount && inventoryAccount) {
        // Sum COGS from product cost_price × qty per line
        const productIds = order.lines.map((l: any) => l.product_id);
        const products = await db.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, cost_price: true },
        });
        const costMap = new Map(products.map((p: any) => [p.id, Number(p.cost_price ?? 0)]));

        const cogsAmount = order.lines.reduce((sum: number, line: any) => {
          return sum + line.quantity * costMap.get(line.product_id);
        }, 0);

        if (cogsAmount > 0) {
          const jeCount = await db.journalEntry.count({ where: { tenant_id: tenantId } });
          const entryNumber = `JE-${new Date().getFullYear()}-${String(jeCount + 1).padStart(5, '0')}`;

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
                create: [
                  { account_id: cogsAccount.id,     debit_amount: cogsAmount, credit_amount: 0,           description: `COGS — ${order.order_number}` },
                  { account_id: inventoryAccount.id, debit_amount: 0,          credit_amount: cogsAmount, description: `Inventory out — ${order.order_number}` },
                ],
              },
            },
          });
        }
      }
    } catch (jeErr) {
      logger.error({ err: jeErr }, 'COGS GL journal failed for shipment');
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
