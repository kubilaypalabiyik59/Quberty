"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowUpRight,
  ArrowRight,
  CalendarDays,
  Package,
  ShoppingBag,
  Users,
  Wallet,
  TrendingUp,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { SalesChart } from "@/components/erp/charts/SalesChart";
import { useMoney } from "@/components/CurrencyProvider";

interface Order {
  id: string;
  order_number: string;
  status: string;
  total_amount: number | string;
  created_at: string;
  customer?: { first_name: string; last_name: string } | null;
}
interface Summary {
  revenue: { this_month: number; growth_pct: number | null };
  orders: { this_month: number; pending: number };
  customers: { total: number };
  recent_orders: Order[];
}
interface SalesPoint {
  month?: string;
  day?: string;
  revenue: number;
  order_count: number;
}
interface Product {
  id: string;
  name: string;
  sku: string;
  revenue: number;
  units_sold: number;
}
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const panel = "rounded-surface border border-border bg-surface shadow-rest";
const action =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-control px-3 text-caption font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function Metric({
  label,
  value,
  note,
  icon: Icon,
  href,
  change,
  featured,
}: {
  label: string;
  value: string;
  note: string;
  icon: LucideIcon;
  href: string;
  change?: number | null;
  featured?: boolean;
}) {
  const hasChange = typeof change === "number" && Number.isFinite(change);
  return (
    <Link
      href={href}
      className={`${panel} group min-w-0 p-5 transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${featured ? "bg-gradient-to-br from-accent-soft to-surface" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-control bg-accent-soft text-accent-onSoft">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <ArrowUpRight
          className="h-4 w-4 text-fg-muted group-hover:text-accent"
          aria-hidden="true"
        />
      </div>
      <p className="mt-4 text-body text-fg-muted">{label}</p>
      <p
        className="mt-1 break-words font-mono text-title font-semibold tracking-tight text-fg sm:text-display xl:text-title 2xl:text-display"
        data-numeric
      >
        {value}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-caption text-fg-muted">
        {hasChange && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${change > 0 ? "bg-success-soft text-success" : change < 0 ? "bg-danger-soft text-danger" : "bg-surface-sunken text-fg-muted"}`}
          >
            {change > 0 ? (
              <TrendingUp className="h-3 w-3" aria-hidden="true" />
            ) : change < 0 ? (
              <TrendingDown className="h-3 w-3" aria-hidden="true" />
            ) : null}
            {change > 0 ? "+" : ""}
            {change.toFixed(1)}%
          </span>
        )}
        <span>{hasChange ? "vs last month" : note}</span>
      </div>
    </Link>
  );
}

function QueryMessage({
  loading,
  error,
  empty,
}: {
  loading: boolean;
  error: boolean;
  empty: string;
}) {
  return (
    <div
      className="flex min-h-48 items-center justify-center p-6 text-center text-body text-fg-muted"
      role={error ? "alert" : "status"}
    >
      {loading
        ? "Loading…"
        : error
          ? "Unable to load this section. Please refresh to try again."
          : empty}
    </div>
  );
}

export default function DashboardPage() {
  const { money } = useMoney();
  const now = new Date();
  const [chartMode, setChartMode] = useState<"monthly" | "daily">("monthly");
  const [dailyYear, setDailyYear] = useState(now.getFullYear());
  const [dailyMonth, setDailyMonth] = useState(now.getMonth() + 1);
  const summaryQuery = useQuery<Summary>({
    queryKey: ["reports", "dashboard"],
    queryFn: () => api.get("/reports/dashboard").then((r) => r.data.data),
  });
  const monthlyQuery = useQuery<SalesPoint[]>({
    queryKey: ["reports", "monthly-sales"],
    queryFn: () => api.get("/reports/sales/monthly").then((r) => r.data.data),
    enabled: chartMode === "monthly",
  });
  const dailyQuery = useQuery<SalesPoint[]>({
    queryKey: ["reports", "daily-revenue", dailyYear, dailyMonth],
    queryFn: () =>
      api
        .get(`/reports/daily-revenue?year=${dailyYear}&month=${dailyMonth}`)
        .then((r) => r.data.data),
    enabled: chartMode === "daily",
  });
  const productsQuery = useQuery<Product[]>({
    queryKey: ["reports", "top-products"],
    queryFn: () =>
      api.get("/reports/products/top-selling?limit=5").then((r) => r.data.data),
  });
  const summary = summaryQuery.data;
  // The monthly endpoint returns one row per site. Combine sites before drawing a tenant-wide chart.
  const months = new Map<string, SalesPoint>();
  for (const point of monthlyQuery.data ?? []) {
    const key = point.month!;
    const previous = months.get(key);
    months.set(key, {
      month: key,
      revenue: Number(point.revenue) + (previous?.revenue ?? 0),
      order_count: Number(point.order_count) + (previous?.order_count ?? 0),
    });
  }
  const chartData =
    chartMode === "monthly"
      ? Array.from(months.values()).sort((a, b) =>
          b.month!.localeCompare(a.month!),
        )
      : (dailyQuery.data ?? []);
  const chartQuery = chartMode === "monthly" ? monthlyQuery : dailyQuery;
  const chartTotal = chartData.reduce(
    (sum, point) => sum + Number(point.revenue),
    0,
  );
  const orders = summary?.recent_orders ?? [];
  const products = productsQuery.data ?? [];
  const metricValue = (value: number | undefined, monetary = false) =>
    summaryQuery.isPending || summaryQuery.isError
      ? "—"
      : monetary
        ? money(value ?? 0)
        : (value ?? 0).toLocaleString();

  return (
    <div className="space-y-6 pb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-title font-semibold text-fg">
            Business overview
          </h2>
          <p className="mt-1 text-body text-fg-muted">
            Your sales, customers and latest activity at a glance.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-caption text-fg-muted">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          {now.toLocaleDateString("en", { month: "long", year: "numeric" })}
        </span>
      </div>
      {summaryQuery.isError && (
        <p
          role="alert"
          className="rounded-control bg-danger-soft p-3 text-body text-danger"
        >
          Overview could not be loaded. Please refresh to try again.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Order revenue"
          value={metricValue(summary?.revenue.this_month, true)}
          note="This month · excluding draft & cancelled"
          icon={Wallet}
          href="/sales/orders"
          change={summary?.revenue.growth_pct}
          featured
        />
        <Metric
          label="Orders this month"
          value={metricValue(summary?.orders.this_month)}
          note="All non-cancelled orders"
          icon={ShoppingBag}
          href="/sales/orders"
        />
        <Metric
          label="Customers"
          value={metricValue(summary?.customers.total)}
          note="Total customer base"
          icon={Users}
          href="/sales/customers"
        />
        <Metric
          label="Pending orders"
          value={metricValue(summary?.orders.pending)}
          note="Confirmed, packed or shipped · all time"
          icon={Package}
          href="/sales/orders"
        />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-3">
        <section
          className={`${panel} min-w-0 p-5 sm:p-6 xl:col-span-2`}
          aria-labelledby="sales-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3
                id="sales-heading"
                className="text-lead font-semibold text-fg"
              >
                Sales performance
              </h3>
              <p className="mt-1 text-caption text-fg-muted">
                {chartMode === "monthly"
                  ? "Shipped & completed orders · year to date"
                  : "Non-draft, non-cancelled orders · selected month"}
              </p>
            </div>
            <div
              className="inline-flex rounded-control border border-border bg-surface-sunken p-1"
              aria-label="Chart interval"
            >
              {(["monthly", "daily"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={chartMode === mode}
                  onClick={() => setChartMode(mode)}
                  className={`${action} capitalize ${chartMode === mode ? "bg-surface text-accent shadow-rest" : "text-fg-muted hover:text-fg"}`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <div className="my-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p
                className="font-mono text-display font-semibold tracking-tight text-fg"
                data-numeric
              >
                {chartQuery.isPending || chartQuery.isError
                  ? "—"
                  : money(chartTotal)}
              </p>
              <p className="mt-1 text-caption text-fg-muted">
                {chartMode === "monthly"
                  ? `January – ${MONTHS[now.getMonth()]} ${now.getFullYear()}`
                  : `${MONTHS[dailyMonth - 1]} ${dailyYear}`}
              </p>
            </div>
            {chartMode === "daily" && (
              <div className="flex gap-2">
                <select
                  aria-label="Revenue month"
                  value={dailyMonth}
                  onChange={(e) => setDailyMonth(Number(e.target.value))}
                  className="min-h-10 rounded-control border border-border bg-surface px-2 text-body text-fg"
                >
                  {MONTHS.map((month, index) => (
                    <option key={month} value={index + 1}>
                      {month}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Revenue year"
                  value={dailyYear}
                  onChange={(e) => setDailyYear(Number(e.target.value))}
                  className="min-h-10 rounded-control border border-border bg-surface px-2 text-body text-fg"
                >
                  {[now.getFullYear() - 1, now.getFullYear()].map((year) => (
                    <option key={year}>{year}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {chartQuery.isPending || chartQuery.isError ? (
            <QueryMessage
              loading={chartQuery.isPending}
              error={chartQuery.isError}
              empty=""
            />
          ) : (
            <SalesChart data={chartData} mode={chartMode} highlightPeak />
          )}
        </section>
        <section
          className={`${panel} min-w-0 p-5 sm:p-6`}
          aria-labelledby="products-heading"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3
                id="products-heading"
                className="text-lead font-semibold text-fg"
              >
                Top products
              </h3>
              <p className="mt-1 text-caption text-fg-muted">
                By units sold · year to date
              </p>
            </div>
            <span className="rounded-control bg-accent-soft p-2 text-accent-onSoft">
              <Package className="h-4 w-4" aria-hidden="true" />
            </span>
          </div>
          {productsQuery.isPending ||
          productsQuery.isError ||
          !products.length ? (
            <QueryMessage
              loading={productsQuery.isPending}
              error={productsQuery.isError}
              empty="No product sales yet."
            />
          ) : (
            <ol className="mt-4 divide-y divide-border">
              {products.map((product, index) => (
                <li key={product.id} className="flex items-center gap-3 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-surface-sunken font-mono text-caption text-fg-muted">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-body font-medium text-fg"
                      title={product.name}
                    >
                      {product.name}
                    </p>
                    <p className="mt-0.5 text-caption text-fg-muted">
                      {product.units_sold} units sold
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-caption font-medium text-fg">
                    {money(product.revenue)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <Link
            href="/products"
            className={`${action} mt-4 w-full border border-border text-fg-muted hover:bg-surface-sunken`}
          >
            View all products
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </section>
      </div>
      <section
        className={`${panel} overflow-hidden`}
        aria-labelledby="orders-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:px-6">
          <div>
            <h3 id="orders-heading" className="text-lead font-semibold text-fg">
              Recent orders
            </h3>
            <p className="mt-1 text-caption text-fg-muted">
              Latest customer activity across all statuses
            </p>
          </div>
          <Link
            href="/sales/orders"
            className={`${action} border border-border text-fg-muted hover:bg-surface-sunken`}
          >
            View all orders
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        {summaryQuery.isPending || summaryQuery.isError || !orders.length ? (
          <QueryMessage
            loading={summaryQuery.isPending}
            error={summaryQuery.isError}
            empty="No recent orders yet."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body">
              <thead className="border-y border-border bg-surface-sunken text-caption text-fg-muted">
                <tr>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Order
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Customer
                  </th>
                  <th
                    scope="col"
                    className="hidden px-4 py-3 font-medium md:table-cell"
                  >
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-right font-medium">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((order) => {
                  const name = order.customer
                    ? `${order.customer.first_name} ${order.customer.last_name}`
                    : "Walk-in";
                  return (
                    <tr key={order.id} className="hover:bg-surface-sunken/50">
                      <td className="whitespace-nowrap px-6 py-4">
                        <Link
                          className="font-mono text-caption font-medium text-accent hover:underline"
                          href={`/sales/orders/${order.id}`}
                        >
                          {order.order_number}
                        </Link>
                      </td>
                      <td className="px-4 py-4">
                        <span className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-caption font-medium text-accent-onSoft sm:flex"
                          >
                            {name
                              .trim()
                              .split(/\s+/)
                              .map((part) => part[0])
                              .join("")
                              .slice(0, 2)}
                          </span>
                          <span className="whitespace-nowrap text-fg">
                            {name}
                          </span>
                        </span>
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-4 text-caption text-fg-muted md:table-cell">
                        {new Date(order.created_at).toLocaleDateString("en", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-4">
                        <span className="inline-flex whitespace-nowrap rounded-full border border-border bg-surface-sunken px-2.5 py-1 text-caption font-medium text-fg-muted">
                          {order.status.replace(/_/g, " ").toLowerCase()}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right font-mono text-caption font-medium text-fg">
                        {money(order.total_amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
