'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import Link from 'next/link';
import { Plus, Search, Globe, EyeOff, Pencil, Package, X, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { FilterPanel, FilterPanelTrigger, applyFilters } from '@/components/ui/FilterPanel';
import type { FilterState } from '@/components/ui/FilterPanel';

const FILTER_FIELDS = [
  { key: 'name',       label: 'Product name' },
  { key: 'sku',        label: 'SKU' },
  { key: 'brand',      label: 'Brand' },
  { key: 'category.name', label: 'Category' },
  {
    key: 'is_published',
    label: 'E-Commerce',
    type: 'select' as const,
    options: [
      { label: 'Listed',   value: 'true' },
      { label: 'Unlisted', value: 'false' },
    ],
  },
  { key: 'selling_price', label: 'Price (Bs.)', type: 'number' as const },
];

export default function ProductsPage() {
  const qc = useQueryClient();
  const [search,     setSearch]     = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters,    setFilters]    = useState<FilterState>({});

  const { data, isLoading } = useQuery({
    queryKey: ['erp-products', search],
    queryFn: () =>
      api.get(`/products?limit=100&search=${search}`).then(r => r.data.data),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const togglePublish = useMutation({
    mutationFn: ({ id, is_published }: { id: string; is_published: boolean }) =>
      api.put(`/products/${id}`, { is_published }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['erp-products'] }),
  });

  const bulk = useMutation({
    mutationFn: (action: 'publish' | 'unpublish' | 'delete') =>
      api.post('/products/bulk', { ids: Array.from(selected), action }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['erp-products'] });
      setSelected(new Set());
    },
    onError: (err: any) => alert(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Bulk action failed'),
  });

  const toggleOne = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Apply panel filters (handle is_published as boolean string comparison)
  const panelFiltered = applyFilters(
    (data ?? []),
    filters,
    FILTER_FIELDS.filter(f => f.key !== 'is_published'),
  ).filter((p: any) => {
    const val = filters['is_published']?.value;
    if (!val) return true;
    return String(p.is_published) === val;
  });

  const activeFilterCount = Object.values(filters).filter(f => f?.value).length;

  return (
    <div>
      <FilterPanel
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        fields={FILTER_FIELDS}
        onApply={setFilters}
        activeCount={activeFilterCount}
      />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage your product catalogue</p>
        </div>
        <Link
          href="/products/new"
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus className="h-4 w-4" /> New Product
        </Link>
      </div>

      {/* Search + Filter trigger */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search products..."
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
            <span key={f.key} className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full">
              {f.label}: <em>{filters[f.key]?.op}</em> &quot;{filters[f.key]?.value}&quot;
              <button onClick={() => setFilters(prev => ({ ...prev, [f.key]: { ...prev[f.key], value: '' } }))} className="hover:text-blue-900">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div data-testid="bulk-bar" className="flex items-center justify-between mb-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-800">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => bulk.mutate('publish')} disabled={bulk.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 px-3 py-1.5 rounded-lg disabled:opacity-50">
              <Globe className="h-3.5 w-3.5" /> Publish
            </button>
            <button onClick={() => bulk.mutate('unpublish')} disabled={bulk.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg disabled:opacity-50">
              <EyeOff className="h-3.5 w-3.5" /> Unpublish
            </button>
            <button onClick={() => { if (confirm(`Delete ${selected.size} product(s)?`)) bulk.mutate('delete'); }} disabled={bulk.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg disabled:opacity-50">
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
            <button onClick={() => setSelected(new Set())}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="w-10 px-4 py-3">
                <input type="checkbox" aria-label="Select all"
                  checked={panelFiltered.length > 0 && panelFiltered.every((p: any) => selected.has(p.id))}
                  onChange={e => setSelected(e.target.checked ? new Set(panelFiltered.map((p: any) => p.id)) : new Set())}
                  className="rounded border-gray-300" />
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Category</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Price</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Variants</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">E-Commerce</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                {Array.from({ length: 8 }).map((_, j) => (
                  <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                ))}
              </tr>
            ))}
            {!isLoading && panelFiltered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center text-gray-400">
                  <Package className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                  {activeFilterCount > 0 || search
                    ? <><p>No products match your filters.</p><button onClick={() => { setFilters({}); setSearch(''); }} className="mt-2 text-xs text-blue-600 hover:underline">Clear all filters</button></>
                    : <p>No products yet. <Link href="/products/new" className="text-blue-600 hover:underline">Create your first product</Link></p>
                  }
                </td>
              </tr>
            )}
            {panelFiltered.map((p: any) => (
              <tr key={p.id} className={`transition-colors ${selected.has(p.id) ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}>
                <td className="px-4 py-3">
                  <input type="checkbox" aria-label={`Select ${p.name}`}
                    checked={selected.has(p.id)} onChange={() => toggleOne(p.id)}
                    className="rounded border-gray-300" />
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{p.name}</div>
                  {p.brand && <div className="text-xs text-gray-400">{p.brand}</div>}
                </td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-3 text-gray-500">{p.category?.name ?? '—'}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">
                  Bs. {Number(p.selling_price).toLocaleString()}
                  {p.sale_price && (
                    <span className="ml-1 text-xs text-red-500 line-through">
                      Bs. {Number(p.sale_price).toLocaleString()}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                    {p.variants?.length ?? 0}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => togglePublish.mutate({ id: p.id, is_published: !p.is_published })}
                    title={p.is_published ? 'Listed on E-Commerce — click to unlist' : 'Not listed — click to publish'}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      p.is_published
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {p.is_published
                      ? <><Globe className="h-3 w-3" /> Listed</>
                      : <><EyeOff className="h-3 w-3" /> Unlisted</>
                    }
                  </button>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/products/${p.id}`}
                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    <Pencil className="h-3 w-3" /> Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
