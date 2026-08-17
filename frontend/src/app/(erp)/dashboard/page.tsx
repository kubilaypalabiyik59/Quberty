'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { SalesChart } from '@/components/erp/charts/SalesChart';
import { TrendingUp, TrendingDown, ArrowRight, Package } from 'lucide-react';
import Link from 'next/link';

/* ── helpers ── */
function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

/**
 * Avatars are a neutral chip, not a colour wheel. The previous version picked a
 * hue by list index, so a customer's colour changed whenever the list
 * reordered — decoration masquerading as data.
 */
const AVATAR_CLASS = 'bg-accent-soft text-accent-onSoft';

/* ── sub-components ── */
function KpiCard({
  label, value, change, href,
}: { label: string; value: string | number; change?: number; href?: string }) {
  // Was inverted: `up` rendered red and `down` rendered green, which is
  // backwards for revenue. Rising revenue is favourable; the colour follows
  // meaning, and the sign carries it too so colour is never the only signal.
  const up = change !== undefined && change > 0;
  const down = change !== undefined && change < 0;

  const inner = (
    <div className="flex-1">
      <p className="text-caption text-fg-muted mb-1">{label}</p>
      <p className="font-mono text-display font-semibold text-fg tracking-tight" data-numeric>{value}</p>
      {change !== undefined && (
        <div className={`flex items-center gap-1 mt-1.5 text-xs font-semibold px-2 py-0.5 rounded-full w-fit
          ${up ? 'bg-success-soft text-success' : down ? 'bg-danger-soft text-danger' : 'bg-surface-sunken text-fg-subtle'}`}>
          {up ? <TrendingUp className="h-3 w-3" /> : down ? <TrendingDown className="h-3 w-3" /> : null}
          {up ? '+' : down ? '−' : ''}{Math.abs(change).toFixed(1)}%
          <span className="font-normal text-fg-subtle ml-0.5">vs last month</span>
        </div>
      )}
    </div>
  );

  if (href) return <Link href={href} className="flex-1 cursor-pointer">{inner}</Link>;
  return inner;
}

function ProductRow({ product, index }: { product: any; index: number }) {
  // Product swatches were also index-coloured; a single neutral reads cleaner.
  const swatch = 'bg-surface-sunken';
  const revenue = Number(product.revenue ?? product.total_revenue ?? 0);
  return (
    <div className="flex items-center gap-3 py-2.5">
      {/* color swatch / image */}
      <div className={`w-10 h-10 rounded-xl ${swatch} flex items-center justify-center shrink-0 overflow-hidden`}>
        {product.image_url ? (
          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <Package className="h-5 w-5 text-white/70" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
        <p className="text-xs text-gray-400">{product.units_sold ?? product.total_units ?? 0} units sold</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-gray-900">
          Bs. {revenue >= 1000 ? `${(revenue / 1000).toFixed(1)}k` : revenue.toLocaleString()}
        </p>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
          Active
        </span>
      </div>
    </div>
  );
}

function CommentRow({ order, index }: { order: any; index: number }) {
  const name = order.customer
    ? `${order.customer.first_name} ${order.customer.last_name}`
    : 'Walk-in';
  const colorClass = AVATAR_CLASS;
  return (
    <div className="flex gap-3 py-2.5">
      <div className={`w-8 h-8 rounded-full ${colorClass} flex items-center justify-center text-xs font-bold shrink-0`}>
        {getInitials(name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs">
          <span className="font-semibold text-gray-900">{name}</span>
          {' '}
          <span className="text-gray-500">on </span>
          <span className="font-medium text-gray-700">{order.order_number}</span>
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {order.status} · Bs. {Number(order.total_amount).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

/* ── main page ── */
export default function DashboardPage() {
  const now = new Date();
  const [chartMode, setChartMode] = useState<'monthly' | 'daily'>('monthly');
  const [dailyYear, setDailyYear] = useState(now.getFullYear());
  const [dailyMonth, setDailyMonth] = useState(now.getMonth() + 1);

  const { data: summary, isLoading } = useQuery({
    queryKey: ['reports', 'dashboard'],
    queryFn: () => api.get('/reports/dashboard').then((r) => r.data.data),
  });

  const { data: monthlySales } = useQuery({
    queryKey: ['reports', 'monthly-sales'],
    queryFn: () => api.get('/reports/sales/monthly').then((r) => r.data.data),
    enabled: chartMode === 'monthly',
  });

  const { data: dailyRevenue } = useQuery({
    queryKey: ['reports', 'daily-revenue', dailyYear, dailyMonth],
    queryFn: () => api.get(`/reports/daily-revenue?year=${dailyYear}&month=${dailyMonth}`).then((r) => r.data.data),
    enabled: chartMode === 'daily',
  });

  const { data: topProducts } = useQuery({
    queryKey: ['reports', 'top-products'],
    queryFn: () => api.get('/reports/products/top-selling?limit=5').then((r) => r.data.data),
  });

  const revenueGrowth = summary?.revenue?.growth_pct;
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const recentOrders: any[] = summary?.recent_orders ?? [];
  const totalRevenue = chartMode === 'monthly'
    ? (monthlySales?.[0]?.revenue ?? 0)
    : (dailyRevenue?.reduce((s: number, d: any) => s + Number(d.revenue), 0) ?? 0);

  // Customers with names from recent orders for avatar row
  const avatarCustomers = recentOrders
    .filter((o) => o.customer)
    .slice(0, 5)
    .map((o) => `${o.customer.first_name} ${o.customer.last_name}`);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 h-full">

      {/* ── Left column (2/3) ── */}
      <div className="xl:col-span-2 space-y-6">

        {/* Overview card */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-gray-800">Overview</h2>
            <select className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none">
              <option>Last month</option>
              <option>Last 3 months</option>
              <option>This year</option>
            </select>
          </div>

          {/* KPI row */}
          <div className="flex gap-8">
            <KpiCard
              label="Customers"
              value={isLoading ? '—' : (summary?.customers?.total ?? 0).toLocaleString()}
              href="/sales/customers"
            />
            <div className="w-px bg-border" />
            <KpiCard
              label="Revenue"
              value={isLoading ? '—' : `${((summary?.revenue?.this_month ?? 0) / 1000).toFixed(0)}k`}
              change={revenueGrowth}
              href="/finance/p-and-l"
            />
            <div className="w-px bg-border" />
            <KpiCard
              label="Orders"
              value={isLoading ? '—' : (summary?.orders?.this_month ?? 0)}
              href="/sales/orders"
            />
          </div>

          {/* New orders / customers section */}
          {recentOrders.length > 0 && (
            <div className="mt-6 pt-5 border-t border-gray-50">
              <p className="text-sm font-semibold text-gray-800 mb-0.5">
                {recentOrders.length} new orders recently!
              </p>
              <p className="text-xs text-gray-400 mb-4">Latest activity from your customers</p>

              <div className="flex items-center gap-3">
                {avatarCustomers.map((name, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div className={`w-11 h-11 rounded-full ${AVATAR_CLASS} flex items-center justify-center text-xs font-bold`}>
                      {getInitials(name)}
                    </div>
                    <span className="text-[10px] text-gray-500">{name.split(' ')[0]}</span>
                  </div>
                ))}
                <Link
                  href="/sales/orders"
                  className="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                >
                  <ArrowRight className="h-4 w-4 text-gray-500" />
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Revenue chart card */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h2 className="text-base font-semibold text-gray-800">
                {chartMode === 'monthly' ? 'Monthly Revenue' : 'Daily Revenue'}
              </h2>
              <p className="text-2xl font-bold text-gray-900 mt-0.5">
                Bs. {Number(totalRevenue).toLocaleString()}
                <span className="text-sm font-normal text-gray-400 ml-2">
                  {chartMode === 'monthly' ? 'this month' : `${MONTHS[dailyMonth - 1]} ${dailyYear}`}
                </span>
              </p>
            </div>

            <div className="flex flex-col gap-2 items-end">
              {/* Mode toggle */}
              <div className="flex rounded-lg overflow-hidden border border-gray-200">
                {(['monthly', 'daily'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setChartMode(m)}
                    className={`px-3 py-1 text-xs font-medium capitalize transition-colors ${
                      chartMode === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:text-gray-900'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {chartMode === 'daily' && (
                <div className="flex gap-1">
                  <select
                    value={dailyMonth}
                    onChange={(e) => setDailyMonth(Number(e.target.value))}
                    className="text-xs px-2 py-0.5 border border-gray-200 rounded text-gray-600 focus:outline-none"
                  >
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                  <select
                    value={dailyYear}
                    onChange={(e) => setDailyYear(Number(e.target.value))}
                    className="text-xs px-2 py-0.5 border border-gray-200 rounded text-gray-600 focus:outline-none"
                  >
                    {[now.getFullYear() - 1, now.getFullYear()].map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <SalesChart
            data={chartMode === 'monthly' ? (monthlySales ?? []) : (dailyRevenue ?? [])}
            highlightPeak
            mode={chartMode}
          />
        </div>
      </div>

      {/* ── Right column (1/3) ── */}
      <div className="space-y-6">

        {/* Popular Products */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
          <h2 className="text-base font-semibold text-gray-800 mb-1">Popular products</h2>

          {(topProducts ?? []).length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No product data yet</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {(topProducts ?? []).map((p: any, i: number) => (
                <ProductRow key={p.product_id ?? i} product={p} index={i} />
              ))}
            </div>
          )}

          <Link
            href="/products"
            className="mt-4 w-full flex items-center justify-center py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
          >
            All products
          </Link>
        </div>

        {/* Comments / Recent Activity */}
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200">
          <h2 className="text-base font-semibold text-gray-800 mb-1">Recent Orders</h2>

          {recentOrders.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No recent activity</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {recentOrders.slice(0, 5).map((order, i) => (
                <CommentRow key={order.id} order={order} index={i} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
