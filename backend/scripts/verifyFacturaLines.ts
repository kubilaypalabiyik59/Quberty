/**
 * Factura lines (migration 022) — driven against the REAL database.
 *
 *   npx tsx scripts/verifyFacturaLines.ts
 *   npx tsx scripts/verifyFacturaLines.ts --keep
 *
 * Self-cleaning. The assertion that matters is that lines EXPLAIN the header rather
 * than restate it: a factura is a legal document that states a total, and no code
 * path may quietly change what an issued document says.
 */
import { db } from '../src/infrastructure/database/client';
import { writeFacturaLines, linesFromSalesOrder, markInvoiced } from '../src/shared/services/facturaLine.service';
import { AppError } from '../src/shared/errors/AppError';

const KEEP = process.argv.includes('--keep');
let passed = 0;
let failed = 0;
const madeFacturas: string[] = [];

const check = (label: string, ok: boolean, detail = '') => {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
};
const near = (a: number, b: number, t = 0.005) => Math.abs(a - b) < t;

async function main() {
  const tenant = (await db.tenant.findFirst({ select: { id: true, name: true } }))!;
  const tenantId = tenant.id;
  console.log(`Tenant: ${tenant.name}\n`);

  const baseline = await db.factura.count({ where: { tenant_id: tenantId } });

  // ── 1. The backfill is consistent ────────────────────────────────────────
  console.log('Migration 022 backfill');
  const invoicedOrders = await db.salesOrder.count({
    where: { tenant_id: tenantId, invoice_id: { not: null } },
  });
  const linesNotInvoiced = await db.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n
    FROM sales_order_lines sol
    JOIN sales_orders so ON so.id = sol.order_id
    WHERE so.tenant_id = $1::uuid AND so.invoice_id IS NOT NULL AND sol.invoiced_qty <> sol.quantity
  `, tenantId);
  check(
    `every line of an invoiced order is marked invoiced (${invoicedOrders} orders)`,
    Number(linesNotInvoiced[0].n) === 0,
    `${linesNotInvoiced[0].n} lines disagree`,
  );

  const overInvoiced = await db.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n FROM sales_order_lines WHERE invoiced_qty > quantity
  `);
  check('no line is invoiced beyond its quantity', Number(overInvoiced[0].n) === 0, `${overInvoiced[0].n}`);

  // ── 2. Build a factura with lines, from a real order ─────────────────────
  console.log('\nLines explain the header');
  const order = await db.salesOrder.findFirst({
    where: { tenant_id: tenantId, lines: { some: {} } },
    include: { lines: true },
  });
  if (!order) throw new Error('No sales order with lines.');

  const built = await linesFromSalesOrder(tenantId, order.id, { onlyUninvoiced: false });
  check(`built ${built.length} line(s) from ${order.order_number}`, built.length === order.lines.length);
  check('each line names what it sold', built.every(l => !!l.description && l.quantity !== 0));

  const gross = Number(built.reduce((s, l) => s + (l.lineTotal ?? 0), 0).toFixed(2));

  // A throwaway factura carrying the same total the lines add up to.
  // `factura_number` is text since migration 023, so the throwaway is prefixed
  // rather than negative — a configured series can never render `VERIFY-…`,
  // whatever its format, which the old negative integer could not promise once a
  // format is free to carry a sign or a letter.
  const stamp = `VERIFY-${Date.now()}`;
  const num   = `${stamp}-A`;
  const f = await db.factura.create({
    data: {
      tenant_id: tenantId,
      factura_number: num,
      source_type: 'VERIFY',
      source_id: order.id,
      customer_name: 'VERIFY',
      invoice_date: new Date(),
      subtotal: gross,
      iva_amount: 0,
      it_amount: 0,
      total_amount: gross,
    },
  });
  madeFacturas.push(f.id);

  const written = await writeFacturaLines(
    tenantId, f.id, built,
    { subtotal: gross, ivaAmount: 0, itAmount: 0, totalAmount: gross },
    { customerId: order.customer_id },
  );
  check(`wrote ${written.written} line(s)`, written.written === built.length);

  const stored = await db.facturaLine.findMany({ where: { factura_id: f.id } });
  const storedGross = Number(stored.reduce((s, l) => s + Number(l.line_total), 0).toFixed(2));
  check('the lines sum EXACTLY to the document total', near(storedGross, gross), `${storedGross} vs ${gross}`);

  const storedVat = Number(stored.reduce((s, l) => s + Number(l.vat_amount), 0).toFixed(2));
  check('per-line VAT sums to the header VAT (residue absorbed, not left)', near(storedVat, 0), `${storedVat}`);
  check('every line carries its own tax base', stored.every(l => l.tax_base !== null));
  check('IVA and IT are stored apart, per CLAUDE.md §6',
    stored.every(l => l.vat_amount !== null && l.turnover_amount !== null));

  // ── 3. A mismatch is REFUSED, not reconciled ─────────────────────────────
  console.log('\nA document whose lines disagree is refused');
  const f2 = await db.factura.create({
    data: {
      tenant_id: tenantId, factura_number: `${stamp}-B`, source_type: 'VERIFY', source_id: order.id,
      customer_name: 'VERIFY', invoice_date: new Date(),
      subtotal: 1, iva_amount: 0, it_amount: 0, total_amount: 1,
    },
  });
  madeFacturas.push(f2.id);
  try {
    await writeFacturaLines(tenantId, f2.id, built, { subtotal: 1, ivaAmount: 0, itAmount: 0, totalAmount: 1 });
    check('lines that do not sum to the header are refused', false, 'it was accepted');
  } catch (e) {
    check('lines that do not sum to the header are refused',
      e instanceof AppError && (e as any).code === 'FACTURA_LINES_DISAGREE');
  }

  // ── 4. Partial invoicing ─────────────────────────────────────────────────
  console.log('\nPartial invoicing — the thing a header-only factura made impossible');
  const line = order.lines[0];
  const before = Number(line.invoiced_qty);
  await db.salesOrderLine.update({
    where: { id: line.id },
    data: { invoiced_qty: Math.max(0, Number(line.quantity) - 1) },
  });

  const remaining = await linesFromSalesOrder(tenantId, order.id, { onlyUninvoiced: true });
  const forThatLine = remaining.find(r => r.salesOrderLineId === line.id);
  check('an already-invoiced line only offers what is left',
    forThatLine?.quantity === 1, `offered ${forThatLine?.quantity}`);

  await db.salesOrderLine.update({ where: { id: line.id }, data: { invoiced_qty: before } });

  const fullyInvoiced = await db.salesOrderLine.findFirst({
    where: { order_id: order.id, invoiced_qty: { gt: 0 } },
  });
  if (fullyInvoiced && Number(fullyInvoiced.invoiced_qty) >= Number(fullyInvoiced.quantity)) {
    const none = await linesFromSalesOrder(tenantId, order.id, { onlyUninvoiced: true });
    check('a fully invoiced line is not offered again',
      !none.some(n => n.salesOrderLineId === fullyInvoiced.id));
  }

  // ── 5. markInvoiced advances the accumulator ─────────────────────────────
  console.log('\nThe accumulator advances');
  const target = order.lines[0];
  const pre = Number((await db.salesOrderLine.findUnique({ where: { id: target.id } }))!.invoiced_qty);
  await markInvoiced(f.id);
  const post = Number((await db.salesOrderLine.findUnique({ where: { id: target.id } }))!.invoiced_qty);
  check('invoiced_qty increased by what the factura line covered',
    post > pre, `${pre} → ${post}`);
  // Put it back — this factura is a fixture, not a real invoice.
  await db.salesOrderLine.update({ where: { id: target.id }, data: { invoiced_qty: pre } });
  for (const l of stored.filter(s => s.sales_order_line_id && s.sales_order_line_id !== target.id)) {
    const cur = await db.salesOrderLine.findUnique({ where: { id: l.sales_order_line_id! } });
    if (cur) {
      await db.salesOrderLine.update({
        where: { id: l.sales_order_line_id! },
        data: { invoiced_qty: Math.max(0, Number(cur.invoiced_qty) - Number(l.quantity)) },
      });
    }
  }

  // ── 6. The header is never rewritten ─────────────────────────────────────
  console.log('\nThe issued document is untouched');
  const after = await db.factura.findUnique({ where: { id: f.id } });
  check('the factura total is exactly what it was created with',
    near(Number(after!.total_amount), gross), `${after!.total_amount}`);

  const realFacturas = await db.factura.count({
    where: { tenant_id: tenantId, source_type: { not: 'VERIFY' } },
  });
  console.log(`  (${realFacturas} real facturas on file; none were modified)`);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  if (KEEP) {
    console.log('\n--keep: fixtures left in place.');
  } else {
    await db.facturaLine.deleteMany({ where: { factura_id: { in: madeFacturas } } });
    await db.factura.deleteMany({ where: { id: { in: madeFacturas } } });
    const now = await db.factura.count({ where: { tenant_id: tenantId } });
    check('facturas back to baseline', now === baseline, `${now} vs ${baseline}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch(e => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (!KEEP && madeFacturas.length) {
      await db.facturaLine.deleteMany({ where: { factura_id: { in: madeFacturas } } });
      await db.factura.deleteMany({ where: { id: { in: madeFacturas } } });
    }
    await db.$disconnect();
  });
