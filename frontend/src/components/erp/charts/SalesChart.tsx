'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

interface SalesChartProps {
  data: { month?: string; day?: string; revenue: number; order_count: number }[];
  dark?: boolean;
  green?: boolean;
  mode?: 'monthly' | 'daily';
}

export function SalesChart({ data, dark, green, mode = 'monthly' }: SalesChartProps) {
  if (!data.length) {
    return (
      <div className={`h-48 flex flex-col items-center justify-center gap-2 ${dark ? 'text-red-300/30' : 'text-gray-400'}`}>
        <span className="text-3xl opacity-40">📊</span>
        <span className="text-sm">No revenue data yet</span>
      </div>
    );
  }

  const formatted = (mode === 'daily' ? data : [...data].reverse()).map((d) => {
    if (mode === 'daily') {
      const date = new Date(d.day!);
      return { ...d, label: date.toLocaleDateString('en', { day: 'numeric', month: 'short' }), revenue: Number(d.revenue) };
    }
    return { ...d, label: new Date(d.month!).toLocaleDateString('en', { month: 'short', year: '2-digit' }), revenue: Number(d.revenue) };
  });

  // Find index of max bar for green highlight
  const maxIdx = green
    ? formatted.reduce((best, d, i) => (d.revenue > formatted[best].revenue ? i : best), 0)
    : -1;

  const tickColor     = dark ? 'rgba(255,180,180,0.3)' : '#9ca3af';
  const gridColor     = dark ? 'rgba(255,80,80,0.06)'  : '#f3f4f6';
  const tooltipBg     = dark ? '#1a0505'               : '#fff';
  const tooltipBorder = dark ? 'rgba(180,30,30,0.4)'   : '#e5e7eb';
  const tooltipText   = dark ? '#fef3c7'               : '#374151';
  const defaultFill   = dark ? '#b91c1c' : green ? '#d1d5db' : '#3b82f6';

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={formatted} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} barCategoryGap="40%">
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: tickColor }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: tickColor }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v >= 1000 ? `Bs.${(v / 1000).toFixed(0)}k` : `Bs.${v}`}
        />
        <Tooltip
          formatter={(v: number) => [`Bs. ${v.toLocaleString()}`, 'Revenue']}
          contentStyle={{
            background: tooltipBg,
            border: `1px solid ${tooltipBorder}`,
            borderRadius: 8,
            color: tooltipText,
            fontSize: 12,
            boxShadow: dark ? '0 8px 24px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.1)',
          }}
          cursor={{ fill: dark ? 'rgba(255,80,80,0.05)' : 'rgba(0,0,0,0.03)' }}
        />
        <Bar dataKey="revenue" radius={[6, 6, 0, 0]} maxBarSize={72} fill={defaultFill}>
          {green && formatted.map((_, i) => (
            <Cell key={i} fill={i === maxIdx ? '#22c55e' : '#e5e7eb'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
