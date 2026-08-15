'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Boxes, Coins, Store } from 'lucide-react';

/**
 * The moment between signing in and the dashboard.
 *
 * Redirecting straight to /dashboard is faster but tells the user nothing, and
 * the first screen of a dense ERP is intimidating with no framing. This holds
 * for a beat, names the product, and says what the three things it manages are
 * — so the dashboard arrives as the answer to something rather than a wall of
 * numbers.
 *
 * It is a curtain, not a loading screen: it makes no claim about progress and
 * never blocks. `onDone` fires on a timer, and the parent navigates regardless
 * of what this component is doing.
 *
 * Under `prefers-reduced-motion` everything appears at once and the hold is
 * shortened — a user who has asked for less motion should not be made to wait
 * through a sequence they cannot see.
 */

const PILLARS = [
  { Icon: Store, label: 'Stores', copy: 'Counter sales and stock, three locations, one till.' },
  { Icon: Boxes, label: 'Inventory', copy: 'What is on hand, on order, and where it sits.' },
  { Icon: Coins, label: 'Finance', copy: 'Facturas, IVA and the ledger, posted as you trade.' },
];

export function WelcomeCurtain({
  name,
  onDone,
  holdMs = 1900,
}: {
  name?: string;
  onDone: () => void;
  holdMs?: number;
}) {
  const reduced = useReducedMotion();
  const hold = reduced ? 700 : holdMs;

  React.useEffect(() => {
    const t = window.setTimeout(onDone, hold);
    return () => window.clearTimeout(t);
  }, [onDone, hold]);

  // One sequence, one clock. Each element's delay is derived from its index so
  // the rhythm stays intact if the hold changes.
  const step = reduced ? 0 : 0.09;
  const rise = {
    hidden: { opacity: 0, y: reduced ? 0 : 8 },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: i * step, duration: reduced ? 0 : 0.42, ease: [0.2, 0.6, 0.3, 1] as const },
    }),
  };

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.28 } }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-bg px-6"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <motion.div
          custom={0}
          variants={rise}
          initial="hidden"
          animate="show"
          className="grid h-11 w-11 place-items-center rounded-[10px] bg-accent text-accent-fg"
        >
          <span className="font-mono text-lead font-semibold leading-none">Q</span>
        </motion.div>

        <motion.h1
          custom={1}
          variants={rise}
          initial="hidden"
          animate="show"
          className="text-display font-semibold tracking-tight text-fg"
        >
          Quberty ERP
        </motion.h1>

        <motion.p
          custom={2}
          variants={rise}
          initial="hidden"
          animate="show"
          className="max-w-md text-balance text-body text-fg-muted"
        >
          {name ? `Welcome back, ${name}. ` : ''}
          One system for the whole operation — from the shop floor to the ledger.
        </motion.p>
      </div>

      <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
        {PILLARS.map(({ Icon, label, copy }, i) => (
          <motion.div
            key={label}
            custom={3 + i}
            variants={rise}
            initial="hidden"
            animate="show"
            className="flex flex-col gap-2 rounded-surface border border-border bg-surface p-4"
          >
            <Icon className="h-4 w-4 text-accent" strokeWidth={2} aria-hidden />
            <span className="text-caption font-semibold text-fg">{label}</span>
            <span className="text-caption leading-relaxed text-fg-muted">{copy}</span>
          </motion.div>
        ))}
      </div>

      {/* A determinate bar for a known, fixed wait. A spinner here would imply
          the system is working on something, which it is not. */}
      <div className="h-px w-full max-w-2xl overflow-hidden bg-border" aria-hidden>
        <motion.div
          className="h-full bg-accent"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: hold / 1000, ease: 'linear' }}
          style={{ transformOrigin: 'left' }}
        />
      </div>

      <span className="sr-only">Signed in. Opening your dashboard.</span>
    </motion.div>
  );
}

export default WelcomeCurtain;
