'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { usePosSessionStore } from '@/stores/posSessionStore';
import { api } from '@/lib/api';
import { NumPad } from '@/components/pos/NumPad';
import { useMoney } from '@/components/CurrencyProvider';

export default function ZReportPage() {
  const router       = useRouter();
  const { logout }   = useAuthStore();
  const session      = usePosSessionStore((s) => s.session);
  const clearSession = usePosSessionStore((s) => s.clearSession);
  const { money, code } = useMoney();

  const [floatAmt, setFloatAmt] = useState('0');
  // Counted amounts per payment method that the drawer declares (WORK-047).
  const [counted, setCounted] = useState<Record<string, string>>({});
  const { data: methods } = useQuery({
    queryKey: ['sales-payment-methods'],
    queryFn: () => api.get('/sales/payment-methods').then((r) => r.data.data as any[]),
  });
  const declared = useMemo(
    () => (methods ?? []).filter((m) => m.is_active && m.declaration_policy === 'COUNT' && m.tender_type !== 'CASH'),
    [methods],
  );
  const cashMethod = (methods ?? []).find((m) => m.is_active && m.tender_type === 'CASH');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [zReport,  setZReport]  = useState<any>(null);

  async function handleClose() {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post(`/pos/sessions/${session.id}/close`, {
        declarations: [
          ...(cashMethod ? [{ payment_method_id: cashMethod.id, counted: parseFloat(floatAmt) || 0 }] : []),
          ...declared.map((m) => ({ payment_method_id: m.id, counted: parseFloat(counted[m.id] ?? '0') || 0 })),
        ],
        ...(cashMethod ? {} : { closing_float: parseFloat(floatAmt) || 0 }),
      });
      setZReport(res.data.data.z_report);
      clearSession();
    } catch (e: any) {
      setError(e.response?.data?.error?.message ?? e.message ?? 'Failed to close register');
    } finally {
      setLoading(false);
    }
  }

  async function handleLogoutAfterClose() {
    await logout();
    router.replace('/pos/login');
  }

  // After close — show Z-Report
  if (zReport) {
    const overshort = Number(zReport.over_short);
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-white rounded-2xl p-7 w-[420px] shadow-xl shadow-indigo-200/50 border border-slate-100">
          <p className="text-slate-900 font-bold text-2xl mb-1.5">Z-Report — Register Closed</p>
          <p className="text-slate-400 text-sm mb-5">{zReport.terminal_name}</p>

          <div className="space-y-0 max-h-96 overflow-y-auto">
            {[
              ['Opened At',       new Date(zReport.opened_at).toLocaleString()],
              ['Closed At',       new Date(zReport.closed_at).toLocaleString()],
              ['Transactions',    String(zReport.transaction_count)],
              ['Opening Float',   money(zReport.opening_float)],
              ['Total Sales',     money(zReport.total_sales)],
              ['Cash Expected',   money(zReport.cash_expected)],
              ['Cash Counted',    money(zReport.closing_float)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-400 text-sm">{label}</span>
                <span className="text-slate-700 text-sm font-medium">{value}</span>
              </div>
            ))}

            {(zReport.tenders ?? []).length > 0 && (
              <div className="mt-3">
                <p className="text-slate-500 text-xs font-semibold mb-1">By payment method</p>
                {(zReport.tenders as any[]).map((t) => (
                  <div key={t.payment_method_id} className="flex justify-between py-1.5 border-b border-slate-100 text-sm">
                    <span className="text-slate-500">{t.code}</span>
                    <span className="text-slate-700">
                      expected {money(t.expected)} · counted {money(t.counted)}
                      {t.difference !== 0 && <strong className={t.difference < 0 ? 'text-red-500' : 'text-emerald-600'}> · {t.difference > 0 ? '+' : ''}{money(t.difference)}</strong>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className={`flex justify-between items-center rounded-xl px-3 py-2.5 mt-2.5 border ${
              overshort < 0 ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'
            }`}>
              <span className="text-slate-900 font-bold text-base">
                {overshort >= 0 ? 'Over' : 'Short'}
              </span>
              <span className={`font-black text-xl ${overshort < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                {money(Math.abs(overshort))}
              </span>
            </div>
          </div>

          <button
            onClick={handleLogoutAfterClose}
            className="w-full mt-5 py-3.5 bg-indigo-600 rounded-xl text-white font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
          >
            Logout & Exit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="bg-white rounded-2xl p-7 w-[420px] shadow-xl shadow-indigo-200/50 border border-slate-100">
        <button
          onClick={() => router.back()}
          className="text-slate-400 text-sm mb-4 hover:text-indigo-600 transition-colors"
        >
          ← Back to POS
        </button>

        <p className="text-slate-900 font-bold text-2xl mb-1.5">Close Register</p>
        <p className="text-slate-500 text-sm mb-6 leading-relaxed">
          Terminal: {session?.terminal_name ?? '—'}
          <br />
          Sales today: {money(session?.total_sales ?? 0)}{' '}
          ({session?.transaction_count ?? 0} transactions)
        </p>

        <label className="block text-slate-600 text-sm font-medium mb-1.5">
          Closing Float ({code}) — cash in drawer
        </label>
        <div className="bg-indigo-600 rounded-xl py-4 text-center mb-3 shadow-lg shadow-indigo-200">
          {/* The raw keypad string, not a formatted amount: it is mid-edit. */}
          <p className="text-white text-3xl font-bold">{code} {floatAmt}</p>
        </div>

        <NumPad value={floatAmt} onChange={setFloatAmt} allowDecimal />

        {declared.map((m) => (
          <label key={m.id} className="block text-slate-600 text-sm font-medium mt-3">
            {m.name} counted ({code})
            <input className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-lg" inputMode="decimal"
              value={counted[m.id] ?? ''} onChange={(e) => setCounted((c) => ({ ...c, [m.id]: e.target.value }))} />
          </label>
        ))}

        {error && <p className="text-red-500 text-sm text-center mb-2">{error}</p>}

        <button
          onClick={handleClose}
          disabled={loading}
          className={`w-full py-3.5 rounded-xl font-bold text-white mt-3 transition-colors shadow-lg shadow-indigo-200 ${
            loading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {loading ? 'Closing...' : 'Close Register & Print Z-Report'}
        </button>
      </div>
    </div>
  );
}
