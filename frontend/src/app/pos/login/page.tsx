'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { usePosSessionStore } from '@/stores/posSessionStore';
import { api } from '@/lib/api';

export default function PosLoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const { terminalName, setSession } = usePosSessionStore();

  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError('Email and password are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(email.trim(), password);

      const res = await api.get('/pos/sessions/current', { params: { terminal_name: terminalName } });
      const session = res.data.data;
      if (session) {
        setSession(session);
        router.replace('/pos/main');
      } else {
        router.replace('/pos/open-register');
      }
    } catch (e: any) {
      setError(e.response?.data?.message ?? e.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-full">
      <div className="bg-white rounded-2xl p-8 w-96 shadow-xl shadow-indigo-200/50 border border-slate-100">
        {/* Logo */}
        <div className="flex items-center gap-3.5 mb-7">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0 shadow-lg shadow-indigo-300">
            <span className="text-2xl font-black text-white">Q</span>
          </div>
          <div>
            <p className="text-slate-900 font-bold text-xl">Quberty POS</p>
            <p className="text-slate-400 text-xs mt-0.5">Point of Sale — Bolivia</p>
          </div>
        </div>

        <label className="block text-slate-600 text-sm font-medium mb-1.5">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          placeholder="cashier@company.com"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-slate-900 text-sm placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition mb-4"
        />

        <label className="block text-slate-600 text-sm font-medium mb-1.5">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          placeholder="••••••••"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-slate-900 text-sm placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition mb-4"
        />

        {error && <p className="text-red-500 text-sm text-center mb-3">{error}</p>}

        <button
          onClick={handleLogin}
          disabled={loading}
          className={`w-full py-3.5 rounded-xl font-bold text-white transition-colors mt-1 shadow-lg shadow-indigo-200 ${
            loading ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Signing in...
            </span>
          ) : (
            'Sign In'
          )}
        </button>
      </div>
    </div>
  );
}
