'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { User, Save, LogOut } from 'lucide-react';

export default function AccountPage() {
  const { user, logout, loadUser } = useAuthStore();
  const router = useRouter();
  const [form, setForm] = useState({
    first_name: '', last_name: '', phone: '', address: '',
    city: '', country: '', date_of_birth: '',
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) { router.push('/store/login'); return; }
    api.get('/auth/account').then(({ data }) => {
      const { user: u, customer: c } = data.data;
      setForm({
        first_name: u?.first_name ?? '',
        last_name: u?.last_name ?? '',
        phone: c?.phone ?? '',
        address: c?.address ?? '',
        city: c?.city ?? '',
        country: c?.country ?? '',
        date_of_birth: c?.date_of_birth ? c.date_of_birth.slice(0, 10) : '',
      });
    });
  }, [user, router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.put('/auth/account', form);
      await loadUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to save changes');
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-[#C65306] rounded-2xl flex items-center justify-center">
            <User className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">My Account</h1>
            <p className="text-sm text-gray-500">{user.email}</p>
          </div>
        </div>
        <button
          onClick={() => { logout(); router.push('/shop'); }}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-red-500 transition-colors"
        >
          <LogOut className="h-4 w-4" /> Sign Out
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
        <form onSubmit={handleSave} className="space-y-4">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-2">Personal Info</h2>
          <div className="grid grid-cols-2 gap-3">
            {(['first_name', 'last_name'] as const).map((k) => (
              <div key={k}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {k === 'first_name' ? 'First Name' : 'Last Name'}
                </label>
                <input
                  type="text"
                  required
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C65306]"
                  value={form[k]}
                  onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
            <input
              type="date"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C65306]"
              value={form.date_of_birth}
              onChange={e => setForm(p => ({ ...p, date_of_birth: e.target.value }))}
            />
          </div>

          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-widest pt-2 mb-2">Contact & Address</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C65306]"
              value={form.phone}
              onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C65306]"
              value={form.address}
              onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['city', 'country'] as const).map((k) => (
              <div key={k}>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </label>
                <input
                  type="text"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C65306]"
                  value={form[k]}
                  onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          {saved && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">Changes saved!</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-[#C65306] hover:bg-[#b34a05] disabled:opacity-50 text-white py-3 rounded-xl font-semibold transition-colors"
          >
            <Save className="h-4 w-4" />
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}
