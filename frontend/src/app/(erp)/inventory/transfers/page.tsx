'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

export default function TransfersPage() {
  const [form, setForm] = useState({ product_id: '', from_location_id: '', to_location_id: '', quantity: 1 });
  const [msg, setMsg] = useState('');

  const { data: products } = useQuery({ queryKey: ['products'], queryFn: () => api.get('/products?limit=100').then(r => r.data.data ?? []) });
  const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: () => api.get('/warehouse/locations').then(r => r.data.data) });

  const mutation = useMutation({
    mutationFn: () => api.post('/inventory/transfers', form),
    onSuccess: () => { setMsg('Transfer completed!'); setForm({ product_id: '', from_location_id: '', to_location_id: '', quantity: 1 }); },
    onError: (e: any) => setMsg(e.response?.data?.message ?? 'Transfer failed'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Stock Transfers</h1>
        <p className="text-gray-500">Move stock between locations</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.product_id} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}>
            <option value="">Select...</option>
            {products?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">From Location</label>
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.from_location_id} onChange={e => setForm(f => ({ ...f, from_location_id: e.target.value }))}>
            <option value="">Select...</option>
            {locations?.map((l: any) => <option key={l.id} value={l.id}>{l.code}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">To Location</label>
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.to_location_id} onChange={e => setForm(f => ({ ...f, to_location_id: e.target.value }))}>
            <option value="">Select...</option>
            {locations?.map((l: any) => <option key={l.id} value={l.id}>{l.code}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
          <input type="number" min="1" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))} />
        </div>
        {msg && <p className="text-sm text-blue-600">{msg}</p>}
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? 'Transferring...' : 'Execute Transfer'}
        </Button>
      </div>
    </div>
  );
}
