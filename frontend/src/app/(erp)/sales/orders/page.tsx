'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, X, Check, AlertCircle, FileText, CheckCircle, Truck, PackageCheck, Ban, Eye, ShoppingBag, Banknote, Pencil, RotateCcw } from 'lucide-react';
import Link from 'next/link';

const STATUS_BADGE: Record<string, string> = {
  DRAFT:     'bg-gray-100 text-gray-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  PICKING:   'bg-yellow-100 text-yellow-700',
  PACKED:    'bg-purple-100 text-purple-700',
  SHIPPED:   'bg-orange-100 text-orange-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600',
  RETURNED:  'bg-pink-100 text-pink-700',
};

const INVOICEABLE = ['CONFIRMED', 'PICKING', 'PACKED', 'SHIPPED', 'COMPLETED'];

interface SOLine { product_id: string; variant_id?: string; quantity: string; unit_price: string; discount_pct?: string; }

// ── Invoice Modal ─────────────────────────────────────────────────────────────
function InvoiceModal({ order, onClose, onSuccess }: { order: any; onClose: () => void; onSuccess: () => void }) {
  const [nit, setNit] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const customerName = order.customer
    ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
    : (order.shipping_address as any)?.name ?? 'Cliente Mostrador';

  const total = Number(order.total_amount);
  const subtotal = total / 1.13;
  const iva = total - subtotal;
  const it = subtotal * 0.03;

  const create = useMutation({
    mutationFn: () => api.post(`/sales/orders/${order.id}/invoice`, { customer_nit: nit, notes }),
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to create invoice'),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Fatura Oluştur</h2>
            <p className="text-sm text-gray-400 mt-0.5">Issue invoice for {order.order_number}</p>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Customer</p>
            <p className="font-medium text-gray-900">{customerName}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">NIT / CI <span className="text-gray-400 font-normal">(optional)</span></label>
            <input className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. 12345678" value={nit} onChange={e => setNit(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <input className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={`Factura por Orden ${order.order_number}`} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal neto (sin IVA)</span><span>Bs. {subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between text-blue-700"><span>IVA 13% (incluido)</span><span>Bs. {iva.toFixed(2)}</span></div>
            <div className="flex justify-between text-orange-600"><span>IT 3% (sobre neto)</span><span>Bs. {it.toFixed(2)}</span></div>
            <div className="flex justify-between font-bold text-gray-900 border-t border-blue-200 pt-2"><span>Total</span><span>Bs. {total.toFixed(2)}</span></div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</p>}
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={() => create.mutate()} disabled={create.isPending}
            className="flex-1 flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white py-3 rounded-xl font-semibold text-sm">
            <FileText className="h-4 w-4" /> {create.isPending ? 'Issuing...' : 'Issue Factura'}
          </button>
          <button onClick={onClose} className="px-5 py-3 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── SO Form (create) ──────────────────────────────────────────────────────────
function SOForm({ onSubmit, onCancel, isPending, error }: {
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string;
}) {
  const [form, setForm] = useState({ customer_id: '', warehouse_id: '', notes: '', discount_amount: '' });
  const [lines, setLines] = useState<SOLine[]>([{ product_id: '', variant_id: '', quantity: '1', unit_price: '0' }]);

  const { data: customers } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => api.get('/customers?limit=200').then(r => r.data.data?.customers ?? r.data.data ?? []),
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouse/warehouses').then(r => r.data.data),
  });
  const { data: productsData } = useQuery({
    queryKey: ['so-products'],
    queryFn: () => api.get('/products?limit=200').then(r => r.data.data),
  });

  const products: any[] = productsData ?? [];

  const addLine = () => setLines(p => [...p, { product_id: '', variant_id: '', quantity: '1', unit_price: '0' }]);
  const removeLine = (i: number) => setLines(p => p.filter((_, j) => j !== i));
  const updateLine = (i: number, field: keyof SOLine, val: string) =>
    setLines(p => p.map((l, j) => {
      if (j !== i) return l;
      if (field === 'product_id') {
        const prod = products.find((p: any) => p.id === val);
        return { ...l, product_id: val, variant_id: '', unit_price: prod ? String(Number(prod.sale_price ?? prod.selling_price)) : '0' };
      }
      return { ...l, [field]: val };
    }));

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const discount = Number(form.discount_amount) || 0;
  const total = subtotal - discount;

  return (
    <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 mb-6">
      <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-5">New Sales Order</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))}>
            <option value="">— Walk-in / No customer —</option>
            {(customers ?? []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.code})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse (for stock picking)</label>
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.warehouse_id} onChange={e => setForm(p => ({ ...p, warehouse_id: e.target.value }))}>
            <option value="">— Select warehouse —</option>
            {(warehouses ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Discount Amount (Bs.)</label>
          <input type="number" min="0" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0.00" value={form.discount_amount} onChange={e => setForm(p => ({ ...p, discount_amount: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <input type="text" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Optional notes" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
      </div>

      {/* Lines */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Order Lines</h3>
          <button onClick={addLine} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1">
            <Plus className="h-3 w-3" /> Add line
          </button>
        </div>
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Product</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 w-44">Variant</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 w-20">Qty</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 w-28">Unit Price (Bs.)</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 w-24">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line, i) => {
                const selectedProduct = products.find((p: any) => p.id === line.product_id);
                const variants: any[] = selectedProduct?.variants ?? [];
                return (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <select className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={line.product_id} onChange={e => updateLine(i, 'product_id', e.target.value)}>
                        <option value="">— Pick product —</option>
                        {products.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {variants.length > 0 ? (
                        <select className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={line.variant_id ?? ''} onChange={e => updateLine(i, 'variant_id', e.target.value)}>
                          <option value="">— No variant —</option>
                          {variants.map((v: any) => {
                            const attrs = v.attributes ? Object.values(v.attributes as Record<string, string>).join(' / ') : '';
                            return <option key={v.id} value={v.id}>{v.sku_variant}{attrs ? ` (${attrs})` : ''}</option>;
                          })}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-300 px-2">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="1" step="1"
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={line.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01"
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={line.unit_price} onChange={e => updateLine(i, 'unit_price', e.target.value)} />
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-medium text-gray-700">
                      Bs. {((Number(line.quantity) || 0) * (Number(line.unit_price) || 0)).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {lines.length > 1 && (
                        <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500"><X className="h-4 w-4" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              {discount > 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-right text-xs text-gray-500">Subtotal:</td>
                  <td className="px-3 py-1.5 text-right text-xs text-gray-600">Bs. {subtotal.toLocaleString()}</td>
                  <td />
                </tr>
              )}
              {discount > 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-right text-xs text-red-500">Discount:</td>
                  <td className="px-3 py-1.5 text-right text-xs text-red-500">-Bs. {discount.toLocaleString()}</td>
                  <td />
                </tr>
              )}
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-sm font-semibold text-gray-700">Total:</td>
                <td className="px-3 py-2 text-right text-sm font-bold text-gray-900">Bs. {total.toLocaleString()}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => onSubmit({
          customer_id: form.customer_id || undefined,
          warehouse_id: form.warehouse_id || undefined,
          notes: form.notes || undefined,
          discount_amount: Number(form.discount_amount) || 0,
          currency: 'BOB',
          lines: lines.filter(l => l.product_id).map(l => ({
            product_id: l.product_id,
            variant_id: l.variant_id || null,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
          })),
        })}
          disabled={lines.every(l => !l.product_id) || isPending}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
          <Check className="h-4 w-4" /> {isPending ? 'Creating...' : 'Create Sales Order'}
        </button>
        <button onClick={onCancel} className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── SO Edit Form ──────────────────────────────────────────────────────────────
function SOEditForm({ order, onSubmit, onCancel, isPending, error }: {
  order: any;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string;
}) {
  const [form, setForm] = useState({
    customer_id: order.customer_id ?? '',
    warehouse_id: order.warehouse_id ?? '',
    notes: order.notes ?? '',
    discount_amount: String(order.discount_amount ?? '0'),
  });
  const [lines, setLines] = useState<SOLine[]>(
    (order.lines ?? []).map((l: any) => ({
      product_id: l.product_id ?? '',
      variant_id: l.variant_id ?? '',
      quantity: String(l.quantity),
      unit_price: String(l.unit_price),
    }))
  );

  const { data: customers } = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => api.get('/customers?limit=200').then(r => r.data.data?.customers ?? r.data.data ?? []),
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouse/warehouses').then(r => r.data.data),
  });
  const { data: productsData } = useQuery({
    queryKey: ['so-products'],
    queryFn: () => api.get('/products?limit=200').then(r => r.data.data),
  });

  const products: any[] = productsData ?? [];

  const addLine = () => setLines(p => [...p, { product_id: '', variant_id: '', quantity: '1', unit_price: '0' }]);
  const removeLine = (i: number) => setLines(p => p.filter((_, j) => j !== i));
  const updateLine = (i: number, field: keyof SOLine, val: string) =>
    setLines(p => p.map((l, j) => {
      if (j !== i) return l;
      if (field === 'product_id') {
        const prod = products.find((p: any) => p.id === val);
        return { ...l, product_id: val, variant_id: '', unit_price: prod ? String(Number(prod.sale_price ?? prod.selling_price)) : '0' };
      }
      return { ...l, [field]: val };
    }));

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);
  const discount = Number(form.discount_amount) || 0;
  const total = subtotal - discount;

  return (
    <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-6 mb-6">
      <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-5">
        Edit Sales Order — {order.order_number}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))}>
            <option value="">— Walk-in / No customer —</option>
            {(customers ?? []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.code})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse</label>
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            value={form.warehouse_id} onChange={e => setForm(p => ({ ...p, warehouse_id: e.target.value }))}>
            <option value="">— Select warehouse —</option>
            {(warehouses ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Discount Amount (Bs.)</label>
          <input type="number" min="0" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            value={form.discount_amount} onChange={e => setForm(p => ({ ...p, discount_amount: e.target.value }))} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <input type="text" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
        </div>
      </div>

      {/* Lines */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Order Lines</h3>
          <button onClick={addLine} className="text-xs text-amber-600 hover:text-amber-800 font-medium flex items-center gap-1">
            <Plus className="h-3 w-3" /> Add line
          </button>
        </div>
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Product</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 w-44">Variant</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 w-20">Qty</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 w-28">Unit Price (Bs.)</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 w-24">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((line, i) => {
                const selectedProduct = products.find((p: any) => p.id === line.product_id);
                const variants: any[] = selectedProduct?.variants ?? [];
                return (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <select className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                        value={line.product_id} onChange={e => updateLine(i, 'product_id', e.target.value)}>
                        <option value="">— Pick product —</option>
                        {products.map((p: any) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {variants.length > 0 ? (
                        <select className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                          value={line.variant_id ?? ''} onChange={e => updateLine(i, 'variant_id', e.target.value)}>
                          <option value="">— No variant —</option>
                          {variants.map((v: any) => {
                            const attrs = v.attributes ? Object.values(v.attributes as Record<string, string>).join(' / ') : '';
                            return <option key={v.id} value={v.id}>{v.sku_variant}{attrs ? ` (${attrs})` : ''}</option>;
                          })}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-300 px-2">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="1" step="1"
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-amber-500"
                        value={line.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01"
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-right focus:outline-none focus:ring-2 focus:ring-amber-500"
                        value={line.unit_price} onChange={e => updateLine(i, 'unit_price', e.target.value)} />
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-medium text-gray-700">
                      Bs. {((Number(line.quantity) || 0) * (Number(line.unit_price) || 0)).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {lines.length > 1 && (
                        <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500"><X className="h-4 w-4" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              {discount > 0 && (
                <>
                  <tr>
                    <td colSpan={4} className="px-3 py-1.5 text-right text-xs text-gray-500">Subtotal:</td>
                    <td className="px-3 py-1.5 text-right text-xs text-gray-600">Bs. {subtotal.toLocaleString()}</td>
                    <td />
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-3 py-1.5 text-right text-xs text-red-500">Discount:</td>
                    <td className="px-3 py-1.5 text-right text-xs text-red-500">-Bs. {discount.toLocaleString()}</td>
                    <td />
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-sm font-semibold text-gray-700">Total:</td>
                <td className="px-3 py-2 text-right text-sm font-bold text-gray-900">Bs. {total.toLocaleString()}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => onSubmit({
          customer_id: form.customer_id || undefined,
          warehouse_id: form.warehouse_id || undefined,
          notes: form.notes || undefined,
          discount_amount: Number(form.discount_amount) || 0,
          lines: lines.filter(l => l.product_id).map(l => ({
            product_id: l.product_id,
            variant_id: l.variant_id || null,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_price),
          })),
        })}
          disabled={lines.every(l => !l.product_id) || isPending}
          className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
          <Check className="h-4 w-4" /> {isPending ? 'Saving...' : 'Save Changes'}
        </button>
        <button onClick={onCancel} className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── AR Payment Modal ──────────────────────────────────────────────────────────
function ARPayModal({ order, onClose, onSuccess }: { order: any; onClose: () => void; onSuccess: () => void }) {
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [accountCode, setAccountCode] = useState('1102');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const pay = useMutation({
    mutationFn: () => api.post(`/sales/orders/${order.id}/pay`, { payment_date: paymentDate, account_code: accountCode, notes: notes || undefined }),
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Payment failed'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center">
              <Banknote className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Collect Payment</h2>
              <p className="text-xs text-gray-500 font-mono">{order.order_number} · Bs. {Number(order.total_amount).toLocaleString()}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800">
            Posts journal entry:<br />
            <span className="font-mono text-xs">Dr Banco/Caja / Cr Cuentas por Cobrar (1103)</span>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Payment Date</label>
            <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Received Into</label>
            <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              value={accountCode} onChange={e => setAccountCode(e.target.value)}>
              <option value="1102">1102 — Bancos</option>
              <option value="1101">1101 — Caja (Cash)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
            <input type="text" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="e.g. Bank transfer ref #..." value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button onClick={() => pay.mutate()} disabled={pay.isPending}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium">
            <Banknote className="h-4 w-4" /> {pay.isPending ? 'Processing...' : 'Record Payment'}
          </button>
          <button onClick={onClose} className="border border-gray-200 text-gray-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SalesOrdersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [editOrder, setEditOrder] = useState<any | null>(null);
  const [editError, setEditError] = useState('');
  const [invoiceOrder, setInvoiceOrder] = useState<any | null>(null);
  const [payOrder, setPayOrder] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['sales-orders', page, statusFilter],
    queryFn: () =>
      api.get(`/sales/orders?page=${page}&limit=20${statusFilter ? `&status=${statusFilter}` : ''}`).then(r => r.data.data),
  });

  const orders: any[] = data?.orders ?? [];
  const total: number = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  const apiErr = (err: any) =>
    err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Action failed';

  const create = useMutation({
    mutationFn: (d: any) => api.post('/sales/orders', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-orders'] }); setShowForm(false); setFormError(''); },
    onError: (err: any) => setFormError(apiErr(err)),
  });

  const edit = useMutation({
    mutationFn: (d: any) => api.put(`/sales/orders/${editOrder!.id}`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-orders'] }); setEditOrder(null); setEditError(''); },
    onError: (err: any) => setEditError(apiErr(err)),
  });

  const confirm = useMutation({
    mutationFn: (id: string) => api.post(`/sales/orders/${id}/confirm`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-orders'] }),
    onError: (err: any) => alert(apiErr(err)),
  });

  const ship = useMutation({
    mutationFn: (id: string) => api.post(`/sales/orders/${id}/ship`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-orders'] }),
    onError: (err: any) => alert(apiErr(err)),
  });

  const complete = useMutation({
    mutationFn: (id: string) => api.post(`/sales/orders/${id}/complete`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-orders'] }),
    onError: (err: any) => alert(apiErr(err)),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/sales/orders/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-orders'] }),
    onError: (err: any) => alert(apiErr(err)),
  });

  const returnOrder = useMutation({
    mutationFn: (id: string) => api.post(`/sales/orders/${id}/return`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-orders'] }),
    onError: (err: any) => alert(apiErr(err)),
  });

  if (showForm) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">New Sales Order</h1>
        <SOForm
          onSubmit={(d) => create.mutate(d)}
          onCancel={() => { setShowForm(false); setFormError(''); }}
          isPending={create.isPending}
          error={formError}
        />
      </div>
    );
  }

  if (editOrder) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Sales Order</h1>
        <SOEditForm
          order={editOrder}
          onSubmit={(d) => edit.mutate(d)}
          onCancel={() => { setEditOrder(null); setEditError(''); }}
          isPending={edit.isPending}
          error={editError}
        />
      </div>
    );
  }

  return (
    <div>
      {invoiceOrder && (
        <InvoiceModal
          order={invoiceOrder}
          onClose={() => setInvoiceOrder(null)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['sales-orders'] })}
        />
      )}
      {payOrder && (
        <ARPayModal
          order={payOrder}
          onClose={() => setPayOrder(null)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['sales-orders'] })}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage customer orders, shipments and invoices</p>
        </div>
        <button onClick={() => { setShowForm(true); setFormError(''); }}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus className="h-4 w-4" /> New Order
        </button>
      </div>

      {/* Filter */}
      <div className="flex gap-3 mb-5">
        <select
          className="border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {Object.keys(STATUS_BADGE).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="text-sm text-gray-400 self-center">{!isLoading && `${total} orders`}</div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Order #</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Lines</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">By</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Invoice</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 9 }).map((_, j) => (
                <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
              ))}</tr>
            ))}
            {!isLoading && orders.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-16 text-center text-gray-400">
                <ShoppingBag className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                <p>No orders found.</p>
              </td></tr>
            )}
            {orders.map(order => {
              const invoiceable = INVOICEABLE.includes(order.status);
              const hasInvoice = !!order.invoice_id;
              const isPaid = !!order.paid_at;
              return (
                <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/sales/orders/${order.id}`} className="font-mono font-semibold text-blue-600 hover:underline">
                      {order.order_number}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700 text-sm">
                    {order.customer
                      ? `${order.customer.first_name} ${order.customer.last_name}`
                      : <span className="text-gray-400 text-xs">Walk-in</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {(order.lines ?? []).length} line{(order.lines ?? []).length !== 1 ? 's' : ''}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[order.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(order.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs font-mono">{order.created_by ? order.created_by.substring(0, 8) : '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">
                    Bs. {Number(order.total_amount).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      {hasInvoice ? (
                        <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
                          <CheckCircle className="h-3.5 w-3.5" /> Invoiced
                        </span>
                      ) : invoiceable ? (
                        <button onClick={() => setInvoiceOrder(order)}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 hover:border-blue-400 px-2.5 py-1 rounded-lg">
                          <FileText className="h-3 w-3" /> Issue
                        </button>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                      {hasInvoice && !isPaid && (
                        <button onClick={() => setPayOrder(order)}
                          className="inline-flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 font-medium border border-emerald-200 hover:border-emerald-400 px-2.5 py-1 rounded-lg">
                          <Banknote className="h-3 w-3" /> Collect
                        </button>
                      )}
                      {isPaid && (
                        <span className="inline-flex items-center gap-1 text-emerald-600 text-xs font-medium">
                          <Banknote className="h-3 w-3" /> Paid
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {!order.invoice_id && ['DRAFT', 'CONFIRMED'].includes(order.status) && (
                        <button onClick={() => setEditOrder(order)}
                          className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-800 font-medium bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg">
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </button>
                      )}
                      {order.status === 'DRAFT' && (
                        <button onClick={() => confirm.mutate(order.id)} disabled={confirm.isPending}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg">
                          <CheckCircle className="h-3.5 w-3.5" /> Confirm
                        </button>
                      )}
                      {(order.status === 'CONFIRMED' || order.status === 'PACKED') && (
                        <button onClick={() => ship.mutate(order.id)} disabled={ship.isPending}
                          className="inline-flex items-center gap-1 text-xs text-orange-600 hover:text-orange-800 font-medium bg-orange-50 hover:bg-orange-100 px-2.5 py-1.5 rounded-lg">
                          <Truck className="h-3.5 w-3.5" /> Ship
                        </button>
                      )}
                      {order.status === 'SHIPPED' && (
                        <button onClick={() => complete.mutate(order.id)} disabled={complete.isPending}
                          className="inline-flex items-center gap-1 text-xs text-green-600 hover:text-green-800 font-medium bg-green-50 hover:bg-green-100 px-2.5 py-1.5 rounded-lg">
                          <PackageCheck className="h-3.5 w-3.5" /> Complete
                        </button>
                      )}
                      {['DRAFT', 'CONFIRMED'].includes(order.status) && (
                        <button onClick={() => { if (confirm(`Cancel ${order.order_number}?`)) cancel.mutate(order.id); }}
                          className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg">
                          <Ban className="h-3 w-3" /> Cancel
                        </button>
                      )}
                      {['SHIPPED', 'COMPLETED'].includes(order.status) && !(order as any).returned_at && (
                        <button onClick={() => { if (confirm(`Return ${order.order_number}? This will restore stock and create a credit note.`)) returnOrder.mutate(order.id); }}
                          className="inline-flex items-center gap-1 text-xs text-pink-600 hover:text-pink-800 font-medium bg-pink-50 hover:bg-pink-100 px-2.5 py-1.5 rounded-lg">
                          <RotateCcw className="h-3.5 w-3.5" /> Return
                        </button>
                      )}
                      <Link href={`/sales/orders/${order.id}`}
                        className="inline-flex items-center p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
                        <Eye className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <span className="text-sm text-gray-500">Page {page} of {totalPages} ({total} orders)</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Previous</button>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
