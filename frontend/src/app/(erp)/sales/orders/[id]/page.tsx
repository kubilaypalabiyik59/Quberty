'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, FileText, CheckCircle, Truck, Package,
  XCircle, AlertCircle, User, MapPin, Hash, RotateCcw
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { SalesOrderPDFButton } from '@/components/erp/sales/SalesOrderPDFButton';
import { FacturaPDFButton } from '@/components/erp/finance/FacturaPDFButton';

const STATUS_COLORS = {
  DRAFT: 'gray', CONFIRMED: 'blue', PICKING: 'yellow',
  PACKED: 'purple', SHIPPED: 'orange', COMPLETED: 'green', CANCELLED: 'red',
} as const;

const INVOICEABLE_STATUSES = ['CONFIRMED', 'PICKING', 'PACKED', 'SHIPPED', 'COMPLETED'];

export default function OrderDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [nit, setNit] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [invoiceError, setInvoiceError] = useState('');

  const { data: order, isLoading } = useQuery({
    queryKey: ['sales-order', id],
    queryFn: () => api.get(`/sales/orders/${id}`).then(r => r.data.data),
  });

  const createInvoice = useMutation({
    mutationFn: () => api.post(`/sales/orders/${id}/invoice`, { customer_nit: nit, notes: invoiceNotes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
      qc.invalidateQueries({ queryKey: ['sales-orders'] });
      setShowInvoiceForm(false);
      setInvoiceError('');
    },
    onError: (err: any) => setInvoiceError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Failed to issue invoice'),
  });

  // Named `confirmOrder`, not `confirm`: the old name shadowed the global
  // `window.confirm`, so the cancel button below was calling this mutation object
  // as if it were a function. TypeScript caught it — the object is not callable —
  // and it would have thrown at runtime the first time anyone pressed Cancel.
  const confirmOrder = useMutation({
    mutationFn: () => api.post(`/sales/orders/${id}/confirm`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-order', id] }),
  });

  const ship = useMutation({
    mutationFn: () => api.post(`/sales/orders/${id}/ship`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-order', id] }),
  });

  const complete = useMutation({
    mutationFn: () => api.post(`/sales/orders/${id}/complete`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales-order', id] }),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/sales/orders/${id}/cancel`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-order', id] }); router.push('/sales/orders'); },
  });

  const [returnNotes, setReturnNotes] = useState('');
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnError, setReturnError] = useState('');

  const returnOrder = useMutation({
    mutationFn: () => api.post(`/sales/orders/${id}/return`, { notes: returnNotes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-order', id] });
      setShowReturnForm(false);
      setReturnError('');
    },
    onError: (err: any) => setReturnError(err.response?.data?.error?.message ?? err.response?.data?.message ?? 'Return failed'),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 bg-gray-100 rounded-xl w-48" />
        <div className="h-48 bg-gray-100 rounded-2xl" />
        <div className="h-64 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-16 text-gray-400">
        Order not found.{' '}
        <Link href="/sales/orders" className="text-blue-600 hover:underline">Back to orders</Link>
      </div>
    );
  }

  const customerName = order.customer
    ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
    : (order.shipping_address as any)?.name ?? 'Walk-in Customer';

  const total = Number(order.total_amount);
  const subtotal = total / 1.13;
  const iva = total - subtotal;
  const it = subtotal * 0.03;

  const isInvoiceable = INVOICEABLE_STATUSES.includes(order.status);
  const hasInvoice = !!order.invoice_id && !!order.factura;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Back */}
      <Link href="/sales/orders" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900">
        <ArrowLeft className="h-4 w-4" /> Back to Orders
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-black text-gray-900">{order.order_number}</h1>
              <Badge color={STATUS_COLORS[order.status as keyof typeof STATUS_COLORS] ?? 'gray'}>
                {order.status}
              </Badge>
            </div>
            <p className="text-sm text-gray-400">
              Created {new Date(order.created_at).toLocaleDateString('en-US', { dateStyle: 'long' })}
              {order.source && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{order.source}</span>}
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 items-center">
            <SalesOrderPDFButton order={order} />
            {order.status === 'DRAFT' && (
              <button onClick={() => confirmOrder.mutate()} disabled={confirmOrder.isPending}
                className="flex items-center gap-1.5 text-sm bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50 transition-colors">
                <CheckCircle className="h-4 w-4" /> {confirmOrder.isPending ? 'Confirming...' : 'Confirm'}
              </button>
            )}
            {order.status === 'CONFIRMED' && (
              <button onClick={() => ship.mutate()} disabled={ship.isPending}
                className="flex items-center gap-1.5 text-sm bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50 transition-colors">
                <Truck className="h-4 w-4" /> {ship.isPending ? 'Shipping...' : 'Mark Shipped'}
              </button>
            )}
            {order.status === 'SHIPPED' && (
              <button onClick={() => complete.mutate()} disabled={complete.isPending}
                className="flex items-center gap-1.5 text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50 transition-colors">
                <Package className="h-4 w-4" /> {complete.isPending ? 'Completing...' : 'Mark Completed'}
              </button>
            )}
            {['DRAFT', 'CONFIRMED'].includes(order.status) && (
              <button onClick={() => { if (window.confirm(`Cancel order ${order.order_number}?`)) cancel.mutate(); }}
                className="flex items-center gap-1.5 text-sm border border-red-200 text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg font-medium transition-colors">
                <XCircle className="h-4 w-4" /> Cancel
              </button>
            )}
            {['SHIPPED', 'COMPLETED'].includes(order.status) && !(order as any).returned_at && (
              <button onClick={() => setShowReturnForm(true)}
                className="flex items-center gap-1.5 text-sm border border-orange-200 text-orange-600 hover:bg-orange-50 px-4 py-2 rounded-lg font-medium transition-colors">
                <RotateCcw className="h-4 w-4" /> Return
              </button>
            )}
            {(order as any).returned_at && (
              <span className="flex items-center gap-1.5 text-sm text-gray-400 border border-gray-200 px-4 py-2 rounded-lg font-medium">
                <RotateCcw className="h-4 w-4" /> Returned
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Customer */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <User className="h-4 w-4 text-gray-400" />
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Customer</h2>
          </div>
          <p className="font-semibold text-gray-900">{customerName}</p>
          {order.customer?.email && <p className="text-sm text-gray-500 mt-1">{order.customer.email}</p>}
          {order.customer?.phone && <p className="text-sm text-gray-500">{order.customer.phone}</p>}
          {order.customer?.code && <p className="text-xs font-mono text-gray-400 mt-1">#{order.customer.code}</p>}
        </div>

        {/* Shipping Address */}
        {order.shipping_address && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-4 w-4 text-gray-400" />
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Ship To</h2>
            </div>
            {(() => {
              const addr = order.shipping_address as any;
              return (
                <div className="text-sm text-gray-700 space-y-0.5">
                  {addr.name && <p className="font-medium">{addr.name}</p>}
                  {addr.address && <p>{addr.address}</p>}
                  {addr.city && <p>{addr.city}</p>}
                  {addr.phone && <p className="text-gray-500">{addr.phone}</p>}
                </div>
              );
            })()}
          </div>
        )}

        {/* Order Info */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Hash className="h-4 w-4 text-gray-400" />
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Order Info</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Currency</span>
              <span className="font-medium">{order.currency ?? 'BOB'}</span>
            </div>
            {order.notes && (
              <div>
                <span className="text-gray-500">Notes:</span>
                <p className="text-gray-700 mt-1 text-xs">{order.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Order Lines */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-sm font-bold text-gray-700">Order Lines</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500">Product</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Unit Price</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Qty</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Discount</th>
              <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500">Line Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(order.lines ?? []).map((line: any) => (
              <tr key={line.id} className="hover:bg-gray-50">
                <td className="px-6 py-3">
                  <p className="font-medium text-gray-900">{line.product?.name ?? line.product_id}</p>
                  {line.product?.sku && <p className="text-xs text-gray-400 font-mono">{line.product.sku}</p>}
                </td>
                <td className="px-6 py-3 text-right text-gray-700">Bs. {Number(line.unit_price).toFixed(2)}</td>
                <td className="px-6 py-3 text-right font-medium">{line.quantity}</td>
                <td className="px-6 py-3 text-right text-gray-400">
                  {Number(line.discount_pct) > 0 ? `${Number(line.discount_pct).toFixed(0)}%` : '—'}
                </td>
                <td className="px-6 py-3 text-right font-bold text-gray-900">Bs. {Number(line.line_total).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-gray-200 bg-gray-50">
            <tr>
              <td colSpan={4} className="px-6 py-3 text-right text-sm font-semibold text-gray-600">Subtotal (incl. IVA):</td>
              <td className="px-6 py-3 text-right font-bold text-gray-900">Bs. {Number(order.subtotal).toFixed(2)}</td>
            </tr>
            {Number(order.discount_amount) > 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-2 text-right text-sm text-gray-500">Discount:</td>
                <td className="px-6 py-2 text-right text-red-600 font-medium">-Bs. {Number(order.discount_amount).toFixed(2)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={4} className="px-6 py-3 text-right text-base font-bold text-gray-900">Total:</td>
              <td className="px-6 py-3 text-right text-lg font-black text-gray-900">Bs. {Number(order.total_amount).toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Invoice Section */}
      <div className={`rounded-2xl border p-6 ${hasInvoice ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${hasInvoice ? 'bg-green-100' : 'bg-gray-100'}`}>
              <FileText className={`h-5 w-5 ${hasInvoice ? 'text-green-600' : 'text-gray-400'}`} />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">
                {hasInvoice ? 'Invoice Issued' : 'Invoice (Fatura)'}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {hasInvoice
                  ? `Factura #${String(order.factura.factura_number).padStart(6, '0')} — ${new Date(order.factura.invoice_date).toLocaleDateString()}`
                  : isInvoiceable
                  ? 'This order is ready to be invoiced.'
                  : `Orders in ${order.status} status cannot be invoiced yet.`
                }
              </p>
            </div>
          </div>

          {hasInvoice ? (
            <div className="flex items-center gap-2">
              <FacturaPDFButton factura={order.factura} />
              <Link href="/finance/facturas"
                className="text-sm text-green-700 hover:text-green-900 font-medium border border-green-300 px-3 py-1.5 rounded-lg hover:bg-green-100 transition-colors">
                View Facturas →
              </Link>
            </div>
          ) : isInvoiceable && !showInvoiceForm ? (
            <button
              onClick={() => setShowInvoiceForm(true)}
              className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
            >
              <FileText className="h-4 w-4" /> Issue Factura
            </button>
          ) : null}
        </div>

        {/* Inline invoice form */}
        {!hasInvoice && isInvoiceable && showInvoiceForm && (
          <div className="mt-5 border-t border-gray-200 pt-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
                <input
                  readOnly
                  value={customerName}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm bg-gray-50 text-gray-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">NIT / CI <span className="text-gray-400 font-normal">(optional)</span></label>
                <input
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-200"
                  placeholder="12345678"
                  value={nit}
                  onChange={e => setNit(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
                placeholder={`Factura por Orden de Venta ${order.order_number}`}
                value={invoiceNotes}
                onChange={e => setInvoiceNotes(e.target.value)}
              />
            </div>

            {/* Tax breakdown */}
            <div className="bg-red-50/40 border border-red-100 rounded-xl p-4 grid grid-cols-4 gap-4 text-sm text-center">
              <div>
                <p className="text-xs text-gray-500 mb-1">Subtotal neto</p>
                <p className="font-bold text-gray-900">Bs. {subtotal.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-red-500 mb-1">IVA 13%</p>
                <p className="font-bold text-red-700">Bs. {iva.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-orange-600 mb-1">IT 3%</p>
                <p className="font-bold text-orange-600">Bs. {it.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Total</p>
                <p className="font-black text-gray-900">Bs. {total.toFixed(2)}</p>
              </div>
            </div>

            {invoiceError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                <AlertCircle className="h-4 w-4 shrink-0" /> {invoiceError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => createInvoice.mutate()}
                disabled={createInvoice.isPending}
                className="flex items-center gap-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              >
                <FileText className="h-4 w-4" />
                {createInvoice.isPending ? 'Issuing...' : 'Issue Factura'}
              </button>
              <button
                onClick={() => { setShowInvoiceForm(false); setInvoiceError(''); }}
                className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Invoice details if exists */}
        {hasInvoice && (
          <div className="mt-4 grid grid-cols-4 gap-4 text-sm text-center">
            <div className="bg-white rounded-xl border border-green-200 p-3">
              <p className="text-xs text-gray-500 mb-1">Factura #</p>
              <p className="font-bold text-gray-900">{String(order.factura.factura_number).padStart(6, '0')}</p>
            </div>
            <div className="bg-white rounded-xl border border-green-200 p-3">
              <p className="text-xs text-blue-600 mb-1">IVA 13%</p>
              <p className="font-bold text-blue-700">Bs. {Number(order.factura.iva_amount).toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-xl border border-green-200 p-3">
              <p className="text-xs text-orange-600 mb-1">IT 3%</p>
              <p className="font-bold text-orange-600">Bs. {Number(order.factura.it_amount).toFixed(2)}</p>
            </div>
            <div className="bg-white rounded-xl border border-green-200 p-3">
              <p className="text-xs text-gray-500 mb-1">Total</p>
              <p className="font-black text-gray-900">Bs. {Number(order.factura.total_amount).toFixed(2)}</p>
            </div>
          </div>
        )}
      </div>
      {/* Sales Return Form */}
      {showReturnForm && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
              <RotateCcw className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">Process Return</h2>
              <p className="text-sm text-gray-500">Stock will be restored, a credit note Factura will be issued, and all journal entries reversed.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Return Notes <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                className="w-full border border-orange-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 bg-white"
                placeholder="e.g. Customer defect return"
                value={returnNotes}
                onChange={e => setReturnNotes(e.target.value)}
              />
            </div>

            <div className="bg-orange-100/60 border border-orange-200 rounded-xl p-4 text-sm text-orange-800">
              <p className="font-semibold mb-1">This will:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>Restore {order.lines?.length ?? 0} line(s) of stock back to inventory</li>
                <li>Issue a credit note Factura (negative amount)</li>
                <li>Reverse all GL journal entries for this order</li>
              </ul>
            </div>

            {returnError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                <AlertCircle className="h-4 w-4 shrink-0" /> {returnError}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => returnOrder.mutate()}
                disabled={returnOrder.isPending}
                className="flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              >
                <RotateCcw className="h-4 w-4" />
                {returnOrder.isPending ? 'Processing...' : 'Confirm Return'}
              </button>
              <button
                onClick={() => { setShowReturnForm(false); setReturnError(''); }}
                className="px-5 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
