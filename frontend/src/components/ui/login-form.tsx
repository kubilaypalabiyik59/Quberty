'use client';

import { useState } from 'react';
import { AlertCircle, ArrowRight, Info, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoginStage } from '@/components/brand/LoginStage';
import { QubertyWordmark } from '@/components/brand/QubertyWordmark';
import brand from '@/components/brand/brand.module.css';

/**
 * Sign-in.
 *
 * This is the product's front door, not a tenant's: it renders before anyone
 * has said which company they belong to, so it carries the Quberty brand and
 * none of a customer's imagery. The stage is full-bleed and the form floats
 * over it, in the calm centre the scene was composed to leave empty.
 *
 * The page is always dark. The stage is a night scene, and a light-theme card
 * over it would read as a hole in the picture; the wrapper's `dark` class
 * scopes the dark tokens to this page only, so the user's theme choice still
 * applies everywhere after sign-in. That is also why there is no theme toggle
 * here — it would change nothing visible.
 */

interface LoginFormProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  error?: string;
  /** A neutral explanation, e.g. why the previous session ended. */
  notice?: string;
  loading?: boolean;
}

export default function LoginForm({ onSubmit, error, notice, loading }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(email, password);
  };

  return (
    <div className="dark relative min-h-screen w-full overflow-hidden bg-bg text-fg">
      <LoginStage />

      <div className="relative z-10 flex min-h-screen flex-col">
        <QubertyWordmark className={brand.loginWordmark}>
          <small aria-hidden>ERP</small>
        </QubertyWordmark>

        <main className={cn('flex flex-1 items-center justify-center px-5 py-8', brand.loginMain)}>
          <div className="w-full max-w-[25rem] animate-fade-up">
            {/* A near-solid surface rather than frosted glass: the card carries
                a form, and text over a moving scene has to be readable at every
                frame, not most of them. */}
            <div className="rounded-surface border border-border bg-surface/95 p-7 shadow-pop sm:p-8">
              <h1 className="text-title font-semibold tracking-tight text-fg">Sign in</h1>
              <p className="mt-1 text-caption text-fg-muted">
                Use the account your administrator issued you.
              </p>

              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
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

                {notice && !error ? (
                  <p
                    role="status"
                    className="flex items-start gap-2 rounded-control bg-surface-sunken px-3 py-2 text-caption text-fg-muted"
                  >
                    <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>{notice}</span>
                  </p>
                ) : null}

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
            </div>

            <p className="mt-4 text-center text-caption text-panel-muted">
              Trouble signing in? Contact your system administrator.
            </p>
          </div>
        </main>

        <footer className="px-6 pb-6 text-center sm:px-10">
          <p className="text-body font-medium text-panel-fg">
            Every order, every movement, every ledger line — in one place.
          </p>
          <p className="mx-auto mt-1 max-w-md text-caption text-panel-muted">
            Stock, sales and finance stay in step without anyone re-typing them.
          </p>
        </footer>
      </div>
    </div>
  );
}

/* ── pieces ───────────────────────────────────────────────────────────── */

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
          'h-10 w-full rounded-control border border-border bg-surface-sunken px-3',
          'text-body text-fg placeholder:text-fg-subtle',
          'transition-colors duration-quick hover:border-border-strong',
          'focus:border-accent focus:outline-none focus-visible:outline-none',
        )}
      />
    </div>
  );
}
