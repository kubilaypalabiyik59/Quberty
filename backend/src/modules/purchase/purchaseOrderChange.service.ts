import { Prisma } from '@prisma/client';
import { db } from '../../infrastructure/database/client';
import { AppError } from '../../shared/errors/AppError';

const EPSILON = 1e-9;

type QuantityLine = {
  id: string;
  quantity: Prisma.Decimal | number;
  received_qty: Prisma.Decimal | number;
  invoiced_qty: Prisma.Decimal | number;
  cancelled_qty: Prisma.Decimal | number;
};

export function effectiveOrderedQuantity(line: QuantityLine): number {
  return Number(line.quantity) - Number(line.cancelled_qty);
}

export function cancellableQuantity(line: QuantityLine): number {
  return Math.max(
    0,
    effectiveOrderedQuantity(line) - Math.max(Number(line.received_qty), Number(line.invoiced_qty)),
  );
}

function requiredReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 3) {
    throw new AppError('A change reason of at least 3 characters is required.', 400, 'CHANGE_REASON_REQUIRED');
  }
  return reason;
}

function positiveQuantity(value: unknown): number {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || Math.round(quantity * 100) !== quantity * 100) {
    throw new AppError('Cancellation quantity must be positive with at most two decimal places.', 400, 'INVALID_CANCEL_QUANTITY');
  }
  return quantity;
}

function isoDate(value: unknown, field: string): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(`${field} must be a date in YYYY-MM-DD format.`, 400, 'INVALID_DELIVERY_DATE');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AppError(`${field} is not a valid calendar date.`, 400, 'INVALID_DELIVERY_DATE');
  }
  return date;
}

function nextOrderStatus(lines: QuantityLine[], current: string): string {
  const allCancelled = lines.every(line => effectiveOrderedQuantity(line) <= EPSILON);
  if (allCancelled) return 'CANCELLED';

  const allReceived = lines.every(
    line => Number(line.received_qty) >= effectiveOrderedQuantity(line) - EPSILON,
  );
  const allInvoiced = lines.every(
    line => Number(line.invoiced_qty) >= effectiveOrderedQuantity(line) - EPSILON,
  );
  if (allReceived && allInvoiced) return 'INVOICED';
  if (allReceived) return 'RECEIVED';
  if (lines.some(line => Number(line.received_qty) > EPSILON)) return 'PARTIALLY_RECEIVED';
  return current === 'DRAFT' ? 'DRAFT' : 'CONFIRMED';
}

async function lockOrder(tx: Prisma.TransactionClient, tenantId: string, orderId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string; expected_date: Date | null }>>(Prisma.sql`
    SELECT id, status, expected_date
    FROM purchase_orders
    WHERE id = ${orderId}::uuid AND tenant_id = ${tenantId}::uuid
    FOR UPDATE
  `);
  if (rows.length !== 1) throw new AppError('Purchase order not found.', 404, 'PURCHASE_ORDER_NOT_FOUND');
  return rows[0];
}

async function lockLines(tx: Prisma.TransactionClient, orderId: string, lineId?: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM purchase_order_lines
    WHERE po_id = ${orderId}::uuid
      ${lineId ? Prisma.sql`AND id = ${lineId}::uuid` : Prisma.empty}
    ORDER BY id
    FOR UPDATE
  `);
  if (lineId && rows.length !== 1) {
    throw new AppError('Purchase order line not found.', 404, 'PURCHASE_ORDER_LINE_NOT_FOUND');
  }
}

export async function cancelPurchaseOrderRemainder(input: {
  tenantId: string;
  orderId: string;
  lineId?: string;
  quantity?: unknown;
  reason: unknown;
  userId?: string | null;
}) {
  const reason = requiredReason(input.reason);
  const requestedQuantity = input.lineId ? positiveQuantity(input.quantity) : null;

  return db.$transaction(async tx => {
    const order = await lockOrder(tx, input.tenantId, input.orderId);
    if (!['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
      throw new AppError(
        'Only a confirmed or partially received purchase order has an open remainder to cancel.',
        409,
        'ORDER_REMAINDER_NOT_CANCELLABLE',
      );
    }
    await lockLines(tx, input.orderId, input.lineId);

    const lines = await tx.purchaseOrderLine.findMany({
      where: { po_id: input.orderId },
      orderBy: { id: 'asc' },
    });
    const selected = input.lineId ? lines.filter(line => line.id === input.lineId) : lines;
    const before = selected.map(line => ({
      line_id: line.id,
      ordered_qty: Number(line.quantity),
      received_qty: Number(line.received_qty),
      invoiced_qty: Number(line.invoiced_qty),
      cancelled_qty: Number(line.cancelled_qty),
      effective_qty: effectiveOrderedQuantity(line),
    }));

    let changed = 0;
    for (const line of selected) {
      const available = cancellableQuantity(line);
      const amount = requestedQuantity ?? available;
      if (amount <= EPSILON) continue;
      if (amount > available + EPSILON) {
        throw new AppError(
          `Cannot cancel ${amount}; only ${Number(available.toFixed(2))} remains unreceived and uninvoiced.`,
          409,
          'CANCEL_QUANTITY_EXCEEDS_REMAINDER',
        );
      }
      await tx.purchaseOrderLine.update({
        where: { id: line.id },
        data: { cancelled_qty: { increment: amount } },
      });
      changed++;
    }
    if (changed === 0) {
      throw new AppError('No unreceived and uninvoiced quantity remains to cancel.', 409, 'NOTHING_TO_CANCEL');
    }

    const refreshed = await tx.purchaseOrderLine.findMany({
      where: { po_id: input.orderId },
      orderBy: { id: 'asc' },
    });
    const nextStatus = nextOrderStatus(refreshed, order.status);
    if (nextStatus !== order.status) {
      await tx.purchaseOrder.update({ where: { id: input.orderId }, data: { status: nextStatus } });
    }

    const changedIds = new Set(selected.map(line => line.id));
    const after = refreshed.filter(line => changedIds.has(line.id)).map(line => ({
      line_id: line.id,
      ordered_qty: Number(line.quantity),
      received_qty: Number(line.received_qty),
      invoiced_qty: Number(line.invoiced_qty),
      cancelled_qty: Number(line.cancelled_qty),
      effective_qty: effectiveOrderedQuantity(line),
    }));
    const action = input.lineId ? 'LINE_REMAINDER_CANCELLED' : 'ORDER_REMAINDER_CANCELLED';
    await tx.purchaseOrderChange.create({
      data: {
        tenant_id: input.tenantId,
        purchase_order_id: input.orderId,
        line_id: input.lineId ?? null,
        action,
        reason,
        before_snapshot: { status: order.status, lines: before },
        after_snapshot: { status: nextStatus, lines: after },
        changed_by: input.userId ?? null,
      },
    });
    return { status: nextStatus, lines: refreshed };
  }, { timeout: 30_000, maxWait: 10_000 });
}

export async function updatePurchaseOrderDelivery(input: {
  tenantId: string;
  orderId: string;
  requestedDeliveryDate?: unknown;
  confirmedDeliveryDate?: unknown;
  reason: unknown;
  userId?: string | null;
}) {
  const reason = requiredReason(input.reason);
  const requested = isoDate(input.requestedDeliveryDate, 'requested_delivery_date');
  const confirmed = isoDate(input.confirmedDeliveryDate, 'confirmed_delivery_date');
  if (requested === undefined && confirmed === undefined) {
    throw new AppError('Provide a requested or confirmed delivery date.', 400, 'DELIVERY_DATE_REQUIRED');
  }

  return db.$transaction(async tx => {
    const order = await lockOrder(tx, input.tenantId, input.orderId);
    if (!['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
      throw new AppError('Delivery dates can only be changed while a purchase order remains open.', 409, 'ORDER_NOT_OPEN');
    }
    await lockLines(tx, input.orderId);
    const lines = await tx.purchaseOrderLine.findMany({ where: { po_id: input.orderId }, orderBy: { id: 'asc' } });
    const openLines = lines.filter(line => cancellableQuantity(line) > EPSILON);
    if (openLines.length === 0) throw new AppError('No open purchase lines remain.', 409, 'NO_OPEN_PURCHASE_LINES');

    const before = {
      expected_date: order.expected_date?.toISOString().slice(0, 10) ?? null,
      lines: openLines.map(line => ({
        line_id: line.id,
        requested_delivery_date: line.requested_delivery_date?.toISOString().slice(0, 10) ?? null,
        confirmed_delivery_date: line.confirmed_delivery_date?.toISOString().slice(0, 10) ?? null,
      })),
    };

    if (requested !== undefined) {
      await tx.purchaseOrder.update({ where: { id: input.orderId }, data: { expected_date: requested } });
    }
    await tx.purchaseOrderLine.updateMany({
      where: { id: { in: openLines.map(line => line.id) } },
      data: {
        ...(requested !== undefined && { requested_delivery_date: requested }),
        ...(confirmed !== undefined && { confirmed_delivery_date: confirmed }),
      },
    });

    const after = {
      expected_date: requested === undefined
        ? before.expected_date
        : requested?.toISOString().slice(0, 10) ?? null,
      lines: openLines.map(line => ({
        line_id: line.id,
        requested_delivery_date: requested === undefined
          ? line.requested_delivery_date?.toISOString().slice(0, 10) ?? null
          : requested?.toISOString().slice(0, 10) ?? null,
        confirmed_delivery_date: confirmed === undefined
          ? line.confirmed_delivery_date?.toISOString().slice(0, 10) ?? null
          : confirmed?.toISOString().slice(0, 10) ?? null,
      })),
    };
    if (JSON.stringify(before) === JSON.stringify(after)) {
      throw new AppError('The delivery dates are unchanged.', 409, 'DELIVERY_DATES_UNCHANGED');
    }

    await tx.purchaseOrderChange.create({
      data: {
        tenant_id: input.tenantId,
        purchase_order_id: input.orderId,
        action: 'DELIVERY_UPDATED',
        reason,
        before_snapshot: before,
        after_snapshot: after,
        changed_by: input.userId ?? null,
      },
    });
    return after;
  }, { timeout: 30_000, maxWait: 10_000 });
}
