'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { X, Plus, Trash2 } from 'lucide-react';

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateOrderModal({ onClose, onSuccess }: Props) {
  const [lines, setLines] = useState([{ product_id: '', quantity: 1, unit_price: 0 }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { data: products } = useQuery({
    queryKey: ['products-list'],
    queryFn: () => api.get('/products?limit=100').then((r) => r.data.data?.products ?? []),
  });

  const addLine = () => setLines([...lines, { product_id: '', quantity: 1, unit_price: 0 }]);
  const removeLine = (i: number) => setLines(lines.filter((_, idx) => idx !== i));

  const updateLine = (i: number, field: string, value: any) => {
    const updated = [...lines];
    if (field === 'product_id') {
      const p = products?.find((p: any) => p.id === value);
      updated[i] = { ...updated[i], product_id: value, unit_price: p ? Number(p.selling_price) : 0 };
    } else {
      updated[i] = { ...updated[i], [field]: value };
    }
    setLines(updated);
  };

  const handleSubmit = async () => {
    if (lines.some((l) => !l.product_id)) { setError('Select a product for each line'); return; }
    setSubmitting(true);
    try {
      await api.post('/sales/orders', { lines });
      onSuccess();
    } catch (e: any) {
      setError(e.response?.data?.message ?? 'Failed to create order');
    } finally {
      setSubmitting(false);
    }
  };

  const total = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-semibold">New Sales Order</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="p-5 space-y-3 max-h-96 overflow-y-auto">
          {lines.map((line, i) => (
            <div key={i} className="flex gap-3 items-center">
              <select
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={line.product_id}
                onChange={(e) => updateLine(i, 'product_id', e.target.value)}
              >
                <option value="">Select product...</option>
                {products?.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                ))}
              </select>
              <input
                type="number" min="1"
                className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={line.quantity}
                onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))}
              />
              <span className="text-sm text-gray-500 w-24 text-right">₺{(line.quantity * line.unit_price).toLocaleString()}</span>
              {lines.length > 1 && (
                <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <button onClick={addLine} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
            <Plus className="h-4 w-4" /> Add line
          </button>
        </div>

        {error && <p className="px-5 text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between p-5 border-t border-gray-200">
          <span className="font-semibold text-gray-800">Total: ₺{total.toLocaleString()}</span>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Order'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
