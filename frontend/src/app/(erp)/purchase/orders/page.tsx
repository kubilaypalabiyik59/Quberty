'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, ShoppingCart, Check, X, AlertCircle, Truck, Package, Paperclip, Pencil, CheckCircle, Banknote } from 'lucide-react';

const STATUS_BADGE: Record<string, string> = {
  DRAFT:              'bg-gray-100 text-gray-600',
  CONFIRMED:          'bg-blue-100 text-blue-700',
  RECEIVED:           'bg-green-100 text-green-700',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-700',
  CANCELLED:          'bg-red-100 text-red-600',
};

// ── Pay Supplier Modal ─────────────────────────────────────────────────────────
function PayModal({ po, onClose, onSuccess }: { po: any; onClose: () => void; onSuccess: () => void }) {
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [accountCode, setAccountCode] = useState('1102');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const pay = useMutation({
    mutationFn: () => api.post(`/purchase/orders/${po.id}/pay`, {
      payment_date: paymentDate,
      account_code: accountCode,
      notes: notes || undefined,
    }),
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Payment failed'),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-purple-100 rounded-xl flex items-center justify-center">
              <Banknote className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Pay Supplier</h2>
              <p className="text-xs text-gray-500 font-mono">{po.po_number} · Bs. {Number(po.total_amount).toLocaleString()}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            Records a payment journal entry:<br />
            <span className="font-mono text-xs">Dr Cuentas por Pagar (2101) / Cr selected account</span>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Payment Date</label>
            <input type="date"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Pay From</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              value={accountCode} onChange={e => setAccountCode(e.target.value)}>
              <option value="1102">1102 — Bancos</option>
              <option value="1101">1101 — Caja (Cash)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes (optional)</label>
            <input type="text"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="e.g. Transfer ref #12345"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button onClick={() => pay.mutate()} disabled={pay.isPending}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium">
            <Banknote className="h-4 w-4" /> {pay.isPending ? 'Processing...' : 'Record Payment'}
          </button>
          <button onClick={onClose} className="border border-gray-200 text-gray-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

interface POLine {
  product_id: string;
  variant_id?: string;
  quantity: string;
  unit_cost: string;
}

// ── Receive Modal ──────────────────────────────────────────────────────────────
function ReceiveModal({ po, onClose, onSuccess }: { po: any; onClose: () => void; onSuccess: () => void }) {
  const [locationId, setLocationId] = useState('');
  const [wantPackingSlip, setWantPackingSlip] = useState<boolean | null>(null);
  const [packingSlipUrl, setPackingSlipUrl] = useState('');
  const [error, setError] = useState('');

  const { data: locations } = useQuery({
    queryKey: ['all-locations'],
    queryFn: () => api.get('/warehouse/locations').then(r => r.data.data),
  });

  const receive = useMutation({
    mutationFn: () => api.post(`/purchase/orders/${po.id}/receive`, {
      receive_location_id: locationId,
      packing_slip_url: wantPackingSlip && packingSlipUrl ? packingSlipUrl : undefined,
    }),
    onSuccess: () => { onSuccess(); onClose(); },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to receive PO'),
  });

  const canSubmit = locationId && (wantPackingSlip === false || (wantPackingSlip === true && packingSlipUrl));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-green-100 rounded-xl flex items-center justify-center">
              <Truck className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Receive Purchase Order</h2>
              <p className="text-xs text-gray-500 font-mono">{po.po_number}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Order Lines</p>
            <div className="space-y-1.5">
              {(po.lines ?? []).map((line: any) => (
                <div key={line.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="text-gray-700">{line.product?.name ?? line.product_id}</span>
                    {line.variant_id && (
                      <span className="ml-2 text-xs font-mono bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">
                        {line.product?.variants?.find((v: any) => v.id === line.variant_id)?.sku_variant ?? line.variant_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                  <span className="font-medium text-gray-900">× {line.quantity}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-200 mt-3 pt-3 flex justify-between text-sm font-semibold">
              <span className="text-gray-500">Supplier</span>
              <span className="text-gray-900">{po.supplier?.name ?? '—'}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Receive Into Location <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              value={locationId}
              onChange={e => setLocationId(e.target.value)}
            >
              <option value="">— Select warehouse location —</option>
              {(locations ?? []).map((loc: any) => (
                <option key={loc.id} value={loc.id}>
                  {loc.zone?.name ? `${loc.zone.name} → ` : ''}{loc.name ?? loc.code} ({loc.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Attach a Packing Slip?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setWantPackingSlip(true)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${wantPackingSlip === true ? 'bg-gray-900 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
              >
                <Paperclip className="h-4 w-4" /> Yes, attach slip
              </button>
              <button
                onClick={() => { setWantPackingSlip(false); setPackingSlipUrl(''); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all ${wantPackingSlip === false ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
              >
                <Package className="h-4 w-4" /> No, just receive
              </button>
            </div>
          </div>

          {wantPackingSlip === true && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Packing Slip URL <span className="text-red-500">*</span></label>
              <input type="url" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://..." value={packingSlipUrl} onChange={e => setPackingSlipUrl(e.target.value)} />
              <p className="text-xs text-gray-400 mt-1">Upload the slip to cloud storage and paste the URL here.</p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button onClick={() => receive.mutate()} disabled={!canSubmit || receive.isPending}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium">
            <Truck className="h-4 w-4" /> {receive.isPending ? 'Receiving...' : 'Confirm & Receive'}
          </button>
          <button onClick={onClose} className="border border-gray-200 text-gray-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── PO Form (create & edit) ───────────────────────────────────────────────────
function POForm({
  title,
  initial,
  onSubmit,
  onCancel,
  isPending,
  error,
}: {
  title: string;
  initial?: any;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string;
}) {
  const [form, setForm] = useState({
    supplier_id: initial?.supplier_id ?? '',
    warehouse_id: initial?.warehouse_id ?? '',
    expected_date: initial?.expected_date ? initial.expected_date.split('T')[0] : '',
    notes: initial?.notes ?? '',
  });
  const [lines, setLines] = useState<POLine[]>(
    initial?.lines?.length
      ? initial.lines.map((l: any) => ({
          product_id: l.product_id,
          variant_id: l.variant_id ?? '',
          quantity: String(l.quantity),
          unit_cost: String(l.unit_cost),
        }))
      : [{ product_id: '', variant_id: '', quantity: '1', unit_cost: '0' }]
  );

  const { data: suppliers } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/purchase/suppliers').then(r => r.data.data),
  });
  const { data: warehouses } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouse/warehouses').then(r => r.data.data),
  });
  const { data: productsData } = useQuery({
    queryKey: ['erp-products-with-variants'],
    queryFn: () => api.get('/products?limit=200').then(r => r.data.data),
  });

  const products: any[] = productsData ?? [];

  const addLine = () => setLines(p => [...p, { product_id: '', variant_id: '', quantity: '1', unit_cost: '0' }]);
  const removeLine = (i: number) => setLines(p => p.filter((_, j) => j !== i));
  const updateLine = (i: number, field: keyof POLine, val: string) =>
    setLines(p => p.map((l, j) => j === i ? { ...l, [field]: val, ...(field === 'product_id' ? { variant_id: '' } : {}) } : l));

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0);

  const handleSubmit = () => {
    onSubmit({
      supplier_id:   form.supplier_id   || undefined,
      warehouse_id:  form.warehouse_id  || undefined,
      expected_date: form.expected_date || undefined,
      notes:         form.notes         || undefined,
      lines: lines.filter(l => l.product_id).map(l => ({
        product_id: l.product_id,
        variant_id: l.variant_id || null,
        quantity: Number(l.quantity),
        unit_cost: Number(l.unit_cost),
      })),
    });
  };

  return (
    <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 mb-6">
      <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-5">{title}</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Supplier <span className="text-red-500">*</span></label>
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.supplier_id} onChange={e => setForm(p => ({ ...p, supplier_id: e.target.value }))}>
            <option value="">— Select supplier —</option>
            {(suppliers ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse <span className="text-red-500">*</span></label>
          <select className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.warehouse_id} onChange={e => setForm(p => ({ ...p, warehouse_id: e.target.value }))}>
            <option value="">— Select warehouse —</option>
            {(warehouses ?? []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Expected Date</label>
          <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={form.expected_date} onChange={e => setForm(p => ({ ...p, expected_date: e.target.value }))} />
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
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 w-28">Unit Cost (Bs.)</th>
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
                      <select
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={line.product_id}
                        onChange={e => updateLine(i, 'product_id', e.target.value)}
                      >
                        <option value="">— Pick product —</option>
                        {products.map((p: any) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {variants.length > 0 ? (
                        <select
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                          value={line.variant_id ?? ''}
                          onChange={e => updateLine(i, 'variant_id', e.target.value)}
                        >
                          <option value="">— All / No variant —</option>
                          {variants.map((v: any) => {
                            const attrs = v.attributes ? Object.values(v.attributes as Record<string, string>).join(' / ') : '';
                            return (
                              <option key={v.id} value={v.id}>
                                {v.sku_variant}{attrs ? ` (${attrs})` : ''}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <span className="text-xs text-gray-300 px-2">No variants</span>
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
                        value={line.unit_cost} onChange={e => updateLine(i, 'unit_cost', e.target.value)} />
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-medium text-gray-700">
                      Bs. {((Number(line.quantity) || 0) * (Number(line.unit_cost) || 0)).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {lines.length > 1 && (
                        <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500 transition-colors">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-gray-50 border-t border-gray-200">
              <tr>
                <td colSpan={4} className="px-3 py-2 text-right text-sm font-semibold text-gray-700">Subtotal:</td>
                <td className="px-3 py-2 text-right text-sm font-bold text-gray-900">Bs. {subtotal.toLocaleString()}</td>
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
        <button onClick={handleSubmit}
          disabled={!form.supplier_id || !form.warehouse_id || lines.every(l => !l.product_id) || isPending}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium">
          <Check className="h-4 w-4" /> {isPending ? 'Saving...' : initial ? 'Save Changes' : 'Create Purchase Order'}
        </button>
        <button onClick={onCancel} className="border border-gray-200 text-gray-600 px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function PurchaseOrdersPage() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [editingPO, setEditingPO] = useState<any | null>(null);
  const [receivePO, setReceivePO] = useState<any | null>(null);
  const [payPO, setPayPO] = useState<any | null>(null);
  const [formError, setFormError] = useState('');
  const [page] = useState(1);

  const { data: orders, isLoading } = useQuery({
    queryKey: ['purchase-orders', page],
    queryFn: () => api.get(`/purchase/orders?page=${page}&limit=20`).then(r => ({ orders: r.data.data, total: r.data.meta?.total ?? 0 })),
  });

  const create = useMutation({
    mutationFn: (data: any) => api.post('/purchase/orders', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); setMode('list'); setFormError(''); },
    onError: (err: any) => setFormError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to create PO'),
  });

  const update = useMutation({
    mutationFn: (data: any) => api.put(`/purchase/orders/${editingPO.id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-orders'] }); setMode('list'); setEditingPO(null); setFormError(''); },
    onError: (err: any) => setFormError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to update PO'),
  });

  const confirm = useMutation({
    mutationFn: (id: string) => api.post(`/purchase/orders/${id}/confirm`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-orders'] }),
    onError: (err: any) => alert(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to confirm PO'),
  });

  const handleEdit = (po: any) => {
    setEditingPO(po);
    setFormError('');
    setMode('edit');
  };

  if (mode === 'create') {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">New Purchase Order</h1>
        <POForm
          title="New Purchase Order"
          onSubmit={(data) => create.mutate(data)}
          onCancel={() => { setMode('list'); setFormError(''); }}
          isPending={create.isPending}
          error={formError}
        />
      </div>
    );
  }

  if (mode === 'edit' && editingPO) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Edit Purchase Order — <span className="font-mono text-blue-600">{editingPO.po_number}</span></h1>
        <POForm
          title="Edit Purchase Order"
          initial={editingPO}
          onSubmit={(data) => update.mutate(data)}
          onCancel={() => { setMode('list'); setEditingPO(null); setFormError(''); }}
          isPending={update.isPending}
          error={formError}
        />
      </div>
    );
  }

  return (
    <div>
      {receivePO && (
        <ReceiveModal
          po={receivePO}
          onClose={() => setReceivePO(null)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['purchase-orders'] })}
        />
      )}
      {payPO && (
        <PayModal
          po={payPO}
          onClose={() => setPayPO(null)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['purchase-orders'] })}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Purchase Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage supplier purchase orders</p>
        </div>
        <button onClick={() => { setMode('create'); setFormError(''); }}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus className="h-4 w-4" /> New PO
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">PO #</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Supplier</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Lines</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 3 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
              ))}</tr>
            ))}
            {!isLoading && (orders?.orders ?? []).length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-gray-400">
                  <ShoppingCart className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                  <p>No purchase orders yet.</p>
                </td>
              </tr>
            )}
            {(orders?.orders ?? []).map((o: any) => (
              <tr key={o.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-mono font-semibold text-gray-900">{o.po_number}</td>
                <td className="px-4 py-3 text-gray-700">{o.supplier?.name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {(o.lines ?? []).length} line{(o.lines ?? []).length !== 1 ? 's' : ''}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_BADGE[o.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">{new Date(o.order_date ?? o.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right font-medium text-gray-900">
                  Bs. {Number(o.total_amount).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {o.status === 'DRAFT' && (
                      <>
                        <button onClick={() => handleEdit(o)}
                          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-700 font-medium bg-gray-50 hover:bg-blue-50 px-2.5 py-1.5 rounded-lg transition-colors">
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button onClick={() => confirm.mutate(o.id)} disabled={confirm.isPending}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors">
                          <CheckCircle className="h-3.5 w-3.5" /> Confirm
                        </button>
                      </>
                    )}
                    {o.status === 'CONFIRMED' && (
                      <button onClick={() => setReceivePO(o)}
                        className="inline-flex items-center gap-1.5 text-xs text-green-600 hover:text-green-800 font-medium bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors">
                        <Truck className="h-3.5 w-3.5" /> Receive
                      </button>
                    )}
                    {o.status === 'RECEIVED' && !o.paid_at && (
                      <button onClick={() => setPayPO(o)}
                        className="inline-flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 font-medium bg-purple-50 hover:bg-purple-100 px-3 py-1.5 rounded-lg transition-colors">
                        <Banknote className="h-3.5 w-3.5" /> Pay Supplier
                      </button>
                    )}
                    {o.paid_at && (
                      <span className="inline-flex items-center gap-1 text-xs text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full font-medium">
                        <CheckCircle className="h-3 w-3" /> Paid
                      </span>
                    )}
                    {o.status === 'RECEIVED' && o.packing_slip_url && (
                      <a href={o.packing_slip_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700">
                        <Paperclip className="h-3 w-3" /> Slip
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
