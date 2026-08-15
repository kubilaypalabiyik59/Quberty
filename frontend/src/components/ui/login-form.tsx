'use client';

import { useState } from 'react';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ImageStreamHero } from '@/components/ui/image-stream-hero';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

/**
 * Sign-in.
 *
 * The old screen was a half-and-half split with a cross-fading slideshow — the
 * layout every template ships with. This keeps the two halves, because a form
 * needs a quiet column, but replaces the slideshow with a corridor: the store's
 * own photography running toward the viewer on two rails. It is the same
 * pictures, given depth and direction instead of a fade.
 *
 * The corridor is decorative and `aria-hidden`; it pauses under
 * `prefers-reduced-motion` rather than stopping dead, so it freezes as a
 * composed still.
 */

const STORE_IMAGERY = [
  'https://res.cloudinary.com/drglv6rx2/image/upload/v1774946668/Picture-01_yujwqm.png',
  'https://res.cloudinary.com/drglv6rx2/image/upload/v1774946668/pircture-01_vjhi9c.png',
  'https://res.cloudinary.com/drglv6rx2/image/upload/v1774946668/Screenshot_2026-03-31_104025_y9ikl6.png',
  'https://res.cloudinary.com/drglv6rx2/image/upload/v1774733357/WhatsApp_Image_2026-03-28_at_22.24.14_etena3.jpg',
].map((src) => ({ src, alt: '' }));

interface LoginFormProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  error?: string;
  loading?: boolean;
}

export default function LoginForm({ onSubmit, error, loading }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(email, password);
  };

  return (
    <div className="flex min-h-screen w-full bg-bg">
      {/* ── Left: the corridor ──────────────────────────────────────────── */}
      <div className="relative hidden w-1/2 shrink-0 overflow-hidden bg-panel lg:block">
        {/* The corridor is sized in `cqw`, a share of container WIDTH, but this
            panel is a tall half-screen. The stock geometry therefore renders as
            a thin band floating in dead space. These values are scaled up so the
            ribbon fills a portrait panel and reads as depth rather than a strip. */}
        <ImageStreamHero
          images={STORE_IMAGERY}
          cards={11}
          speed={26}
          axis={50}
          path={{
            perspective: 34,
            cardWidth: 26,
            cardHeight: 34,
            birthHeight: 3.4,
            exitHeight: 78,
            railExit: 54,
            railBirth: -14,
          }}
          className="absolute inset-0 h-full w-full"
        />

        {/* Grades the corridor into the panel edge so it does not end on a
            hard line, and keeps the wordmark legible over moving images. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(110% 75% at 50% 50%, transparent 22%, hsl(var(--panel) / 0.72) 62%, hsl(var(--panel)) 88%)',
          }}
        />

        <div className="relative z-10 flex h-full flex-col justify-between p-10">
          <Wordmark onPanel />
          <div className="max-w-sm">
            <p className="text-title font-medium text-panel-fg">
              Every order, every movement, every boliviano — in one place.
            </p>
            <p className="mt-2 text-body text-panel-muted">
              Three stores, one system. Stock, sales and the ledger stay in step
              without anyone re-typing them.
            </p>
          </div>
        </div>
      </div>

      {/* ── Right: the form ─────────────────────────────────────────────── */}
      <div className="flex w-full flex-col lg:w-1/2">
        <header className="flex items-center justify-between p-6">
          <div className="lg:hidden">
            <Wordmark />
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-[22rem] animate-fade-up">
            <h1 className="text-display font-semibold text-fg">Sign in</h1>
            <p className="mt-1.5 text-body text-fg-muted">
              Use the account your administrator issued you.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
              <Field
                id="email"
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="username"
                placeholder="you@company.com"
                required
              />
              <Field
                id="password"
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />

              {error ? (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-caption text-danger"
                >
                  <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{error}</span>
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className={cn(
                  'mt-1 inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-control',
                  'bg-accent px-4 text-body font-medium text-accent-fg',
                  'transition-colors duration-quick hover:bg-accent-hover',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Signing in
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </>
                )}
              </button>
            </form>

            <p className="mt-8 text-caption text-fg-subtle">
              Trouble signing in? Contact your system administrator.
            </p>
          </div>
        </main>

        <footer className="px-6 pb-6 text-micro uppercase tracking-wide text-fg-subtle">
          Quberty ERP
        </footer>
      </div>
    </div>
  );
}

/* ── pieces ───────────────────────────────────────────────────────────── */

function Wordmark({ onPanel = false }: { onPanel?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        aria-hidden
        className="grid h-7 w-7 place-items-center rounded-[7px] bg-accent text-accent-fg"
      >
        <span className="font-mono text-caption font-semibold leading-none">Q</span>
      </div>
      <span className={cn("text-lead font-semibold tracking-tight", onPanel ? "text-panel-fg" : "text-fg")}>Quberty</span>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}

/** Visible label above the input — never a placeholder standing in for one. */
function Field({ id, label, type, value, onChange, autoComplete, placeholder, required }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium text-fg-muted">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        className={cn(
          'h-10 w-full rounded-control border border-border bg-surface px-3',
          'text-body text-fg placeholder:text-fg-subtle',
          'transition-colors duration-quick hover:border-border-strong',
          'focus:border-accent focus:outline-none focus-visible:outline-none',
        )}
      />
    </div>
  );
}
