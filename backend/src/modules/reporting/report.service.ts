import { db } from '../../infrastructure/database/client';

export class ReportService {

  async getMonthlySales(tenantId: string, filters: ReportFilters) {
    const result = await db.$queryRaw<MonthlySalesRow[]>`
      SELECT
        date_trunc('month', so.created_at) AS month,
        s.city,
        s.name AS site_name,
        COUNT(DISTINCT so.id)::int AS order_count,
        SUM(so.total_amount) AS revenue,
        SUM(so.discount_amount) AS discounts,
        COUNT(DISTINCT so.customer_id)::int AS unique_customers
      FROM sales_orders so
      LEFT JOIN sites s ON s.id = so.site_id
      WHERE so.tenant_id::text = ${tenantId}
        AND so.status IN ('SHIPPED', 'COMPLETED')
        AND so.created_at >= ${new Date(filters.from)}
        AND so.created_at <= ${new Date(filters.to)}
      GROUP BY 1, 2, 3
      ORDER BY 1 DESC, 4 DESC
    `;

    return result;
  }

  async getTopProducts(tenantId: string, filters: ReportFilters, limit = 20) {
    const result = await db.$queryRaw<TopProductRow[]>`
      SELECT
        p.id,
        p.sku,
        p.name,
        p.selling_price,
        p.cost_price,
        SUM(sol.quantity)::int AS units_sold,
        SUM(sol.line_total) AS revenue,
        SUM(sol.quantity * p.cost_price) AS cogs,
        SUM(sol.line_total) - SUM(sol.quantity * COALESCE(p.cost_price, 0)) AS gross_profit,
        CASE
          WHEN SUM(sol.line_total) > 0
          THEN ROUND(
            (SUM(sol.line_total) - SUM(sol.quantity * COALESCE(p.cost_price, 0))) / SUM(sol.line_total) * 100, 2
          )
          ELSE 0
        END AS margin_pct
      FROM sales_order_lines sol
      JOIN products p ON p.id = sol.product_id
      JOIN sales_orders so ON so.id = sol.order_id
      WHERE so.tenant_id::text = ${tenantId}
        AND so.status IN ('SHIPPED', 'COMPLETED')
        AND so.created_at >= ${new Date(filters.from)}
        AND so.created_at <= ${new Date(filters.to)}
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY units_sold DESC
      LIMIT ${limit}
    `;

    return result;
  }

  async getSalesByCity(tenantId: string, filters: ReportFilters) {
    const result = await db.$queryRaw<SalesByCityRow[]>`
      SELECT
        s.city,
        s.name AS site_name,
        COUNT(DISTINCT so.id)::int AS order_count,
        SUM(so.total_amount) AS revenue,
        AVG(so.total_amount) AS avg_order_value
      FROM sales_orders so
      JOIN sites s ON s.id = so.site_id
      WHERE so.tenant_id::text = ${tenantId}
        AND so.status IN ('SHIPPED', 'COMPLETED')
        AND so.created_at >= ${new Date(filters.from)}
        AND so.created_at <= ${new Date(filters.to)}
      GROUP BY 1, 2
      ORDER BY revenue DESC
    `;

    return result;
  }

  async getInventoryTurnover(tenantId: string, filters: ReportFilters) {
    // Turnover = COGS / Average Inventory Value
    const result = await db.$queryRaw<InventoryTurnoverRow[]>`
      SELECT
        p.id,
        p.sku,
        p.name,
        SUM(it.quantity * it.unit_cost) AS cogs,
        (
          SELECT SUM(ins.quantity * p2.cost_price)
          FROM inventory_stock ins
          JOIN products p2 ON p2.id = ins.product_id
          WHERE ins.tenant_id::text = ${tenantId} AND ins.product_id = p.id
        ) AS current_inventory_value,
        CASE
          WHEN SUM(it.quantity * it.unit_cost) > 0
          THEN ROUND(
            SUM(it.quantity * it.unit_cost) /
            NULLIF((
              SELECT SUM(ins.quantity * p2.cost_price)
              FROM inventory_stock ins
              JOIN products p2 ON p2.id = ins.product_id
              WHERE ins.tenant_id::text = ${tenantId} AND ins.product_id = p.id
            ), 0), 2
          )
          ELSE 0
        END AS turnover_ratio
      FROM inventory_transactions it
      JOIN products p ON p.id = it.product_id
      WHERE it.tenant_id::text = ${tenantId}
        AND it.transaction_type = 'OUTBOUND'
        AND it.created_at >= ${new Date(filters.from)}
        AND it.created_at <= ${new Date(filters.to)}
      GROUP BY 1, 2, 3
      ORDER BY turnover_ratio DESC
    `;

    return result;
  }

  async getMonthOnMonthGrowth(tenantId: string) {
    const result = await db.$queryRaw<GrowthRow[]>`
      WITH monthly AS (
        SELECT
          date_trunc('month', created_at) AS month,
          SUM(total_amount) AS revenue,
          COUNT(*)::int AS orders
        FROM sales_orders
        WHERE tenant_id::text = ${tenantId}
          AND status IN ('SHIPPED', 'COMPLETED')
          AND created_at >= NOW() - INTERVAL '13 months'
        GROUP BY 1
      )
      SELECT
        month,
        revenue,
        orders,
        LAG(revenue) OVER (ORDER BY month) AS prev_revenue,
        CASE
          WHEN LAG(revenue) OVER (ORDER BY month) > 0
          THEN ROUND(
            (revenue - LAG(revenue) OVER (ORDER BY month)) /
            LAG(revenue) OVER (ORDER BY month) * 100, 2
          )
          ELSE NULL
        END AS growth_pct
      FROM monthly
      ORDER BY month DESC
    `;

    return result;
  }

  async getPurchasesSummary(tenantId: string, filters: ReportFilters) {
    const result = await db.$queryRaw<PurchaseSummaryRow[]>`
      SELECT
        date_trunc('month', po.created_at) AS month,
        sup.name AS supplier_name,
        COUNT(DISTINCT po.id)::int AS po_count,
        SUM(po.total_amount) AS total_spend
      FROM purchase_orders po
      JOIN suppliers sup ON sup.id = po.supplier_id
      WHERE po.tenant_id::text = ${tenantId}
        AND po.status IN ('RECEIVED', 'PARTIALLY_RECEIVED')
        AND po.created_at >= ${new Date(filters.from)}
        AND po.created_at <= ${new Date(filters.to)}
      GROUP BY 1, 2
      ORDER BY 1 DESC, 4 DESC
    `;

    return result;
  }

  async getDailyRevenue(tenantId: string, year: number, month: number) {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);

    const result = await db.$queryRaw<{ day: Date; revenue: number; order_count: number }[]>`
      SELECT
        date_trunc('day', so.created_at) AS day,
        COALESCE(SUM(so.total_amount), 0) AS revenue,
        COUNT(DISTINCT so.id)::int AS order_count
      FROM sales_orders so
      WHERE so.tenant_id::text = ${tenantId}
        AND so.status NOT IN ('CANCELLED', 'DRAFT')
        AND so.created_at >= ${from}
        AND so.created_at <= ${to}
      GROUP BY 1
      ORDER BY 1 ASC
    `;
    return result;
  }

  async getDashboardSummary(tenantId: string) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [
      revenueThisMonth,
      revenuePrevMonth,
      totalOrders,
      pendingOrders,
      totalCustomers,
      inventoryItemCount,
      unpaidAR,
      unpaidAP,
      recentOrders,
      recentJournalEntries,
    ] = await Promise.all([
      // Revenue this month (all non-cancelled orders)
      db.salesOrder.aggregate({
        where: { tenant_id: tenantId, status: { notIn: ['CANCELLED', 'DRAFT'] }, created_at: { gte: monthStart } },
        _sum: { total_amount: true },
      }),
      // Revenue last month
      db.salesOrder.aggregate({
        where: { tenant_id: tenantId, status: { notIn: ['CANCELLED', 'DRAFT'] }, created_at: { gte: prevMonthStart, lte: prevMonthEnd } },
        _sum: { total_amount: true },
      }),
      // Total orders this month
      db.salesOrder.count({
        where: { tenant_id: tenantId, created_at: { gte: monthStart }, status: { not: 'CANCELLED' } },
      }),
      // Pending orders (confirmed/packed/shipped)
      db.salesOrder.count({
        where: { tenant_id: tenantId, status: { in: ['CONFIRMED', 'PACKED', 'SHIPPED'] } },
      }),
      // Total customers
      db.customer.count({ where: { tenant_id: tenantId } }),
      // Inventory items on hand
      db.inventoryStock.aggregate({
        where: { tenant_id: tenantId },
        _sum: { quantity: true },
      }),
      // Unpaid AR (invoiced but not paid)
      db.salesOrder.aggregate({
        where: { tenant_id: tenantId, invoice_id: { not: null }, paid_at: null, status: { notIn: ['CANCELLED', 'DRAFT'] } },
        _sum: { total_amount: true },
      }),
      // Unpaid AP (received POs not paid)
      db.purchaseOrder.aggregate({
        where: { tenant_id: tenantId, status: 'RECEIVED', paid_at: null },
        _sum: { total_amount: true },
      }),
      // Recent sales orders
      db.salesOrder.findMany({
        where: { tenant_id: tenantId },
        include: { customer: { select: { first_name: true, last_name: true } } },
        orderBy: { created_at: 'desc' },
        take: 6,
      }),
      // Recent journal entries
      db.journalEntry.findMany({
        where: { tenant_id: tenantId, status: 'POSTED' },
        orderBy: { entry_date: 'desc' },
        take: 5,
        select: { entry_number: true, description: true, entry_date: true, source_module: true },
      }),
    ]);

    const thisMonthRev = Number(revenueThisMonth._sum.total_amount ?? 0);
    const prevMonthRev = Number(revenuePrevMonth._sum.total_amount ?? 0);
    const revenueGrowthPct = prevMonthRev > 0
      ? ((thisMonthRev - prevMonthRev) / prevMonthRev) * 100
      : null;

    return {
      revenue: {
        this_month: thisMonthRev,
        prev_month: prevMonthRev,
        growth_pct: revenueGrowthPct,
      },
      orders: {
        this_month: totalOrders,
        pending: pendingOrders,
      },
      customers: {
        total: totalCustomers,
      },
      inventory: {
        total_units: Number(inventoryItemCount._sum.quantity ?? 0),
      },
      ar: {
        outstanding: Number(unpaidAR._sum.total_amount ?? 0),
      },
      ap: {
        outstanding: Number(unpaidAP._sum.total_amount ?? 0),
      },
      recent_orders: recentOrders,
      recent_journal_entries: recentJournalEntries,
    };
  }

  async getInventoryValuation(tenantId: string) {
    const result = await db.$queryRaw`
      SELECT
        w.name AS warehouse_name,
        si.name AS site_name,
        p.name AS product_name,
        p.sku,
        SUM(ins.quantity) AS total_qty,
        p.cost_price,
        SUM(ins.quantity) * p.cost_price AS stock_value
      FROM inventory_stock ins
      JOIN warehouse_locations wl ON wl.id = ins.location_id
      JOIN warehouse_zones wz ON wz.id = wl.zone_id
      JOIN warehouses w ON w.id = wz.warehouse_id
      JOIN sites si ON si.id = w.site_id
      JOIN products p ON p.id = ins.product_id
      WHERE ins.tenant_id::text = ${tenantId}
        AND ins.quantity > 0
      GROUP BY 1, 2, 3, 4, 6
      ORDER BY stock_value DESC
    `;

    return result;
  }
}

// Types
interface ReportFilters {
  from: string;
  to: string;
  site_id?: string;
  warehouse_id?: string;
}

interface MonthlySalesRow {
  month: Date;
  city: string;
  site_name: string;
  order_count: number;
  revenue: number;
  discounts: number;
  unique_customers: number;
}

interface TopProductRow {
  id: string;
  sku: string;
  name: string;
  selling_price: number;
  cost_price: number;
  units_sold: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  margin_pct: number;
}

interface SalesByCityRow {
  city: string;
  site_name: string;
  order_count: number;
  revenue: number;
  avg_order_value: number;
}

interface InventoryTurnoverRow {
  id: string;
  sku: string;
  name: string;
  cogs: number;
  current_inventory_value: number;
  turnover_ratio: number;
}

interface GrowthRow {
  month: Date;
  revenue: number;
  orders: number;
  prev_revenue: number;
  growth_pct: number;
}

interface PurchaseSummaryRow {
  month: Date;
  supplier_name: string;
  po_count: number;
  total_spend: number;
}
