'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Trash2, Pencil, X, Check, Layers, Tag, Package } from 'lucide-react';

export default function VariantTypesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [valueInput, setValueInput] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [relatedType, setRelatedType] = useState<any | null>(null);

  const { data: types, isLoading } = useQuery({
    queryKey: ['variant-types'],
    queryFn: () => api.get('/variant-types').then(r => r.data.data),
  });

  const { data: relatedProducts, isLoading: relatedLoading } = useQuery({
    queryKey: ['products-by-variant-type', relatedType?.id],
    queryFn: () => api.get('/products?limit=200').then(r => {
      const all: any[] = r.data.data ?? [];
      const typeName = relatedType?.name?.toLowerCase() ?? '';
      return all.filter((p: any) =>
        (p.variants ?? []).some((v: any) =>
          v.attributes && Object.keys(v.attributes).some(k => k.toLowerCase() === typeName)
        )
      );
    }),
    enabled: !!relatedType,
  });

  const reset = () => {
    setShowForm(false);
    setEditId(null);
    setName('');
    setValues([]);
    setValueInput('');
    setError('');
  };

  const startEdit = (t: any) => {
    setEditId(t.id);
    setName(t.name);
    setValues([...t.values]);
    setShowForm(true);
  };

  const addValue = () => {
    const v = valueInput.trim();
    if (!v || values.includes(v)) return;
    setValues(prev => [...prev, v]);
    setValueInput('');
  };

  const removeValue = (v: string) => setValues(prev => prev.filter(x => x !== v));

  const save = useMutation({
    mutationFn: () => editId
      ? api.put(`/variant-types/${editId}`, { name, values })
      : api.post('/variant-types', { name, values }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['variant-types'] }); reset(); },
    onError: (err: any) => setError(err.response?.data?.message ?? 'Failed to save'),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/variant-types/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['variant-types'] }),
  });

  return (
    <div>
      {/* Related Items Modal */}
      {relatedType && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
                  <Package className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-gray-900">Related Products</h2>
                  <p className="text-xs text-gray-500">Products using variant type: <strong>{relatedType.name}</strong></p>
                </div>
              </div>
              <button onClick={() => setRelatedType(null)} className="text-gray-400 hover:text-gray-700 p-1.5 hover:bg-gray-100 rounded-lg">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">SKU</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Product</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Price</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider">Matching Variants</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {relatedLoading && Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 4 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                    ))}</tr>
                  ))}
                  {!relatedLoading && (relatedProducts ?? []).length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400 text-sm">
                      No products use this variant type yet.
                    </td></tr>
                  )}
                  {(relatedProducts ?? []).map((p: any) => {
                    const typeName = relatedType.name?.toLowerCase() ?? '';
                    const matchingVariants = (p.variants ?? []).filter((v: any) =>
                      v.attributes && Object.keys(v.attributes).some(k => k.toLowerCase() === typeName)
                    );
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{p.sku}</td>
                        <td className="px-4 py-2.5 font-medium text-gray-900 text-sm">{p.name}</td>
                        <td className="px-4 py-2.5 text-right text-xs text-gray-700">
                          Bs. {Number(p.selling_price ?? p.sale_price ?? 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {matchingVariants.map((v: any) => {
                              const attrs = v.attributes ? Object.values(v.attributes as Record<string, string>).join(' / ') : v.sku_variant;
                              return (
                                <span key={v.id} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-md font-medium">{attrs}</span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <span className="text-xs text-gray-400">{(relatedProducts ?? []).length} product{(relatedProducts ?? []).length !== 1 ? 's' : ''}</span>
              <button onClick={() => setRelatedType(null)} className="text-sm font-medium text-gray-600 border border-gray-200 px-4 py-1.5 rounded-lg hover:bg-gray-50">Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Variant Types</h1>
          <p className="text-sm text-gray-500 mt-0.5">Define attributes like Size, Color, Material and their possible values</p>
        </div>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" /> New Variant Type
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">
              {editId ? 'Edit Variant Type' : 'New Variant Type'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Attribute Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Size, Color, Material"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Values</label>
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Type a value and press Enter"
                    value={valueInput}
                    onChange={e => setValueInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValue(); } }}
                  />
                  <button
                    type="button"
                    onClick={addValue}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 min-h-[2rem]">
                  {values.map(v => (
                    <span key={v} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 text-blue-800 px-2.5 py-1 rounded-lg text-xs font-medium">
                      {v}
                      <button onClick={() => removeValue(v)} className="text-blue-400 hover:text-red-500 ml-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {values.length === 0 && <span className="text-xs text-gray-400">No values yet</span>}
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-3">
                <button
                  onClick={() => save.mutate()}
                  disabled={!name || save.isPending}
                  className="flex-1 flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  <Check className="h-4 w-4" /> {save.isPending ? 'Saving...' : 'Save'}
                </button>
                <button onClick={reset} className="flex-1 border border-gray-200 text-gray-600 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* List */}
        <div className={showForm ? '' : 'lg:col-span-2'}>
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 h-32 animate-pulse" />
              ))}
            </div>
          ) : (types ?? []).length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <Layers className="h-12 w-12 mx-auto mb-3 text-gray-200" />
              <p className="font-medium text-gray-600">No variant types yet</p>
              <p className="text-sm mt-1">Create your first variant type (e.g. Size with values 36, 37, 38...)</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {(types ?? []).map((t: any) => (
                <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Tag className="h-4 w-4 text-blue-500" />
                      <h3 className="font-semibold text-gray-900">{t.name}</h3>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setRelatedType(t)} title="Related Items" className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors">
                        <Package className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => startEdit(t)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => del.mutate(t.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(t.values ?? []).map((v: string) => (
                      <span key={v} className="bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded-md font-medium">{v}</span>
                    ))}
                    {(t.values ?? []).length === 0 && <span className="text-xs text-gray-400">No values defined</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-3">{t.values?.length ?? 0} values</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
