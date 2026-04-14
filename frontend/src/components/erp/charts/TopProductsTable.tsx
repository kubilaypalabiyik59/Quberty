interface Product {
  name: string;
  units_sold: number;
  revenue: number;
  margin_pct?: number;
}

export function TopProductsTable({ data, dark }: { data: Product[]; dark?: boolean }) {
  if (!data.length) {
    return (
      <p className={`text-sm text-center py-6 ${dark ? 'text-red-300/30' : 'text-gray-400'}`}>
        No data yet
      </p>
    );
  }

  const rankColor   = dark ? 'text-red-400/40'  : 'text-gray-400';
  const nameColor   = dark ? 'text-red-100/80'   : 'text-gray-800';
  const metaColor   = dark ? 'text-red-300/40'   : 'text-gray-400';
  const marginColor = dark ? 'text-emerald-400'  : 'text-green-600';

  return (
    <div className="space-y-3">
      {data.map((p, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className={`w-5 text-xs font-bold ${rankColor}`}>{i + 1}</span>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium truncate ${nameColor}`}>{p.name}</p>
            <p className={`text-xs ${metaColor}`}>
              {p.units_sold} units · Bs. {Number(p.revenue).toLocaleString()}
            </p>
          </div>
          {p.margin_pct != null && (
            <span className={`text-xs font-semibold ${marginColor}`}>
              {Number(p.margin_pct).toFixed(0)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
