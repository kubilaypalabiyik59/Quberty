'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LabelList } from 'recharts';
import { useChartTokens } from '@/lib/chartTokens';

interface SalesChartProps {
  data: { month?: string; day?: string; revenue: number; order_count: number }[];
  mode?: 'monthly' | 'daily';
  /**
   * Call out the best period with a label on that bar.
   *
   * It used to be called `green` and painted the peak bar with the success
   * colour. Two things were wrong with that: it spent a reserved status colour
   * on something that is not a status, and it coloured a bar by its RANK — so
   * changing the date range repainted whichever bar happened to win, which is
   * how a reader learns to distrust colour. A label says the same thing and
   * survives a filter.
   */
  highlightPeak?: boolean;
  /** Tenant currency symbol. Not every tenant trades in bolivianos. */
  currency?: string;
}

export function SalesChart({ data, mode = 'monthly', highlightPeak, currency = 'Bs.' }: SalesChartProps) {
  const t = useChartTokens();

  if (!data.length) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-2 text-fg-subtle">
        <span className="text-body">No revenue data yet</span>
      </div>
    );
  }

  const formatted = (mode === 'daily' ? data : [...data].reverse()).map((d) => {
    const value = Number(d.revenue);
    if (mode === 'daily') {
      const date = new Date(d.day!);
      return { ...d, label: date.toLocaleDateString('en', { day: 'numeric', month: 'short' }), revenue: value };
    }
    return { ...d, label: new Date(d.month!).toLocaleDateString('en', { month: 'short', year: '2-digit' }), revenue: value };
  });

  const peakIdx = highlightPeak
    ? formatted.reduce((best, d, i) => (d.revenue > formatted[best].revenue ? i : best), 0)
    : -1;

  const money = (v: number) => `${currency} ${v.toLocaleString()}`;

  return (
    <ResponsiveContainer width="100%" height={200}>
      {/* top margin leaves room for the peak label; at 16 it clipped the text. */}
      <BarChart data={formatted} margin={{ top: 28, right: 4, left: -8, bottom: 0 }} barCategoryGap="40%">
        <CartesianGrid strokeDasharray="3 3" stroke={t.grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: t.axis }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: t.axis }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => (v >= 1000 ? `${currency}${(v / 1000).toFixed(0)}k` : `${currency}${v}`)}
        />
        <Tooltip
          formatter={(v: number) => [money(v), 'Revenue']}
          contentStyle={{
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 'var(--radius-control)',
            color: t.fg,
            fontSize: 12,
          }}
          labelStyle={{ color: t.fgMuted }}
          cursor={{ fill: t.cursor }}
        />
        {/* One series, so one colour and no legend — the card heading names it.
            4px data-ends, anchored to the baseline. */}
        <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={72} fill={t.series[0]}>
          {highlightPeak && (
            <LabelList
              dataKey="revenue"
              position="top"
              fontSize={11}
              /* Text wears a text token, never the series colour. */
              fill={t.fgMuted}
              formatter={(v: number) => (formatted[peakIdx]?.revenue === v ? money(v) : '')}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
