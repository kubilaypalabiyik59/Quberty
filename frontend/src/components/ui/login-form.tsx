'use client';

import { cn } from '@/lib/utils';
import { useState, useEffect } from 'react';

const SLIDES = [
  'https://res.cloudinary.com/drglv6rx2/image/upload/v1774946668/Picture-01_yujwqm.png',
  'https://res.cloudinary.com/drglv6rx2/image/upload/v1774946668/pircture-01_vjhi9c.png',
  'https://res.cloudinary.com/drglv6rx2/image/upload/v1774946668/Screenshot_2026-03-31_104025_y9ikl6.png',
  'https://res.cloudinary.com/drglv6rx2/image/upload/v1774733357/WhatsApp_Image_2026-03-28_at_22.24.14_etena3.jpg',
];

interface LoginFormProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  error?: string;
  loading?: boolean;
}

export default function LoginForm({ onSubmit, error, loading }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [current, setCurrent] = useState(0);
  const [animating, setAnimating] = useState(false);

  // Auto-advance slider every 3s with fade transition
  useEffect(() => {
    const timer = setInterval(() => {
      setAnimating(true);
      setTimeout(() => {
        setCurrent(c => (c + 1) % SLIDES.length);
        setAnimating(false);
      }, 400);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(email, password);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden">

      {/* ── Left: Image Slider ─────────────────────────────────────────── */}
      <div className="hidden lg:flex relative w-1/2 bg-gray-900 overflow-hidden">
        {/* Slides */}
        {SLIDES.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            className={cn(
              'absolute inset-0 w-full h-full object-cover transition-opacity duration-500',
              i === current && !animating ? 'opacity-100' : 'opacity-0'
            )}
          />
        ))}

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent z-10" />

        {/* Branding overlay */}
        <div className="absolute bottom-0 left-0 right-0 z-20 p-10">
          <div className="flex items-baseline gap-1 mb-3">
            <span className="text-white font-black text-3xl tracking-tight">QUBERTY</span>
            <span className="text-red-400 font-black text-3xl tracking-tight"> ERP</span>
          </div>
          <p className="text-gray-300 text-sm max-w-xs leading-relaxed">
            Retail management platform for modern businesses. Sales, inventory, warehouse and more — in one place.
          </p>
        </div>

        {/* Dot indicators */}
        <div className="absolute bottom-8 right-10 z-20 flex gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={cn(
                'w-2 h-2 rounded-full transition-all duration-300',
                i === current ? 'bg-white w-6' : 'bg-white/40'
              )}
            />
          ))}
        </div>
      </div>

      {/* ── Right: Login Form ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center bg-white px-8 py-12">

        {/* Mobile logo */}
        <div className="lg:hidden flex items-baseline gap-1 mb-10">
          <span className="text-gray-900 font-black text-2xl tracking-tight">QUBERTY</span>
          <span className="text-red-500 font-black text-2xl tracking-tight"> ERP</span>
        </div>

        <div className="w-full max-w-sm">
          {/* Header */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-gray-400 mt-2 text-sm">Sign in to access your ERP dashboard</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-red-500 focus-within:border-red-500 transition-all">
                <div className="pl-4 pr-2 text-gray-400">
                  <svg width="16" height="12" viewBox="0 0 16 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" clipRule="evenodd" d="M0 .55.571 0H15.43l.57.55v9.9l-.571.55H.57L0 10.45zm1.143 1.138V9.9h13.714V1.69l-6.503 4.8h-.697zM13.749 1.1H2.25L8 5.356z" fill="currentColor"/>
                  </svg>
                </div>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="admin@company.com"
                  className="flex-1 py-3 pr-4 text-sm text-gray-800 placeholder-gray-300 outline-none bg-transparent"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="flex items-center border border-gray-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-red-500 focus-within:border-red-500 transition-all">
                <div className="pl-4 pr-2 text-gray-400">
                  <svg width="13" height="17" viewBox="0 0 13 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13 8.5c0-.938-.729-1.7-1.625-1.7h-.812V4.25C10.563 1.907 8.74 0 6.5 0S2.438 1.907 2.438 4.25V6.8h-.813C.729 6.8 0 7.562 0 8.5v6.8c0 .938.729 1.7 1.625 1.7h9.75c.896 0 1.625-.762 1.625-1.7zM4.063 4.25c0-1.406 1.093-2.55 2.437-2.55s2.438 1.144 2.438 2.55V6.8H4.061z" fill="currentColor"/>
                  </svg>
                </div>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="flex-1 py-3 pr-4 text-sm text-gray-800 placeholder-gray-300 outline-none bg-transparent"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className={cn(
                'w-full py-3.5 rounded-xl text-white font-semibold text-sm tracking-wide transition-all duration-200',
                'bg-gradient-to-r from-red-600 to-red-500',
                'hover:from-red-700 hover:to-red-600',
                'shadow-lg shadow-red-500/30',
                'disabled:opacity-60 disabled:cursor-not-allowed'
              )}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </span>
              ) : 'Sign In'}
            </button>
          </form>

          {/* Demo credentials */}
          <div className="mt-8 p-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Demo credentials</p>
            <p className="text-xs text-gray-500 font-mono">admin@skarpine.com</p>
            <p className="text-xs text-gray-500 font-mono">Admin1234!</p>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-10 text-xs text-gray-300">
          © {new Date().getFullYear()} Quberty ERP. All rights reserved.
        </p>
      </div>
    </div>
  );
}
