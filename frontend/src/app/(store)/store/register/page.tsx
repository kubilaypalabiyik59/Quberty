'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

export default function StoreRegisterPage() {
  const router = useRouter();
  const { loadUser } = useAuthStore();
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', password: '',
    phone: '', address: '', city: '', country: 'Bolivia',
    date_of_birth: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', form);
      localStorage.setItem('access_token', data.data.access_token);
      localStorage.setItem('refresh_token', data.data.refresh_token);
      localStorage.setItem('tenant_id', data.data.tenant_id);
      await loadUser();
      router.push('/shop');
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const field = (key: keyof typeof form, label: string, type = 'text', required = true) => (
    <div key={key}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}{!required && <span className="text-gray-400 ml-1">(optional)</span>}</label>
      <input
        type={type}
        required={required}
        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#C65306]"
        value={form[key]}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-1 mb-3">
            <span className="text-[#111111] font-black text-2xl tracking-tight">SCARPE</span>
            <span className="text-[#C65306] font-black text-2xl tracking-tight">CALZADOS</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create account</h1>
          <p className="text-sm text-gray-500 mt-1">Join Scarpe Calzados today</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {field('first_name', 'First Name')}
              {field('last_name', 'Last Name')}
            </div>
            {field('email', 'Email', 'email')}
            {field('password', 'Password', 'password')}
            {field('phone', 'Phone', 'tel', false)}
            {field('address', 'Address', 'text', false)}
            <div className="grid grid-cols-2 gap-3">
              {field('city', 'City', 'text', false)}
              {field('country', 'Country', 'text', false)}
            </div>
            {field('date_of_birth', 'Date of Birth', 'date', false)}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#C65306] hover:bg-[#b34a05] disabled:opacity-50 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Already have an account?{' '}
            <Link href="/store/login" className="text-[#C65306] font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
