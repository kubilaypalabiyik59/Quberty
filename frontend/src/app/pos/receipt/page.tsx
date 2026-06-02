'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

function ReceiptContent() {
  const router = useRouter();
  const p      = useSearchParams();
  const [voiding, setVoiding] = useState(false);

  const total    = parseFloat(p.get('total')      ?? '0');
  const subtotal = parseFloat(p.get('subtotal')   ?? '0');
  const iva      = parseFloat(p.get('iva_amount') ?? '0');
  const it       = parseFloat(p.get('it_amount')  ?? '0');
  const change   = parseFloat(p.get('change_due') ?? '0');
  const orderId  = p.get('order_id') ?? '';
  const orderNum = p.get('order_number') ?? '';
  const facturaNum = p.get('factura_number') ?? '';
  const method   = p.get('payment_method') ?? '';
  const custName = p.get('customer_name')  ?? 'Walk-in';

  async function handleVoid() {
    if (!orderId) { alert('No order ID available to void'); return; }
    if (!confirm(`Void sale ${orderNum}? This will reverse the sale and restore inventory.`)) return;
    setVoiding(true);
    try {
      await api.post(`/pos/sales/${orderId}/void`);
      alert(`Sale ${orderNum} has been voided.`);
      router.replace('/pos/main');
    } catch (e: any) {
      alert(e.response?.data?.message ?? e.message ?? 'Could not void this sale');
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="bg-white rounded-2xl w-[420px] p-7 flex flex-col items-center shadow-xl shadow-indigo-200/50 border border-slate-100">
        {/* Success icon */}
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
          <span className="text-emerald-600 text-3xl font-black">✓</span>
        </div>
        <p className="text-slate-900 font-bold text-2xl mb-1">Sale Complete!</p>
        <p className="text-slate-400 text-sm mb-5">Factura issued successfully</p>

        {/* Receipt body */}
        <div className="w-full max-h-80 overflow-y-auto space-y-0">
          <div className="bg-indigo-600 rounded-xl p-3.5 text-center mb-4 shadow-lg shadow-indigo-200">
            <p className="text-indigo-200 text-[10px] tracking-widest uppercase mb-1">FACTURA</p>
            <p className="text-white text-2xl font-black">N° {facturaNum.padStart(6, '0')}</p>
            <p className="text-indigo-200 text-xs mt-1">{orderNum}</p>
          </div>

          {[
            ['Customer',          custName],
            ['Payment',           method],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-400 text-sm">{label}</span>
              <span className="text-slate-700 text-sm font-medium">{value}</span>
            </div>
          ))}

          <div className="h-px bg-slate-100 my-2" />

          {[
            ['Subtotal (sin IVA)', `Bs. ${subtotal.toFixed(2)}`],
            ['IVA 13%',            `Bs. ${iva.toFixed(2)}`],
            ['IT 3%',              `Bs. ${it.toFixed(2)}`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-1.5 border-b border-slate-100">
              <span className="text-slate-400 text-sm">{label}</span>
              <span className="text-slate-700 text-sm font-medium">{value}</span>
            </div>
          ))}

          <div className="flex justify-between items-center bg-slate-100 rounded-xl px-3.5 py-3 mt-2.5">
            <span className="text-slate-900 font-bold">TOTAL</span>
            <span className="text-indigo-600 font-black text-2xl">Bs. {total.toFixed(2)}</span>
          </div>

          {change > 0 && (
            <div className="flex justify-between items-center bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5 mt-2">
              <span className="text-emerald-700 font-semibold text-sm">Change Due</span>
              <span className="text-emerald-600 font-black text-xl">Bs. {change.toFixed(2)}</span>
            </div>
          )}

          <p className="text-slate-300 text-xs text-center mt-3 mb-1">
            IVA incluido en precio — Ley 843 Bolivia
          </p>
        </div>

        {/* Actions */}
        <div className="w-full space-y-2.5 mt-4">
          <button
            onClick={() => router.replace('/pos/main')}
            className="w-full py-3.5 bg-indigo-600 rounded-xl text-white font-black text-base hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
          >
            NUEVA VENTA
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => router.push('/pos/z-report')}
              className="flex-1 py-3 bg-white border border-slate-200 rounded-xl text-slate-600 font-semibold text-sm hover:bg-slate-100 transition-colors"
            >
              Close Register
            </button>
            <button
              onClick={handleVoid}
              disabled={voiding}
              className={`flex-1 py-3 border rounded-xl font-semibold text-sm transition-colors ${
                voiding
                  ? 'bg-red-50 border-red-100 text-red-300 cursor-not-allowed'
                  : 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
              }`}
            >
              {voiding ? 'Voiding...' : 'Void Sale'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ReceiptPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-full">
        <span className="w-8 h-8 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    }>
      <ReceiptContent />
    </Suspense>
  );
}
