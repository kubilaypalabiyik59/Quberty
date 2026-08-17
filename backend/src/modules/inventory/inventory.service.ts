import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/logger';
import { physicalStatusFor } from '../../shared/services/inventoryTransactionStatus';
import { resolveItemPolicies } from '../../shared/services/itemPolicy.service';
import {
  resolveWarehouseParameters,
  availabilityLocationFilter,
} from '../../shared/services/warehouseParameters.service';

export class InventoryService {
  /**
   * Available stock for a product.
   *
   * A NOT-STOCKED item has no inventory subledger at all, so "how much is
   * available" is not a meaningful question for it — and answering 0 would make
   * every service, repair or delivery charge look permanently out of stock.
   * [OFFICIAL] "If you don't enable the Stocked product option, the system
   * doesn't track any inventory transactions in the inventory subledger, and the
   * cost of the items is typically expensed into your general ledger."
   * Returns Infinity so availability checks pass without special-casing at each
   * call site.
   */
  async getAvailableStock(
    tenantId: string,
    productId: string,
    variantId: string | null | undefined,
    warehouseId: string | null | undefined
  ): Promise<number> {
    const policies = await resolveItemPolicies(tenantId, [productId]);
    if (policies.get(productId)?.stocked === false) return Number.POSITIVE_INFINITY;

    const where: any = { tenant_id: tenantId, product_id: productId };
    if (variantId) where.variant_id = variantId;

    // What counts as available is a warehouse setting, not a constant.
    //
    // **[OFFICIAL]** in a two-step inbound flow the receipt records that goods
    // arrived and only the putaway "makes the items available to pick". A warehouse
    // running that flow must not count stock still sitting on the receiving dock —
    // and one that is not running it must count everything, exactly as before.
    // `ALL_LOCATIONS` is the default, so nothing changes until a warehouse opts in.
    if (warehouseId) {
      const params = await resolveWarehouseParameters(warehouseId);
      where.location = {
        zone: { warehouse_id: warehouseId },
        ...(availabilityLocationFilter(params) ?? {}),
      };
    }

    const result = await db.inventoryStock.aggregate({
      where,
      _sum: { quantity: true, reserved_qty: true },
    });
    return (result._sum.quantity ?? 0) - (result._sum.reserved_qty ?? 0);
  }

  /**
   * Reserve stock for an order's lines.
   *
   * `warehouseId` is not optional decoration. Without it this method walked EVERY
   * stock row for the product in the tenant, oldest first, and reserved wherever it
   * found quantity — while `getAvailableStock` above scoped its answer to the
   * order's warehouse. The two disagreed, so an order whose availability check
   * passed in La Paz could have its stock reserved in Istanbul. Same defect class
   * as the return path that migration 011 fixed, and invisible on a single-warehouse
   * tenant; this one has three, in two countries.
   */
  async reserveStock(
    tenantId: string,
    lines: { product_id: string; variant_id?: string | null; quantity: number }[],
    orderId: string,
    warehouseId?: string | null
  ) {
    // Nothing to reserve for an item with no inventory subledger.
    const policies = await resolveItemPolicies(tenantId, lines.map((l) => l.product_id));

    for (const line of lines) {
      if (policies.get(line.product_id)?.stocked === false) continue;

      // Reservation must see exactly what availability saw, including the
      // pick-location filter. If they diverge, an order passes its check and then
      // reserves stock the check excluded — the same class of bug as reserving in
      // the wrong warehouse, one level further down.
      const whParams = await resolveWarehouseParameters(warehouseId);
      const stockRecords = await db.inventoryStock.findMany({
        where: {
          tenant_id: tenantId,
          product_id: line.product_id,
          ...(line.variant_id ? { variant_id: line.variant_id } : {}),
          ...(warehouseId
            ? {
                location: {
                  zone: { warehouse_id: warehouseId },
                  ...(availabilityLocationFilter(whParams) ?? {}),
                },
              }
            : {}),
        },
        orderBy: { updated_at: 'asc' }, // FIFO: oldest location first
      });

      let remaining = line.quantity;
      for (const stock of stockRecords) {
        if (remaining <= 0) break;
        const available = stock.quantity - stock.reserved_qty;
        const toReserve = Math.min(remaining, available);
        if (toReserve <= 0) continue;
        await db.inventoryStock.update({
          where: { id: stock.id },
          data: { reserved_qty: { increment: toReserve } },
        });
        remaining -= toReserve;
      }

      if (remaining > 0) {
        throw new AppError(`Could not reserve sufficient stock for product ${line.product_id}`);
      }
    }
  }

  async releaseReservation(
    tenantId: string,
    lines: { product_id: string; variant_id?: string | null; quantity: number }[],
    orderId: string
  ) {
    for (const line of lines) {
      const stockRecords = await db.inventoryStock.findMany({
        where: {
          tenant_id: tenantId,
          product_id: line.product_id,
          ...(line.variant_id ? { variant_id: line.variant_id } : {}),
          reserved_qty: { gt: 0 },
        },
      });

      let remaining = line.quantity;
      for (const stock of stockRecords) {
        if (remaining <= 0) break;
        const toRelease = Math.min(remaining, stock.reserved_qty);
        await db.inventoryStock.update({
          where: { id: stock.id },
          data: { reserved_qty: { decrement: toRelease } },
        });
        remaining -= toRelease;
      }
    }
  }

  /**
   * FIFO fulfillment: consumes from the oldest batch first.
   * order must include order_number for transaction reference.
   */
  async fulfillOrder(tenantId: string, order: any) {
    // A not-stocked line has no batches to consume and no inventory to relieve;
    // its cost was expensed when it was bought. Skipping it here is what keeps
    // the subledger empty for that item, which is the whole meaning of the flag.
    const policies = await resolveItemPolicies(
      tenantId,
      order.lines.map((l: any) => l.product_id),
    );
    const skipped = order.lines.filter((l: any) => policies.get(l.product_id)?.stocked === false);
    if (skipped.length > 0) {
      logger.info(
        { tenantId, order: order.order_number, skipped: skipped.length },
        'Fulfilment skipped inventory movement for not-stocked lines',
      );
    }

    for (const line of order.lines) {
      if (policies.get(line.product_id)?.stocked === false) continue;

      // Find FIFO batches for this product/variant (oldest received_at first)
      const batches = await db.inventoryCostLayer.findMany({
        where: {
          tenant_id: tenantId,
          product_id: line.product_id,
          ...(line.variant_id ? { variant_id: line.variant_id } : {}),
          quantity: { gt: 0 },
        },
        orderBy: { received_at: 'asc' }, // FIFO
      });

      let remaining = line.quantity;

      for (const batch of batches) {
        if (remaining <= 0) break;
        const toDeduct = Math.min(remaining, batch.quantity);

        // Consume from FIFO batch
        await db.inventoryCostLayer.update({
          where: { id: batch.id },
          data: { quantity: { decrement: toDeduct } },
        });

        // Deduct from InventoryStock at the batch's location
        const stock = await db.inventoryStock.findFirst({
          where: {
            tenant_id: tenantId,
            product_id: line.product_id,
            location_id: batch.location_id,
            ...(line.variant_id ? { variant_id: line.variant_id } : {}),
          },
        });
        if (stock) {
          await db.inventoryStock.update({
            where: { id: stock.id },
            data: {
              quantity: { decrement: toDeduct },
              reserved_qty: { decrement: Math.min(toDeduct, stock.reserved_qty) },
            },
          });
        }

        // Record OUTBOUND transaction with FIFO batch + SO reference
        await db.inventoryTransaction.create({
          data: {
            tenant_id: tenantId,
            transaction_type: 'OUTBOUND',
            ...physicalStatusFor('OUTBOUND'),
            reference_type: 'SALES_ORDER',
            reference_id: order.id,
            reference_number: order.order_number,
            product_id: line.product_id,
            variant_id: line.variant_id ?? null,
            from_location_id: batch.location_id,
            quantity: toDeduct,
            unit_cost: line.unit_price ?? batch.unit_cost,
            notes: `FIFO: batch from ${batch.po_number ?? 'manual'} · SO ${order.order_number}`,
            performed_by: order.created_by,
          },
        });

        remaining -= toDeduct;
      }

      // Fallback: if no batches covered all qty, deduct from InventoryStock directly
      if (remaining > 0) {
        const stockRecords = await db.inventoryStock.findMany({
          where: {
            tenant_id: tenantId,
            product_id: line.product_id,
            ...(line.variant_id ? { variant_id: line.variant_id } : {}),
            reserved_qty: { gt: 0 },
          },
          orderBy: { updated_at: 'asc' },
          include: { location: true },
        });
        for (const stock of stockRecords) {
          if (remaining <= 0) break;
          const toDeduct = Math.min(remaining, stock.reserved_qty, stock.quantity);
          await db.inventoryStock.update({
            where: { id: stock.id },
            data: { quantity: { decrement: toDeduct }, reserved_qty: { decrement: toDeduct } },
          });
          await db.inventoryTransaction.create({
            data: {
              tenant_id: tenantId,
              transaction_type: 'OUTBOUND',
            ...physicalStatusFor('OUTBOUND'),
              reference_type: 'SALES_ORDER',
              reference_id: order.id,
              reference_number: order.order_number,
              product_id: line.product_id,
              variant_id: line.variant_id ?? null,
              from_location_id: stock.location_id,
              quantity: toDeduct,
              unit_cost: line.unit_price,
              notes: `SO ${order.order_number} (no batch)`,
              performed_by: order.created_by,
            },
          });
          remaining -= toDeduct;
        }
      }
    }
  }

  /**
   * receiveStock: also creates an InventoryCostLayer for FIFO costing.
   *
   * "Cost layer", not "batch": it records what this receipt cost and how much of
   * it is left to consume. A *batch* is a tracking dimension and is a different
   * concept entirely — see the model comment in schema.prisma. Migration 015.
   */
  async receiveStock(
    tenantId: string,
    productId: string,
    variantId: string | null,
    locationId: string,
    quantity: number,
    unitCost: number,
    referenceId: string,
    userId: string,
    poNumber?: string
  ) {
    // Update InventoryStock aggregate
    const existing = await db.inventoryStock.findFirst({
      where: { tenant_id: tenantId, product_id: productId, variant_id: variantId, location_id: locationId },
    });
    if (existing) {
      await db.inventoryStock.update({ where: { id: existing.id }, data: { quantity: { increment: quantity } } });
    } else {
      await db.inventoryStock.create({
        data: { tenant_id: tenantId, product_id: productId, variant_id: variantId, location_id: locationId, quantity, reserved_qty: 0 },
      });
    }

    // Create FIFO batch record
    await db.inventoryCostLayer.create({
      data: {
        tenant_id: tenantId,
        product_id: productId,
        variant_id: variantId,
        location_id: locationId,
        source_po_id: referenceId,
        po_number: poNumber ?? null,
        quantity,
        unit_cost: unitCost,
        received_at: new Date(),
      },
    });

    // Record INBOUND transaction with PO number
    await db.inventoryTransaction.create({
      data: {
        tenant_id: tenantId,
        transaction_type: 'INBOUND',
            ...physicalStatusFor('INBOUND'),
        reference_type: 'PURCHASE_ORDER',
        reference_id: referenceId,
        reference_number: poNumber ?? null,
        product_id: productId,
        variant_id: variantId,
        to_location_id: locationId,
        quantity,
        unit_cost: unitCost,
        notes: poNumber ? `PO ${poNumber}` : null,
        performed_by: userId,
      },
    });
  }

  async transferStock(tenantId: string, data: TransferDto, userId: string) {
    const stock = await db.inventoryStock.findFirst({
      where: {
        tenant_id: tenantId,
        product_id: data.product_id,
        location_id: data.from_location_id,
        ...(data.variant_id ? { variant_id: data.variant_id } : {}),
      },
    });

    if (!stock || (stock.quantity - stock.reserved_qty) < data.quantity) {
      throw new AppError('Insufficient stock at source location');
    }

    await db.$transaction(async (tx) => {
      await tx.inventoryStock.update({
        where: { id: stock.id },
        data: { quantity: { decrement: data.quantity } },
      });

      const destStock = await tx.inventoryStock.findFirst({
        where: { tenant_id: tenantId, product_id: data.product_id, variant_id: data.variant_id ?? null, location_id: data.to_location_id },
      });
      if (destStock) {
        await tx.inventoryStock.update({ where: { id: destStock.id }, data: { quantity: { increment: data.quantity } } });
      } else {
        await tx.inventoryStock.create({
          data: { tenant_id: tenantId, product_id: data.product_id, variant_id: data.variant_id ?? null, location_id: data.to_location_id, quantity: data.quantity, reserved_qty: 0 },
        });
      }

      // FIFO: transfer oldest batches first
      const batches = await tx.inventoryCostLayer.findMany({
        where: { tenant_id: tenantId, product_id: data.product_id, ...(data.variant_id ? { variant_id: data.variant_id } : {}), location_id: data.from_location_id, quantity: { gt: 0 } },
        orderBy: { received_at: 'asc' },
      });

      let remaining = data.quantity;
      for (const batch of batches) {
        if (remaining <= 0) break;
        const toMove = Math.min(remaining, batch.quantity);
        await tx.inventoryCostLayer.update({ where: { id: batch.id }, data: { quantity: { decrement: toMove } } });
        await tx.inventoryCostLayer.create({
          data: { tenant_id: tenantId, product_id: data.product_id, variant_id: data.variant_id ?? null, location_id: data.to_location_id, source_po_id: batch.source_po_id, po_number: batch.po_number, quantity: toMove, unit_cost: batch.unit_cost, received_at: batch.received_at },
        });
        remaining -= toMove;
      }

      await tx.inventoryTransaction.create({
        data: { tenant_id: tenantId, transaction_type: 'TRANSFER_OUT',
            ...physicalStatusFor('TRANSFER_OUT'), reference_type: 'transfer', product_id: data.product_id, variant_id: data.variant_id ?? null, from_location_id: data.from_location_id, to_location_id: data.to_location_id, quantity: data.quantity, notes: data.notes, performed_by: userId },
      });
      await tx.inventoryTransaction.create({
        data: { tenant_id: tenantId, transaction_type: 'TRANSFER_IN',
            ...physicalStatusFor('TRANSFER_IN'), reference_type: 'transfer', product_id: data.product_id, variant_id: data.variant_id ?? null, from_location_id: data.from_location_id, to_location_id: data.to_location_id, quantity: data.quantity, notes: data.notes, performed_by: userId },
      });
    });
  }

  async getTransactions(tenantId: string, filters: TransactionFilters) {
    const where: any = { tenant_id: tenantId };
    if (filters.product_id) where.product_id = filters.product_id;
    if (filters.variant_id) where.variant_id = filters.variant_id;
    if (filters.customer_id) {
      // filter by SO that belongs to this customer
      where.reference_type = 'SALES_ORDER';
      const soIds = await db.salesOrder.findMany({
        where: { tenant_id: tenantId, customer_id: filters.customer_id },
        select: { id: true },
      });
      where.reference_id = { in: soIds.map((s: any) => s.id) };
    }
    if (filters.supplier_id) {
      where.reference_type = 'PURCHASE_ORDER';
      const poIds = await db.purchaseOrder.findMany({
        where: { tenant_id: tenantId, supplier_id: filters.supplier_id },
        select: { id: true },
      });
      where.reference_id = { in: poIds.map((p: any) => p.id) };
    }
    if (filters.transaction_type) where.transaction_type = filters.transaction_type;
    if (filters.from) where.created_at = { gte: new Date(filters.from) };
    if (filters.to) where.created_at = { ...where.created_at, lte: new Date(filters.to) };

    return db.inventoryTransaction.findMany({
      where,
      include: {
        product: { select: { name: true, sku: true } },
        variant: { select: { sku_variant: true, attributes: true } },
        from_location: { select: { code: true } },
        to_location: { select: { code: true } },
      },
      orderBy: { created_at: 'desc' },
      skip: (Number(filters.page ?? 1) - 1) * Number(filters.limit ?? 100),
      take: Number(filters.limit ?? 100),
    });
  }
}

interface TransferDto {
  product_id: string;
  variant_id?: string;
  from_location_id: string;
  to_location_id: string;
  quantity: number;
  notes?: string;
}

interface TransactionFilters {
  product_id?: string;
  variant_id?: string;
  customer_id?: string;
  supplier_id?: string;
  transaction_type?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}
