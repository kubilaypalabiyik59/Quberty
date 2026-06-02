'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { usePosSessionStore } from '@/stores/posSessionStore';
import { api } from '@/lib/api';
import { NumPad } from '@/components/pos/NumPad';

export default function ZReportPage() {
  const router       = useRouter();
  const { logout }   = useAuthStore();
  const session      = usePosSessionStore((s) => s.session);
  const clearSession = usePosSessionStore((s) => s.clearSession);

  const [floatAmt, setFloatAmt] = useState('0');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [zReport,  setZReport]  = useState<any>(null);

  async function handleClose() {
    if (!session) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.post(`/pos/sessions/${session.id}/close`, {
        closing_float: parseFloat(floatAmt) || 0,
      });
      setZReport(res.data.data.z_report);
      clearSession();
    } catch (e: any) {
      setError(e.response?.data?.message ?? e.message ?? 'Failed to close register');
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
              ['Opening Float',   `Bs. ${Number(zReport.opening_float).toFixed(2)}`],
              ['Total Sales',     `Bs. ${Number(zReport.total_sales).toFixed(2)}`],
              ['Cash Expected',   `Bs. ${Number(zReport.cash_expected).toFixed(2)}`],
              ['Closing Float',   `Bs. ${Number(zReport.closing_float).toFixed(2)}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-2 border-b border-slate-100">
                <span className="text-slate-400 text-sm">{label}</span>
                <span className="text-slate-700 text-sm font-medium">{value}</span>
              </div>
            ))}

            <div className={`flex justify-between items-center rounded-xl px-3 py-2.5 mt-2.5 border ${
              overshort < 0 ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'
            }`}>
              <span className="text-slate-900 font-bold text-base">
                {overshort >= 0 ? 'Over' : 'Short'}
              </span>
              <span className={`font-black text-xl ${overshort < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                Bs. {Math.abs(overshort).toFixed(2)}
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
          Sales today: Bs. {Number(session?.total_sales ?? 0).toFixed(2)}{' '}
          ({session?.transaction_count ?? 0} transactions)
        </p>

        <label className="block text-slate-600 text-sm font-medium mb-1.5">
          Closing Float (Bs.) — cash in drawer
        </label>
        <div className="bg-indigo-600 rounded-xl py-4 text-center mb-3 shadow-lg shadow-indigo-200">
          <p className="text-white text-3xl font-bold">Bs. {floatAmt}</p>
        </div>

        <NumPad value={floatAmt} onChange={setFloatAmt} allowDecimal />

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
