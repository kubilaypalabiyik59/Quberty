'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { usePosSessionStore } from '@/stores/posSessionStore';
import { api } from '@/lib/api';
import { NumPad } from '@/components/pos/NumPad';

export default function OpenRegisterPage() {
  const router  = useRouter();
  const user    = useAuthStore((s) => s.user);
  const { terminalName, setTerminal, setSession } = usePosSessionStore();

  const [terminal, setTerminalLocal] = useState(terminalName);
  const [floatAmt, setFloatAmt]      = useState('0');
  const [loading,  setLoading]       = useState(false);
  const [error,    setError]         = useState('');

  async function handleOpen() {
    if (!terminal.trim()) { setError('Terminal name is required'); return; }
    setLoading(true);
    setError('');
    try {
      setTerminal(terminal.trim());
      const res = await api.post('/pos/sessions/open', {
        terminal_name:  terminal.trim(),
        opening_float:  parseFloat(floatAmt) || 0,
      });
      setSession(res.data.data);
      router.replace('/pos/main');
    } catch (e: any) {
      setError(e.response?.data?.message ?? e.message ?? 'Failed to open register');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="bg-white rounded-2xl p-7 w-[420px] shadow-xl shadow-indigo-200/50 border border-slate-100">
        <p className="text-slate-900 font-bold text-2xl mb-1.5">Open Register</p>
        <p className="text-slate-500 text-sm mb-6">
          Hello, {user?.first_name ?? 'Cashier'} — set your opening float to begin
        </p>

        <label className="block text-slate-600 text-sm font-medium mb-1.5">Terminal Name</label>
        <input
          type="text"
          value={terminal}
          onChange={(e) => setTerminalLocal(e.target.value)}
          placeholder="e.g. POS-1 or Caja Principal"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-slate-900 text-sm placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition mb-5"
        />

        <label className="block text-slate-600 text-sm font-medium mb-1.5">Opening Float (Bs.)</label>
        <div className="bg-indigo-600 rounded-xl py-4 text-center mb-3 shadow-lg shadow-indigo-200">
          <p className="text-white text-3xl font-bold">Bs. {floatAmt}</p>
        </div>

        <NumPad value={floatAmt} onChange={setFloatAmt} allowDecimal />

        {error && <p className="text-red-500 text-sm text-center mb-2">{error}</p>}

        <button
          onClick={handleOpen}
          disabled={loading}
          className={`w-full py-3.5 rounded-xl font-bold text-white mt-3 transition-colors shadow-lg shadow-indigo-200 ${
            loading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {loading ? 'Opening...' : 'Open Register'}
        </button>
      </div>
    </div>
  );
}
