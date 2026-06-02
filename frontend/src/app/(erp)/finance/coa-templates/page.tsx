'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface Template { id: string; name: string; country: string; currency: string; }

export default function CoaTemplatesPage() {
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState('');

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['coa-templates'],
    queryFn:  () => api.get('/finance/coa-templates').then(r => r.data.data ?? []),
  });

  const seed = async (templateId: string) => {
    setLoading(true);
    setResult('');
    try {
      const r = await api.post('/finance/seed-coa', { template_id: templateId });
      const d = r.data.data;
      setResult(`✓ ${d.template}: ${d.created} accounts created, ${d.skipped} skipped (already exist).`);
    } catch (err: any) {
      setResult('Error: ' + (err?.response?.data?.error?.message ?? 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Chart of Accounts Templates</h1>
      <p className="text-sm text-gray-500">
        Select a template to seed your chart of accounts. Existing accounts are not overwritten.
      </p>

      {result ? (
        <div className={`text-sm px-4 py-3 rounded-lg ${result.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {result}
        </div>
      ) : null}

      <div className="space-y-3">
        {templates.map(t => (
          <div key={t.id} className="border rounded-lg p-4 flex items-center justify-between hover:bg-gray-50">
            <div>
              <p className="font-medium text-sm">{t.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">Country: {t.country} · Currency: {t.currency}</p>
            </div>
            <button
              onClick={() => seed(t.id)}
              disabled={loading}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Seeding...' : 'Seed Accounts'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
