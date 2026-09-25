import { db } from '../../infrastructure/database/client';
import { moveStock } from '../../shared/services/stockLedger.service';
import { AppError } from '../../shared/errors/AppError';
import { logger } from '../../shared/logger';
import { physicalStatusFor } from '../../shared/services/inventoryTransactionStatus';
import { resolveItemPolicies } from '../../shared/services/itemPolicy.service';
import { getLedgerCurrencies } from '../../shared/services/currency/ledgerCurrency.service';
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
        original_quantity: quantity,
        unit_cost: unitCost,
        cost_currency_code: (await getLedgerCurrencies(tenantId)).accountingCurrency,
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

  /**
   * Move stock between two locations of the tenant, with its cost layers, in one
   * locked transaction (WORK-043). Only unreserved stock moves; the same location
   * on both sides is refused.
   */
  async transferStock(tenantId: string, data: TransferDto, userId: string) {
    const quantity = Number(data.quantity);
    await db.$transaction((tx) => moveStock(tx, {
      tenantId,
      productId: data.product_id,
      variantId: data.variant_id ?? null,
      fromLocationId: data.from_location_id,
      toLocationId: data.to_location_id,
      quantity,
      userId,
      referenceType: 'transfer',
      referenceNumber: null,
      notes: data.notes ?? null,
    }));
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
