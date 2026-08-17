import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';
import { physicalStatusFor } from '../../shared/services/inventoryTransactionStatus';

/**
 * Warehouse Management Service
 * Implements D365-inspired WMS concepts:
 * - Location Directives (where to put/pick)
 * - Work Templates (task sequences)
 * - Wave processing (batch picking)
 * - Arrival Journals (inbound receiving)
 */
export class WarehouseService {

  // =========================================================
  // LOCATION DIRECTIVES — rules engine for put-away & picking
  // =========================================================

  async resolvePutawayLocation(
    tenantId: string,
    warehouseId: string,
    productId: string,
    quantity: number
  ): Promise<string | null> {
    const directives = await db.locationDirective.findMany({
      where: {
        tenant_id: tenantId,
        warehouse_id: warehouseId,
        directive_type: 'PUTAWAY',
        is_active: true,
      },
      include: { lines: { include: { zone: true, location: true }, orderBy: { sequence: 'asc' } } },
      orderBy: { sequence: 'asc' },
    });

    for (const directive of directives) {
      for (const line of directive.lines) {
        if (Number(quantity) < Number(line.from_qty) || (line.to_qty && Number(quantity) > Number(line.to_qty))) continue;

        const location = await this.applyDirectiveStrategy(
          tenantId,
          line.strategy,
          line.zone_id,
          line.location_id,
          productId,
          quantity
        );

        if (location) return location;
      }
    }

    return null;
  }

  async resolvePickLocation(
    tenantId: string,
    warehouseId: string,
    productId: string,
    variantId: string | null,
    quantity: number
  ): Promise<{ location_id: string; available: number } | null> {
    // FIFO: pick from oldest-received location first
    const stocks = await db.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        product_id: productId,
        ...(variantId ? { variant_id: variantId } : {}),
        location: { zone: { warehouse_id: warehouseId } },
      },
      orderBy: { updated_at: 'asc' },
      include: { location: true },
    });

    const stock = stocks.find((s) => (s.quantity - s.reserved_qty) >= quantity);
    if (!stock) return null;

    return { location_id: stock.location_id, available: stock.quantity - stock.reserved_qty };
  }

  private async applyDirectiveStrategy(
    tenantId: string,
    strategy: string,
    zoneId: string | null,
    locationId: string | null,
    productId: string,
    quantity: number
  ): Promise<string | null> {
    if (locationId) {
      const loc = await db.warehouseLocation.findFirst({
        where: { id: locationId, is_active: true },
      });
      return loc?.id ?? null;
    }

    if (zoneId) {
      switch (strategy) {
        case 'CONSOLIDATE': {
          const existing = await db.inventoryStock.findFirst({
            where: {
              tenant_id: tenantId,
              product_id: productId,
              location: { zone_id: zoneId, is_active: true },
            },
            include: { location: true },
          });
          if (existing) return existing.location_id;
          // Fall through to EMPTY_LOCATION
        }
        case 'EMPTY_LOCATION': {
          const emptyLoc = await db.warehouseLocation.findFirst({
            where: {
              zone_id: zoneId,
              is_active: true,
              inventory_stock: { none: {} },
            },
          });
          return emptyLoc?.id ?? null;
        }
        default:
          return null;
      }
    }

    return null;
  }

  // =========================================================
  // WAVE PROCESSING — batch orders for efficient picking
  // =========================================================

  async addOrderToWave(tenantId: string, orderId: string, warehouseId: string) {
    let wave = await db.wave.findFirst({
      where: { tenant_id: tenantId, warehouse_id: warehouseId, status: 'OPEN' },
    });

    if (!wave) {
      const template = await db.waveTemplate.findFirst({
        where: { tenant_id: tenantId, warehouse_id: warehouseId },
      });

      wave = await db.wave.create({
        data: {
          tenant_id: tenantId,
          template_id: template?.id,
          warehouse_id: warehouseId,
          status: 'OPEN',
        },
      });
    }

    await db.salesOrder.update({
      where: { id: orderId },
      data: { wave_id: wave.id },
    });

    if (wave.template_id) {
      const template = await db.waveTemplate.findUnique({ where: { id: wave.template_id } });
      if (template?.auto_process) {
        await this.releaseWave(tenantId, wave.id);
      }
    }

    return wave;
  }

  async releaseWave(tenantId: string, waveId: string) {
    const wave = await db.wave.findFirst({
      where: { id: waveId, tenant_id: tenantId, status: 'OPEN' },
    });

    if (!wave) throw new AppError('Wave not found or already released', 404);

    const orders = await db.salesOrder.findMany({
      where: { wave_id: waveId, status: 'CONFIRMED' },
      include: { lines: true },
    });

    if (orders.length === 0) throw new AppError('No confirmed orders in wave');

    for (const order of orders) {
      await this.generatePickWork(tenantId, order, waveId);
    }

    await db.wave.update({
      where: { id: waveId },
      data: { status: 'RELEASED', released_at: new Date() },
    });

    return wave;
  }

  private async generatePickWork(tenantId: string, order: any, waveId: string) {
    const workCode = `WRK-${Date.now()}-${order.order_number}`;

    const work = await db.warehouseWork.create({
      data: {
        tenant_id: tenantId,
        work_id_code: workCode,
        work_type: 'PICK',
        status: 'OPEN',
        wave_id: waveId,
        warehouse_id: order.warehouse_id,
        reference_type: 'sales_order',
        reference_id: order.id,
        priority: 5,
      },
    });

    let sequence = 1;
    for (const line of order.lines) {
      const pickLocation = await this.resolvePickLocation(
        tenantId,
        order.warehouse_id,
        line.product_id,
        line.variant_id,
        line.quantity
      );

      await db.warehouseWorkLine.create({
        data: {
          work_id: work.id,
          sequence: sequence++,
          line_type: 'PICK',
          product_id: line.product_id,
          variant_id: line.variant_id,
          quantity: line.quantity,
          from_location_id: pickLocation?.location_id,
          status: 'PENDING',
        },
      });

      const shippingZone = await db.warehouseZone.findFirst({
        where: {
          tenant_id: tenantId,
          warehouse_id: order.warehouse_id,
          zone_type: 'shipping',
        },
      });

      const stagingLocation = shippingZone
        ? await db.warehouseLocation.findFirst({
            where: { zone_id: shippingZone.id, is_active: true },
          })
        : null;

      await db.warehouseWorkLine.create({
        data: {
          work_id: work.id,
          sequence: sequence++,
          line_type: 'PUT',
          product_id: line.product_id,
          variant_id: line.variant_id,
          quantity: line.quantity,
          to_location_id: stagingLocation?.id,
          status: 'PENDING',
        },
      });
    }

    return work;
  }

  // =========================================================
  // ARRIVAL JOURNALS — inbound receiving
  // =========================================================

  async postArrivalJournal(tenantId: string, journalId: string, userId: string) {
    const journal = await db.arrivalJournal.findFirst({
      where: { id: journalId, tenant_id: tenantId, status: 'DRAFT' },
      include: { lines: true, purchase_order: true },
    });

    if (!journal) throw new AppError('Arrival journal not found or already posted', 404);

    const inventoryService = await import('../inventory/inventory.service').then(
      (m) => new m.InventoryService()
    );

    for (const line of journal.lines) {
      if (Number(line.received_qty) === 0) continue;

      let locationId = line.receive_location_id;

      if (!locationId) {
        locationId = await this.resolvePutawayLocation(
          tenantId,
          journal.warehouse_id,
          line.product_id,
          Number(line.received_qty)
        );
      }

      if (!locationId) {
        const receiveZone = await db.warehouseZone.findFirst({
          where: { tenant_id: tenantId, warehouse_id: journal.warehouse_id, zone_type: 'receive' },
        });
        const receiveLoc = await db.warehouseLocation.findFirst({
          where: { zone_id: receiveZone?.id, is_active: true },
        });
        locationId = receiveLoc?.id ?? null;
      }

      if (!locationId) throw new AppError('Cannot determine put-away location for received stock');

      const poLine = (journal.purchase_order as any)?.lines?.find(
        (l: any) => l.product_id === line.product_id && l.variant_id === line.variant_id
      );

      await inventoryService.receiveStock(
        tenantId,
        line.product_id,
        line.variant_id,
        locationId,
        Number(line.received_qty),
        poLine?.unit_cost ?? 0,
        journal.purchase_order_id ?? journalId,
        userId
      );

      await this.generatePutawayWork(tenantId, journal, line, locationId);
    }

    await db.arrivalJournal.update({
      where: { id: journalId },
      data: { status: 'POSTED', posted_at: new Date() },
    });

    if (journal.purchase_order_id) {
      await this.updatePOReceiptStatus(tenantId, journal.purchase_order_id);
    }
  }

  private async generatePutawayWork(
    tenantId: string,
    journal: any,
    line: any,
    targetLocationId: string
  ) {
    const workCode = `WRK-PA-${Date.now()}-${line.id}`;

    await db.warehouseWork.create({
      data: {
        tenant_id: tenantId,
        work_id_code: workCode,
        work_type: 'PUTAWAY',
        status: 'OPEN',
        warehouse_id: journal.warehouse_id,
        reference_type: 'arrival_journal',
        reference_id: journal.id,
        priority: 3,
        lines: {
          create: [
            {
              sequence: 1,
              line_type: 'PICK',
              product_id: line.product_id,
              variant_id: line.variant_id,
              quantity: line.received_qty,
              status: 'PENDING',
            },
            {
              sequence: 2,
              line_type: 'PUT',
              product_id: line.product_id,
              variant_id: line.variant_id,
              quantity: line.received_qty,
              to_location_id: targetLocationId,
              status: 'PENDING',
            },
          ],
        },
      },
    });
  }

  private async updatePOReceiptStatus(tenantId: string, poId: string) {
    const po = await db.purchaseOrder.findFirst({
      where: { id: poId, tenant_id: tenantId },
      include: { lines: true },
    });
    if (!po) return;

    const allReceived = po.lines.every((l: any) => Number(l.received_qty) >= Number(l.quantity));
    const anyReceived = po.lines.some((l: any) => Number(l.received_qty) > 0);

    await db.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : po.status,
      },
    });
  }

  // =========================================================
  // WORK EXECUTION — workers complete tasks
  // =========================================================

  /**
   * Complete one line of warehouse work — and actually move the inventory.
   *
   * ── What was wrong ────────────────────────────────────────────────────────
   * This method used to set `quantity_done` and a status and stop there. It moved
   * NO stock. So a putaway could be created, shown to a worker, and completed,
   * while the goods stayed exactly where they were — work that reports success and
   * changes nothing. That is why stock received into `RCV-001` never became
   * pickable no matter what anybody did in the UI.
   *
   * ── **[OFFICIAL]** what completing a PUT means ────────────────────────────
   * "the receipt is posted first to record the increase of inventory … The
   * warehouse worker then registers the put-away to make the items available to
   * pick" — the putaway is the step that makes stock available, so it has to be the
   * step that moves it.
   *   learn.microsoft.com/dynamics365/business-central/design-details-inbound-warehouse-flow
   *
   * A movement is recorded as an inventory transaction pair on the subledger
   * (TRANSFER_OUT / TRANSFER_IN) so the move is auditable, rather than stock rows
   * silently changing value.
   */
  async completeWorkLine(
    tenantId: string,
    workId: string,
    lineId: string,
    quantityDone: number,
    userId: string
  ) {
    return db.$transaction(async (tx) => {
      const work = await tx.warehouseWork.findFirst({
        where: { id: workId, tenant_id: tenantId },
        include: { lines: { orderBy: { sequence: 'asc' } } },
      });

      if (!work) throw new AppError('Work task not found', 404);

      const line = work.lines.find((l: any) => l.id === lineId);
      if (!line) throw new AppError('Work line not found', 404);
      if (line.status === 'DONE') {
        throw new AppError(
          `Work line ${line.sequence} of ${work.work_id_code} is already complete. ` +
            `Completing it twice would move the stock twice.`,
          409,
          'WORK_LINE_ALREADY_DONE',
        );
      }
      if (quantityDone <= 0) {
        throw new AppError('A completed work line must move a positive quantity.', 400);
      }
      if (quantityDone > Number(line.quantity)) {
        throw new AppError(
          `Cannot complete ${quantityDone} on a work line for ${line.quantity}. ` +
            `Over-picking is a different decision and is not supported here.`,
          400,
          'WORK_LINE_OVER_COMPLETION',
        );
      }

      // ── The movement ──────────────────────────────────────────────────────
      // A PUT line carries the destination; the source is the line's own
      // `from_location_id`, or — for putaway — the PICK line that precedes it.
      // **[OFFICIAL]** "during purchase registration, the first pick is always from
      // the location where the registration occurs", which is why the source is
      // recorded on the work rather than resolved by a directive.
      if (line.line_type === 'PUT' && line.to_location_id) {
        const source =
          line.from_location_id ??
          work.lines.find((l: any) => l.line_type === 'PICK' && l.from_location_id)?.from_location_id ??
          null;

        if (!source) {
          throw new AppError(
            `Work ${work.work_id_code} has no source location, so its put cannot be completed. ` +
              `Putaway work must record where the goods are being taken from.`,
            409,
            'WORK_SOURCE_LOCATION_MISSING',
          );
        }

        await this.moveStock(tx, {
          tenantId,
          productId: line.product_id,
          variantId: line.variant_id ?? null,
          fromLocationId: source,
          toLocationId: line.to_location_id,
          quantity: quantityDone,
          userId,
          reference: work.work_id_code,
          workType: work.work_type,
        });
      }

      await tx.warehouseWorkLine.update({
        where: { id: lineId },
        data: {
          quantity_done: quantityDone,
          status: quantityDone >= Number(line.quantity) ? 'DONE' : 'SHORT',
          completed_at: new Date(),
        },
      });

      const allDone = work.lines
        .filter((l: any) => l.id !== lineId)
        .every((l: any) => l.status === 'DONE') && quantityDone >= Number(line.quantity);

      if (allDone) {
        await tx.warehouseWork.update({
          where: { id: workId },
          data: { status: 'COMPLETED', completed_at: new Date() },
        });

        if (work.work_type === 'PICK' && work.reference_type === 'sales_order') {
          await tx.salesOrder.update({
            where: { id: work.reference_id! },
            data: { status: 'PICKING' },
          });
        }
      }

      return { moved: line.line_type === 'PUT' ? quantityDone : 0, work_completed: allDone };
    });
  }

  /**
   * Move stock between two locations, with a subledger record of the move.
   *
   * Refuses rather than going negative: a move that cannot be sourced is a data
   * problem, and letting it proceed would turn one wrong number into two.
   */
  private async moveStock(
    tx: any,
    m: {
      tenantId: string;
      productId: string;
      variantId: string | null;
      fromLocationId: string;
      toLocationId: string;
      quantity: number;
      userId: string;
      reference: string;
      workType: string;
    },
  ) {
    if (m.fromLocationId === m.toLocationId) return;

    const from = await tx.inventoryStock.findFirst({
      where: {
        tenant_id: m.tenantId,
        product_id: m.productId,
        variant_id: m.variantId,
        location_id: m.fromLocationId,
      },
    });

    const availableAtSource = from ? from.quantity - from.reserved_qty : 0;
    if (availableAtSource < m.quantity) {
      throw new AppError(
        `Cannot move ${m.quantity}: only ${availableAtSource} is available at the source location. ` +
          `The work was created against stock that has since moved or been reserved.`,
        409,
        'WORK_SOURCE_STOCK_INSUFFICIENT',
      );
    }

    await tx.inventoryStock.update({
      where: { id: from!.id },
      data: { quantity: { decrement: m.quantity } },
    });

    // Not an upsert: the compound unique includes the nullable `variant_id`, and
    // Prisma refuses null in a compound-unique `where`. A product with no variants
    // is the common case here, so the upsert form fails exactly where it is needed
    // most.
    const destination = await tx.inventoryStock.findFirst({
      where: {
        tenant_id: m.tenantId,
        product_id: m.productId,
        variant_id: m.variantId,
        location_id: m.toLocationId,
      },
    });

    if (destination) {
      await tx.inventoryStock.update({
        where: { id: destination.id },
        data: { quantity: { increment: m.quantity } },
      });
    } else {
      await tx.inventoryStock.create({
        data: {
          tenant_id: m.tenantId,
          product_id: m.productId,
          variant_id: m.variantId,
          location_id: m.toLocationId,
          quantity: m.quantity,
        },
      });
    }

    // The cost layers move with the goods, oldest first. Without this the FIFO
    // layers keep pointing at the receiving dock while the stock is on the shelf,
    // and the two subledgers disagree about where the same units are.
    let remaining = m.quantity;
    const layers = await tx.inventoryCostLayer.findMany({
      where: {
        tenant_id: m.tenantId,
        product_id: m.productId,
        variant_id: m.variantId,
        location_id: m.fromLocationId,
        quantity: { gt: 0 },
      },
      orderBy: { received_at: 'asc' },
    });
    for (const layer of layers) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, layer.quantity);
      await tx.inventoryCostLayer.update({
        where: { id: layer.id },
        data: { quantity: { decrement: take } },
      });
      await tx.inventoryCostLayer.create({
        data: {
          tenant_id: m.tenantId,
          product_id: m.productId,
          variant_id: m.variantId,
          location_id: m.toLocationId,
          source_po_id: layer.source_po_id,
          po_number: layer.po_number,
          quantity: take,
          unit_cost: layer.unit_cost,
          received_at: layer.received_at, // keeps FIFO age; a move is not a receipt
        },
      });
      remaining -= take;
    }

    // Two transactions, one out and one in — the shape D365 uses for a transfer,
    // and what makes the move auditable instead of a stock row quietly changing.
    for (const [type, from_location_id, to_location_id] of [
      ['TRANSFER_OUT', m.fromLocationId, m.toLocationId],
      ['TRANSFER_IN', m.fromLocationId, m.toLocationId],
    ] as const) {
      await tx.inventoryTransaction.create({
        data: {
          tenant_id: m.tenantId,
          transaction_type: type,
          ...physicalStatusFor(type),
          reference_type: 'WAREHOUSE_WORK',
          reference_number: m.reference,
          product_id: m.productId,
          variant_id: m.variantId,
          from_location_id,
          to_location_id,
          quantity: m.quantity,
          notes: `${m.workType} — ${m.reference}`,
          performed_by: m.userId,
        },
      });
    }
  }
}
