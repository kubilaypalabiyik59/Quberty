'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState } from 'react';
import { Plus, Trash2, Tag } from 'lucide-react';

export default function CategoriesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const { data: categories, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get('/products/categories').then(r => r.data.data),
  });

  const create = useMutation({
    mutationFn: () => api.post('/products/categories', { name, code: code || name.toUpperCase().replace(/\s+/g, '-') }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); setName(''); setCode(''); setError(''); },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to create category'),
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Tag className="h-5 w-5 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
          <p className="text-sm text-gray-500">Organise your products into categories</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Create form */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">New Category</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. Sneakers"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Code</label>
              <input
                type="text"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Auto-generated if blank"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              onClick={() => create.mutate()}
              disabled={!name || create.isPending}
              className="w-full flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="h-4 w-4" /> Create Category
            </button>
          </div>
        </div>

        {/* List */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Existing Categories</h2>
          </div>
          {isLoading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (categories ?? []).length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">No categories yet.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {(categories ?? []).map((cat: any) => (
                <li key={cat.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{cat.name}</span>
                    <span className="ml-2 text-xs font-mono text-gray-400">{cat.code}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
