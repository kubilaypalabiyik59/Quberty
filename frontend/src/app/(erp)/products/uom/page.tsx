'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function UomPage() {
  const [uoms, setUoms]       = useState<any[]>([]);
  const [code, setCode]       = useState('');
  const [name, setName]       = useState('');
  const [symbol, setSymbol]   = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg]         = useState('');

  const load = () => api.get('/uom').then(r => setUoms(r.data.data ?? []));
  useEffect(() => { load(); }, []);

  const seed = async () => {
    await api.post('/uom/seed-defaults');
    await load();
    setMsg('Default units seeded.');
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !name || !symbol) return;
    setLoading(true);
    try {
      await api.post('/uom', { code, name, symbol });
      setCode(''); setName(''); setSymbol('');
      await load();
    } catch (err: any) {
      setMsg(err?.response?.data?.error?.message ?? 'Error');
    } finally { setLoading(false); }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Units of Measure</h1>
        <button onClick={seed} className="text-sm px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">
          Seed Defaults
        </button>
      </div>

      {msg && <p className="text-sm text-green-600">{msg}</p>}

      <form onSubmit={create} className="grid grid-cols-4 gap-3 items-end">
        <div><label className="text-xs text-gray-500">Code</label>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="PCS" className="w-full border rounded px-2 py-1.5 text-sm" /></div>
        <div><label className="text-xs text-gray-500">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Pieces" className="w-full border rounded px-2 py-1.5 text-sm" /></div>
        <div><label className="text-xs text-gray-500">Symbol</label>
          <input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="pcs" className="w-full border rounded px-2 py-1.5 text-sm" /></div>
        <button type="submit" disabled={loading} className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50">
          Add
        </button>
      </form>

      <table className="w-full text-sm border-collapse">
        <thead><tr className="border-b text-left text-gray-500">
          <th className="py-2 pr-4">Code</th><th className="py-2 pr-4">Name</th><th className="py-2">Symbol</th>
        </tr></thead>
        <tbody>
          {uoms.map(u => (
            <tr key={u.id} className="border-b hover:bg-gray-50">
              <td className="py-2 pr-4 font-mono">{u.code}</td>
              <td className="py-2 pr-4">{u.name}</td>
              <td className="py-2">{u.symbol}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
