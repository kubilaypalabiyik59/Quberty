'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { useChartTokens } from '@/lib/chartTokens';

/**
 * ⚠️ Every figure on this page used to be rendered with `₺` — Turkish lira, on a
 * Bolivian tenant. A leftover from the template this repo started life as, in
 * the same family as `PurchaseOrder.currency` defaulting to `TRY`.
 *
 * This is one hardcode replacing six, not a fix. The real fix is a tenant
 * currency read from configuration; it is not done here because there is still
 * no exchange-rate table and no single owner of "what currency is this tenant
 * in". Tracked with the other currency-default leftovers in HANDOVER §6.
 */
const CURRENCY = 'Bs.';

/**
 * An empty chart area, with the reason stated.
 *
 * A card that renders a blank rectangle reads as "loading forever" or "broken",
 * and a reader cannot tell either from "there is genuinely nothing here". Say
 * which, and where possible say WHY — "no orders carry a site" is actionable in
 * a way that "no data" is not.
 */
function EmptyChart({ children }: { children: ReactNode }) {
  return (
    <div className="h-[220px] flex items-center justify-center px-6 text-center text-sm text-gray-500">
      {children}
    </div>
  );
}

export default function ReportsPage() {
  const t = useChartTokens();
  const currentYear = new Date().getFullYear();
  const [from, setFrom] = useState(`${currentYear}-01-01`);
  const [to, setTo] = useState(`${currentYear}-12-31`);

  const params = `?from=${from}&to=${to}`;

  const { data: monthlySales } = useQuery({
    queryKey: ['monthly-sales', from, to],
    queryFn: () => api.get(`/reports/sales/monthly${params}`).then((r) => r.data.data),
  });

  const { data: topProducts } = useQuery({
    queryKey: ['top-products', from, to],
    queryFn: () => api.get(`/reports/products/top-selling${params}&limit=10`).then((r) => r.data.data),
  });

  const { data: byCity } = useQuery({
    queryKey: ['sales-by-city', from, to],
    queryFn: () => api.get(`/reports/sales/by-city${params}`).then((r) => r.data.data),
  });

  const { data: growth } = useQuery({
    queryKey: ['growth'],
    queryFn: () => api.get('/reports/trends/growth').then((r) => r.data.data),
  });

  const { data: turnover } = useQuery({
    queryKey: ['turnover', from, to],
    queryFn: () => api.get(`/reports/inventory/turnover${params}`).then((r) => r.data.data),
  });

  const chartData = (monthlySales ?? [])
    .slice()
    .reverse()
    .map((row: any) => ({
      month: new Date(row.month).toLocaleDateString('en', { month: 'short', year: '2-digit' }),
      revenue: Number(row.revenue),
      orders: row.order_count,
    }));

  /**
   * The categorical ramp has five slots and is never cycled — a sixth city is
   * not a sixth generated hue. Beyond five the tail folds into one neutral
   * "Other" slice, which is also the more readable pie: past six slices nobody
   * can compare wedge angles anyway.
   */
  const SLICE_CAP = 5;
  const sortedCities = [...(byCity ?? [])].sort((a: any, b: any) => Number(b.revenue) - Number(a.revenue));
  const cityData =
    sortedCities.length > SLICE_CAP
      ? [
          ...sortedCities.slice(0, SLICE_CAP),
          {
            city: 'Other',
            revenue: sortedCities.slice(SLICE_CAP).reduce((sum: number, r: any) => sum + Number(r.revenue), 0),
          },
        ]
      : sortedCities;

  const growthData = (growth ?? [])
    .slice(0, 12)
    .reverse()
    .map((row: any) => ({
      month: new Date(row.month).toLocaleDateString('en', { month: 'short', year: '2-digit' }),
      revenue: Number(row.revenue),
      growth: Number(row.growth_pct ?? 0),
    }));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports & Analytics</h1>
          <p className="text-gray-500">Business intelligence at a glance</p>
        </div>
        <div className="flex gap-3 items-center">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <span className="text-gray-400">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>
      </div>

      {/* Monthly Revenue Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Monthly Revenue</h2>
        {chartData.length === 0 ? (
          <EmptyChart>No invoiced revenue in this date range.</EmptyChart>
        ) : (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: t.axis }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 12, fill: t.axis }} tickLine={false} axisLine={false}
              tickFormatter={(v) => `${CURRENCY}${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v: number) => [`${CURRENCY} ${v.toLocaleString()}`, 'Revenue']}
              contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 'var(--radius-control)', color: t.fg, fontSize: 12 }}
              labelStyle={{ color: t.fgMuted }}
              cursor={{ fill: t.cursor }}
            />
            <Bar dataKey="revenue" fill={t.series[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* MoM Growth */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Month-over-Month Growth</h2>
          {growthData.length === 0 ? (
            <EmptyChart>Not enough history to compare months yet.</EmptyChart>
          ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={growthData}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                formatter={(v: number) => [`${v}%`, 'Growth']}
                contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 'var(--radius-control)', color: t.fg, fontSize: 12 }}
                labelStyle={{ color: t.fgMuted }}
              />
              {/* Growth was drawn in the success colour, which claimed every point
                  was good news — including the negative months. Status colours are
                  reserved; this is one series, so it takes series slot 1. */}
              <Line type="monotone" dataKey="growth" stroke={t.series[0]} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
          )}
        </div>

        {/* Sales by City */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Revenue by City</h2>
          {cityData.length === 0 ? (
            <EmptyChart>
              No orders carry a warehouse, so revenue cannot be attributed to a site.
            </EmptyChart>
          ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={cityData}
                dataKey="revenue"
                nameKey="city"
                cx="50%"
                cy="50%"
                outerRadius={80}
                /* Direct labels, so identity never rests on colour alone. */
                label={({ city, percent }) => `${city} (${(percent * 100).toFixed(0)}%)`}
                /* 2px surface gap between adjacent fills. */
                paddingAngle={1}
                stroke={t.surface}
                strokeWidth={2}
              >
                {cityData.map((d: any, idx: number) => (
                  /* Colour follows the CITY, not its rank in this list — the
                     ramp is consumed in order and never cycled, which is why
                     the tail folds into "Other" instead of reusing slot 1. */
                  <Cell key={d.city} fill={idx < t.series.length ? t.series[idx] : t.fgMuted} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number) => `${CURRENCY} ${v.toLocaleString()}`}
                contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 'var(--radius-control)', color: t.fg, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top Products */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Top Selling Products</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-2 font-medium text-gray-500">Product</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Units Sold</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Revenue</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">COGS</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Gross Profit</th>
                <th className="text-right py-3 px-2 font-medium text-gray-500">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {(topProducts ?? []).map((p: any) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-3 px-2">
                    <div className="font-medium text-gray-900">{p.name}</div>
                    <div className="text-gray-400 text-xs">{p.sku}</div>
                  </td>
                  <td className="py-3 px-2 text-right">{p.units_sold}</td>
                  <td className="py-3 px-2 text-right">{CURRENCY}{Number(p.revenue).toLocaleString()}</td>
                  <td className="py-3 px-2 text-right">{CURRENCY}{Number(p.cogs ?? 0).toLocaleString()}</td>
                  <td className="py-3 px-2 text-right text-green-600">{CURRENCY}{Number(p.gross_profit ?? 0).toLocaleString()}</td>
                  <td className="py-3 px-2 text-right">
                    <span className={`font-medium ${Number(p.margin_pct) > 30 ? 'text-green-600' : 'text-yellow-600'}`}>
                      {p.margin_pct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inventory Turnover */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Inventory Turnover</h2>
        {(turnover ?? []).length === 0 ? (
          <EmptyChart>No stock movement in this date range.</EmptyChart>
        ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={(turnover ?? []).slice(0, 10)} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={t.grid} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: t.axis }} tickLine={false} axisLine={false} width={120} />
            <Tooltip
              formatter={(v: number) => [v.toFixed(2), 'Turnover Ratio']}
              contentStyle={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 'var(--radius-control)', color: t.fg, fontSize: 12 }}
              labelStyle={{ color: t.fgMuted }}
              cursor={{ fill: t.cursor }}
            />
            <Bar dataKey="turnover_ratio" fill={t.series[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
