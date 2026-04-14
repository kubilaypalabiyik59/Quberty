import { Hono }    from 'hono';
import { ReportService } from './report.service';
import { requireRole } from '../../shared/middleware/authMiddleware';
import { ok } from '../../shared/response';
import type { AppEnv } from '../../shared/context';

const app = new Hono<AppEnv>();
const reportService = new ReportService();

const defaultFilters = (query: Record<string, string>) => ({
  from:         query.from         ?? new Date(new Date().getFullYear(), 0, 1).toISOString(),
  to:           query.to           ?? new Date().toISOString(),
  site_id:      query.site_id,
  warehouse_id: query.warehouse_id,
});

app.get('/sales/monthly', requireRole('admin', 'store_manager'), async (c) => {
  const data = await reportService.getMonthlySales(c.get('tenantId'), defaultFilters(c.req.query()));
  return ok(c, data);
});

app.get('/sales/by-city', requireRole('admin', 'store_manager'), async (c) => {
  const data = await reportService.getSalesByCity(c.get('tenantId'), defaultFilters(c.req.query()));
  return ok(c, data);
});

app.get('/products/top-selling', requireRole('admin', 'store_manager'), async (c) => {
  const data = await reportService.getTopProducts(
    c.get('tenantId'),
    defaultFilters(c.req.query()),
    Number(c.req.query('limit') ?? 20)
  );
  return ok(c, data);
});

app.get('/purchases/monthly', requireRole('admin', 'store_manager'), async (c) => {
  const data = await reportService.getPurchasesSummary(c.get('tenantId'), defaultFilters(c.req.query()));
  return ok(c, data);
});

app.get('/inventory/turnover', requireRole('admin', 'store_manager'), async (c) => {
  const data = await reportService.getInventoryTurnover(c.get('tenantId'), defaultFilters(c.req.query()));
  return ok(c, data);
});

app.get('/inventory/valuation', requireRole('admin', 'store_manager'), async (c) => {
  const data = await reportService.getInventoryValuation(c.get('tenantId'));
  return ok(c, data);
});

app.get('/trends/growth', requireRole('admin'), async (c) => {
  const data = await reportService.getMonthOnMonthGrowth(c.get('tenantId'));
  return ok(c, data);
});

app.get('/daily-revenue', requireRole('admin', 'store_manager'), async (c) => {
  const today = new Date();
  const year  = Number(c.req.query('year')  ?? today.getFullYear());
  const month = Number(c.req.query('month') ?? today.getMonth() + 1);
  const data  = await reportService.getDailyRevenue(c.get('tenantId'), year, month);
  return ok(c, data);
});

app.get('/dashboard', requireRole('admin', 'store_manager'), async (c) => {
  const data = await reportService.getDashboardSummary(c.get('tenantId'));
  return ok(c, data);
});

export default app;
