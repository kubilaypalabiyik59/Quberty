'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Search, SlidersHorizontal, Package, Plus, Minus, X, History } from 'lucide-react';
import { TransactionsModal } from '@/components/erp/TransactionsModal';
import { FilterPanel, FilterPanelTrigger, applyFilters } from '@/components/ui/FilterPanel';
import type { FilterState } from '@/components/ui/FilterPanel';

const FILTER_FIELDS = [
  { key: 'product.name',     label: 'Product name' },
  { key: 'product.sku',      label: 'SKU / Item number' },
  { key: 'location.zone.warehouse.name', label: 'Warehouse' },
  { key: 'location.code',    label: 'Location code' },
  {
    key:  '_available',
    label: 'Stock status',
    type:  'select' as const,
    options: [
      { label: 'In stock',    value: 'in_stock' },
      { label: 'Low stock',   value: 'low_stock' },
      { label: 'Out of stock', value: 'out_of_stock' },
    ],
  },
  { key: 'quantity',      label: 'On-hand qty',  type: 'number' as const },
  { key: 'reserved_qty',  label: 'Reserved qty', type: 'number' as const },
];

export default function StockPage() {
  const qc = useQueryClient();
  const [search,      setSearch]      = useState('');
  const [filterOpen,  setFilterOpen]  = useState(false);
  const [filters,     setFilters]     = useState<FilterState>({});
  const [adjustModal, setAdjustModal] = useState<any>(null);
  const [adjustQty,   setAdjustQty]   = useState('');
  const [adjustType,  setAdjustType]  = useState<'add' | 'subtract'>('add');
  const [adjustNote,  setAdjustNote]  = useState('');
  const [adjustError, setAdjustError] = useState('');
  const [txStock,     setTxStock]     = useState<any | null>(null);

  const { data: stock, isLoading } = useQuery({
    queryKey: ['inventory-stock'],
    queryFn: () => api.get('/inventory/stock').then(r => r.data.data),
  });

  const adjust = useMutation({
    mutationFn: () => api.post('/inventory/adjust', {
      product_id: adjustModal.product_id,
      variant_id: adjustModal.variant_id,
      location_id: adjustModal.location_id,
      quantity: adjustType === 'add' ? Number(adjustQty) : -Number(adjustQty),
      notes: adjustNote,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-stock'] });
      setAdjustModal(null);
      setAdjustQty('');
      setAdjustNote('');
      setAdjustError('');
    },
    onError: (err: any) => setAdjustError(err.response?.data?.message ?? 'Adjustment failed'),
  });

  // Enrich rows with _available for filter logic
  const enriched = (stock ?? []).map((s: any) => ({
    ...s,
    _available: (s.quantity - s.reserved_qty) <= 0
      ? 'out_of_stock'
      : (s.quantity - s.reserved_qty) <= 5
      ? 'low_stock'
      : 'in_stock',
  }));

  // Text search
  const searched = enriched.filter((s: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.product?.name?.toLowerCase().includes(q) ||
      s.product?.sku?.toLowerCase().includes(q) ||
      s.location?.code?.toLowerCase().includes(q)
    );
  });

  // Panel filters (excluding _available which needs special handling)
  const panelFiltered = applyFilters(
    searched,
    filters,
    FILTER_FIELDS.filter(f => f.key !== '_available'),
  ).filter((s: any) => {
    const statusFilter = filters['_available']?.value;
    if (!statusFilter) return true;
    return s._available === statusFilter;
  });

  const activeFilterCount = Object.values(filters).filter(f => f?.value).length;

  return (
    <div>
      {txStock && (
        <TransactionsModal
          title={`${txStock.product?.name}${txStock.variant?.attributes ? ` · ${Object.values(txStock.variant.attributes as Record<string, string>).join(' / ')}` : txStock.variant?.sku_variant ? ` · ${txStock.variant.sku_variant}` : ''}`}
          queryParams={{
            product_id: txStock.product_id,
            ...(txStock.variant_id ? { variant_id: txStock.variant_id } : {}),
          }}
          onClose={() => setTxStock(null)}
        />
      )}

      <FilterPanel
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        fields={FILTER_FIELDS}
        onApply={setFilters}
        activeCount={activeFilterCount}
      />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Stock Overview</h1>
          <p className="text-sm text-gray-500 mt-0.5">Real-time inventory by product, variant and location</p>
        </div>
      </div>

      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search by product name, SKU or location..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <FilterPanelTrigger onClick={() => setFilterOpen(true)} activeCount={activeFilterCount} />
      </div>

      {/* Active filter chips */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {FILTER_FIELDS.filter(f => filters[f.key]?.value).map(f => (
            <span
              key={f.key}
              className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full"
            >
              {f.label}: <em>{filters[f.key]?.op}</em> &quot;{filters[f.key]?.value}&quot;
              <button
                onClick={() => setFilters(prev => ({ ...prev, [f.key]: { ...prev[f.key], value: '' } }))}
                className="hover:text-blue-900"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Variant</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Warehouse</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Location</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">On Hand</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Reserved</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Available</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 8 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}</tr>
            ))}
            {!isLoading && panelFiltered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-16 text-center text-gray-400">
                <Package className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                <p className="text-sm">{search || activeFilterCount ? 'No results match your filters.' : 'No stock records yet. Receive a Purchase Order to add stock.'}</p>
                {activeFilterCount > 0 && (
                  <button onClick={() => setFilters({})} className="mt-2 text-xs text-blue-600 hover:underline">Clear all filters</button>
                )}
              </td></tr>
            )}
            {panelFiltered.map((s: any) => {
              const available = s.quantity - s.reserved_qty;
              const variantLabel = s.variant?.attributes
                ? Object.values(s.variant.attributes as Record<string,string>).join(' / ')
                : (s.variant ? s.variant.sku_variant : null);
              return (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 text-sm">{s.product?.name}</div>
                    <div className="text-xs font-mono text-gray-400">{s.product?.sku}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {variantLabel ? (
                      <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-md font-medium">{variantLabel}</span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{s.location?.zone?.warehouse?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded font-mono">{s.location?.code ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{s.quantity}</td>
                  <td className="px-4 py-3 text-right text-gray-400">{s.reserved_qty}</td>
                  <td className={`px-4 py-3 text-right font-bold ${available <= 0 ? 'text-red-500' : available <= 5 ? 'text-amber-500' : 'text-green-600'}`}>
                    {available}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => { setAdjustModal(s); setAdjustQty(''); setAdjustType('add'); setAdjustNote(''); setAdjustError(''); }}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" /> Adjust
                      </button>
                      <button
                        onClick={() => setTxStock(s)}
                        className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 font-medium hover:bg-gray-100 px-2 py-1 rounded-lg transition-colors"
                      >
                        <History className="h-3.5 w-3.5" /> History
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Adjust Modal */}
      {adjustModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">Manual Stock Adjustment</h3>
              <button onClick={() => setAdjustModal(null)} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 mb-4 text-sm">
              <p className="font-semibold text-gray-800">{adjustModal.product?.name}</p>
              {adjustModal.variant?.attributes && (
                <p className="text-xs text-gray-500 mt-0.5">{Object.values(adjustModal.variant.attributes as Record<string,string>).join(' / ')}</p>
              )}
              <p className="text-xs text-gray-500 mt-0.5">Location: {adjustModal.location?.code} · Current: <strong>{adjustModal.quantity}</strong></p>
            </div>
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setAdjustType('add')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition-colors ${adjustType === 'add' ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                <Plus className="h-4 w-4" /> Add
              </button>
              <button
                onClick={() => setAdjustType('subtract')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium border transition-colors ${adjustType === 'subtract' ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                <Minus className="h-4 w-4" /> Subtract
              </button>
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter quantity"
                value={adjustQty}
                onChange={e => setAdjustQty(e.target.value)}
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Reason / Notes</label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Damaged goods, Physical count correction"
                value={adjustNote}
                onChange={e => setAdjustNote(e.target.value)}
              />
            </div>
            {adjustError && <p className="text-sm text-red-600 mb-3">{adjustError}</p>}
            <button
              onClick={() => adjust.mutate()}
              disabled={!adjustQty || adjust.isPending}
              className="w-full bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white py-2.5 rounded-xl font-medium text-sm transition-colors"
            >
              {adjust.isPending ? 'Saving...' : 'Apply Adjustment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
