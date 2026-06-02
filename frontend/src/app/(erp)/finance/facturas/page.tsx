'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Check, FileText, AlertCircle, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { FacturaPDFButton } from '@/components/erp/finance/FacturaPDFButton';

export default function FacturasPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    customer_name: '',
    customer_nit: '',
    total_amount: '',
    invoice_date: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const { data: facturasData, isLoading } = useQuery({
    queryKey: ['facturas'],
    queryFn: () => api.get('/finance/facturas?limit=100').then(r => ({ facturas: r.data.data })),
  });

  const reset = () => { setShowForm(false); setForm({ customer_name: '', customer_nit: '', total_amount: '', invoice_date: new Date().toISOString().split('T')[0], notes: '' }); setError(''); };

  const create = useMutation({
    mutationFn: () => api.post('/finance/facturas', { ...form, total_amount: Number(form.total_amount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['facturas'] }); reset(); },
    onError: (err: any) => setError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to create factura'),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/finance/facturas/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['facturas'] }),
    onError: (err: any) => alert(err.response?.data?.message ?? 'Failed to cancel'),
  });

  const total = Number(form.total_amount) || 0;
  const subtotal = total / 1.13;
  const iva = total - subtotal;
  const it = subtotal * 0.03;

  const invoiceLabel = (facturasData?.facturas?.[0] as any)?.invoice_metadata?.invoice_label ?? 'Factura';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{invoiceLabel}s</h1>
          <p className="text-sm text-gray-500 mt-0.5">Libro de Ventas — tax invoices with IVA 13% + IT 3%</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus className="h-4 w-4" /> New {invoiceLabel}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-blue-200 shadow-sm p-6 mb-6">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">New {invoiceLabel}</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name <span className="text-red-500">*</span></label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Nombre del cliente"
                value={form.customer_name} onChange={e => setForm(p => ({ ...p, customer_name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">NIT / CI</label>
              <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 1234567"
                value={form.customer_nit} onChange={e => setForm(p => ({ ...p, customer_nit: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Date</label>
              <input type="date" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.invoice_date} onChange={e => setForm(p => ({ ...p, invoice_date: e.target.value }))} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount (Bs.) <span className="text-red-500">*</span></label>
              <input type="number" min="0" step="0.01" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00" value={form.total_amount} onChange={e => setForm(p => ({ ...p, total_amount: e.target.value }))} />
            </div>
          </div>

          {total > 0 && (
            <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm space-y-1">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal (sin IVA)</span>
                <span>Bs. {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>IVA 13% (incluido)</span>
                <span>Bs. {iva.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>IT 3% (sobre subtotal)</span>
                <span>Bs. {it.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1">
                <span>Total</span>
                <span>Bs. {total.toFixed(2)}</span>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => create.mutate()} disabled={!form.customer_name || !form.total_amount || create.isPending}
              className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-medium">
              <Check className="h-4 w-4" /> {create.isPending ? 'Creating...' : `Issue ${invoiceLabel}`}
            </button>
            <button onClick={reset} className="border border-gray-200 text-gray-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">{invoiceLabel} #</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">NIT/CI</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Source</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Subtotal</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">IVA 13%</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">IT 3%</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
              <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && Array.from({ length: 3 }).map((_, i) => (
              <tr key={i}>{Array.from({ length: 11 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>)}</tr>
            ))}
            {!isLoading && (facturasData?.facturas ?? []).length === 0 && (
              <tr><td colSpan={11} className="px-4 py-16 text-center text-gray-400">
                <FileText className="h-10 w-10 mx-auto mb-2 text-gray-200" />
                <p>No facturas yet.</p>
              </td></tr>
            )}
            {(facturasData?.facturas ?? []).map((f: any) => (
              <tr key={f.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono font-bold text-gray-900">{String(f.factura_number).padStart(6, '0')}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{new Date(f.invoice_date).toLocaleDateString()}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{f.customer_name}</td>
                <td className="px-4 py-3 font-mono text-xs text-gray-400">{f.customer_nit ?? '—'}</td>
                <td className="px-4 py-3">
                  {f.source_type === 'SALE' && f.source_id ? (
                    <Link href={`/sales/orders/${f.source_id}`}
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium">
                      <ExternalLink className="h-3 w-3" /> Sales Order
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400">Manual</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-gray-700">Bs. {Number(f.subtotal).toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-gray-700">Bs. {Number(f.iva_amount).toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-gray-700">Bs. {Number(f.it_amount).toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-bold text-gray-900">Bs. {Number(f.total_amount).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${f.status === 'ISSUED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {f.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FacturaPDFButton factura={f} variant="both" />
                    {f.status === 'ISSUED' && (
                      <button onClick={() => cancel.mutate(f.id)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1">
                        <X className="h-3 w-3" /> Cancel
                      </button>
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
