'use client';

import { useState } from 'react';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ImageStreamHero } from '@/components/ui/image-stream-hero';
import { ThemeToggle } from '@/components/ui/ThemeToggle';

/**
 * Sign-in.
 *
 * The corridor is the PAGE, not a decoration in one column. The first attempt
 * put it in a half-width panel beside the form, which fought the component on
 * two counts: its geometry is measured in `cqw`, so a tall half-width container
 * shrank the whole corridor into a thin band, and the leftover column had
 * nothing in it. The reference composition runs the corridor full-bleed and
 * floats content over it, which is what this does.
 *
 * The images are the store's own — the same photographs the old slideshow
 * cycled through, now given depth and direction instead of a cross-fade.
 *
 * The corridor is decorative and `aria-hidden`; it pauses rather than stops
 * under `prefers-reduced-motion`, so it freezes as a composed still.
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
    <ImageStreamHero
      images={STORE_IMAGERY}
      cards={10}
      speed={24}
      axis={50}
      className="min-h-screen w-full bg-panel"
    >
      {/* Two scrims doing different jobs. The linear one darkens top and bottom
          so the wordmark and footer hold at any frame of the loop; the radial
          one sits under the card so the form never competes with a photograph
          passing behind it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(hsl(var(--panel) / 0.92) 0%, hsl(var(--panel) / 0.35) 26%, hsl(var(--panel) / 0.35) 74%, hsl(var(--panel) / 0.94) 100%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(46% 52% at 50% 52%, hsl(var(--panel) / 0.86) 0%, hsl(var(--panel) / 0.55) 55%, transparent 100%)',
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 py-5 sm:px-10">
          <Wordmark />
          <ThemeToggle />
        </header>

        <main className="flex flex-1 items-center justify-center px-5 py-8">
          <div className="w-full max-w-[25rem] animate-fade-up">
            {/* A solid surface rather than frosted glass: the card carries a
                form, and text over a moving photograph has to be readable at
                every frame, not most of them. */}
            <div className="rounded-surface border border-border bg-surface p-7 shadow-pop sm:p-8">
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
            Every order, every movement, every boliviano — in one place.
          </p>
          <p className="mx-auto mt-1 max-w-md text-caption text-panel-muted">
            Three stores, one system. Stock, sales and the ledger stay in step
            without anyone re-typing them.
          </p>
        </footer>
      </div>
    </ImageStreamHero>
  );
}

/* ── pieces ───────────────────────────────────────────────────────────── */

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        aria-hidden
        className="grid h-7 w-7 place-items-center rounded-[7px] bg-accent text-accent-fg"
      >
        <span className="font-mono text-caption font-semibold leading-none">Q</span>
      </div>
      <span className="text-lead font-semibold tracking-tight text-panel-fg">Quberty</span>
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
          'h-10 w-full rounded-control border border-border bg-surface-sunken px-3',
          'text-body text-fg placeholder:text-fg-subtle',
          'transition-colors duration-quick hover:border-border-strong',
          'focus:border-accent focus:outline-none focus-visible:outline-none',
        )}
      />
    </div>
  );
}
