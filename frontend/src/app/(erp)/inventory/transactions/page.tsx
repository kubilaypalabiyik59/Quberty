'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search, ArrowDown, ArrowUp, ArrowLeftRight, ClipboardList, ShoppingCart, Truck } from 'lucide-react';

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
  PURCHASE_RECEIPT: { label: 'Purchase Receipt', color: 'bg-green-100 text-green-700', icon: Truck },
  INBOUND:          { label: 'Inbound',          color: 'bg-green-100 text-green-700', icon: ArrowDown },
  ADJUSTMENT:       { label: 'Adjustment',       color: 'bg-blue-100 text-blue-700',  icon: ClipboardList },
  COUNT_ADJUSTMENT: { label: 'Count Adjustment', color: 'bg-teal-100 text-teal-700',  icon: ClipboardList },
  OUTBOUND:         { label: 'Outbound',         color: 'bg-purple-100 text-purple-700', icon: ShoppingCart },
  SALE:             { label: 'Sale',             color: 'bg-purple-100 text-purple-700', icon: ShoppingCart },
  TRANSFER:         { label: 'Transfer',         color: 'bg-orange-100 text-orange-700', icon: ArrowLeftRight },
  TRANSFER_OUT:     { label: 'Transfer Out',     color: 'bg-orange-100 text-orange-700', icon: ArrowUp },
  TRANSFER_IN:      { label: 'Transfer In',      color: 'bg-orange-100 text-orange-700', icon: ArrowDown },
  RETURN:           { label: 'Return',           color: 'bg-yellow-100 text-yellow-700', icon: ArrowDown },
};

function LocationBadge({ location }: { location?: { code: string } | null }) {
  if (!location) return <span className="text-gray-300">—</span>;
  return <span className="font-mono bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-xs">{location.code}</span>;
}

function VariantBadge({ variant, variantId }: { variant?: { sku_variant: string; attributes?: any } | null; variantId?: string | null }) {
  if (!variant && !variantId) return <span className="text-gray-300">—</span>;
  if (variant) {
    const attrs = variant.attributes ? Object.values(variant.attributes as Record<string, string>).join(' / ') : '';
    return (
      <span className="inline-flex flex-col gap-0.5">
        <span className="font-mono bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded text-xs">{variant.sku_variant}</span>
        {attrs && <span className="text-xs text-gray-400">{attrs}</span>}
      </span>
    );
  }
  return <span className="font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded text-xs">{variantId!.slice(0, 8)}…</span>;
}

export default function TransactionsPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['inventory-transactions'],
    queryFn: () => api.get('/inventory/transactions?limit=200').then(r => r.data.data),
  });

  const filtered = (transactions ?? []).filter((t: any) => {
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      t.product?.name?.toLowerCase().includes(q) ||
      t.product?.sku?.toLowerCase().includes(q) ||
      t.variant?.sku_variant?.toLowerCase().includes(q) ||
      t.to_location?.code?.toLowerCase().includes(q) ||
      t.from_location?.code?.toLowerCase().includes(q);
    const matchType = !typeFilter || t.transaction_type === typeFilter;
    return matchSearch && matchType;
  });

  const isInbound = (t: any) =>
    ['PURCHASE_RECEIPT', 'INBOUND', 'TRANSFER_IN', 'RETURN', 'COUNT_ADJUSTMENT'].includes(t.transaction_type) ||
    (t.to_location_id && !t.from_location_id);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Transactions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Full audit trail of all stock movements</p>
        </div>
        <div className="text-sm text-gray-400 font-medium">
          {!isLoading && `${filtered.length} transactions`}
        </div>
      </div>

      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search by product, SKU, variant, location..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
        >
          <option value="">All Types</option>
          {Object.entries(TYPE_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Variant</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">From</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">To</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Qty</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 8 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}</tr>
            ))}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-16 text-center text-gray-400 text-sm">No transactions found.</td></tr>
            )}
            {filtered.map((t: any) => {
              const cfg = TYPE_CONFIG[t.transaction_type] ?? { label: t.transaction_type, color: 'bg-gray-100 text-gray-600', icon: ArrowLeftRight };
              const Icon = cfg.icon;
              const inbound = isInbound(t);
              return (
                <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                      <Icon className="h-3 w-3" /> {cfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 text-xs">{t.product?.name}</div>
                    <div className="text-gray-400 text-xs font-mono">{t.product?.sku}</div>
                  </td>
                  <td className="px-4 py-3">
                    <VariantBadge variant={t.variant} variantId={t.variant_id} />
                  </td>
                  <td className="px-4 py-3">
                    <LocationBadge location={t.from_location} />
                  </td>
                  <td className="px-4 py-3">
                    <LocationBadge location={t.to_location} />
                  </td>
                  <td className={`px-4 py-3 text-right font-bold text-sm ${inbound ? 'text-green-600' : 'text-red-500'}`}>
                    {inbound ? '+' : '-'}{t.quantity}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-[200px] truncate">{t.notes ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
