'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { usePosSessionStore } from '@/stores/posSessionStore';
import { api } from '@/lib/api';
import { NumPad } from '@/components/pos/NumPad';
import { useMoney } from '@/components/CurrencyProvider';

interface WarehouseOption {
  id:        string;
  name:      string;
  code:      string;
  is_active: boolean;
  site?:     { name?: string | null } | null;
}

export default function OpenRegisterPage() {
  const router  = useRouter();
  const user    = useAuthStore((s) => s.user);
  const { terminalName, setTerminal, setSession, warehouseId, setWarehouseId } = usePosSessionStore();

  const [terminal, setTerminalLocal] = useState(terminalName);
  const [floatAmt, setFloatAmt]      = useState('0');
  const [loading,  setLoading]       = useState(false);
  const [error,    setError]         = useState('');
  const [warehouses, setWarehouses]  = useState<WarehouseOption[]>([]);
  const [warehouse,  setWarehouse]   = useState<string>(warehouseId ?? '');
  const { code } = useMoney();

  // A register sells from one store. When the tenant has several warehouses the
  // cashier must say which; the server refuses a register without one.
  useEffect(() => {
    api.get('/warehouse/warehouses')
      .then((res) => {
        const active = ((res.data?.data ?? []) as WarehouseOption[]).filter((w) => w.is_active);
        setWarehouses(active);
        if (active.length === 1) setWarehouse(active[0].id);
        else if (warehouseId && !active.some((w) => w.id === warehouseId)) setWarehouse('');
      })
      .catch(() => setWarehouses([]));
  }, [warehouseId]);

  async function handleOpen() {
    if (!terminal.trim()) { setError('Terminal name is required'); return; }
    if (warehouses.length > 1 && !warehouse) { setError('Choose the store warehouse this register sells from'); return; }
    setLoading(true);
    setError('');
    try {
      setTerminal(terminal.trim());
      const res = await api.post('/pos/sessions/open', {
        terminal_name:  terminal.trim(),
        opening_float:  parseFloat(floatAmt) || 0,
        ...(warehouse ? { warehouse_id: warehouse } : {}),
      });
      if (warehouse) setWarehouseId(warehouse);
      setSession(res.data.data);
      router.replace('/pos/main');
    } catch (e: any) {
      setError(e.response?.data?.error?.message ?? e.response?.data?.message ?? e.message ?? 'Failed to open register');
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

        {warehouses.length > 1 && (
          <>
            <label className="block text-slate-600 text-sm font-medium mb-1.5">Store warehouse</label>
            <select
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-slate-900 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition mb-5"
            >
              <option value="">Select a warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.code}){w.site?.name ? ` — ${w.site.name}` : ''}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="block text-slate-600 text-sm font-medium mb-1.5">Opening Float ({code})</label>
        <div className="bg-indigo-600 rounded-xl py-4 text-center mb-3 shadow-lg shadow-indigo-200">
          {/* The raw keypad string, not a formatted amount: it is mid-edit. */}
          <p className="text-white text-3xl font-bold">{code} {floatAmt}</p>
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
