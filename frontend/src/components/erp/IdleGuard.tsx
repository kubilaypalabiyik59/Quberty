'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import {
  ACTIVITY_STORAGE_KEY,
  idleTimeoutMs,
  lastActivity,
  markActivity,
  setSignoutReason,
} from '@/lib/sessionActivity';

const WARN_BEFORE_MS = 60_000;
const WRITE_THROTTLE_MS = 15_000;
const TICK_MS = 5_000;

/**
 * Ends an ERP session after the tenant's idle limit, with a one-minute warning.
 *
 * Activity in any tab counts: the timestamp is shared through localStorage and
 * every tab reads it before deciding, so a user busy in one tab is never
 * signed out by another. Writes are throttled — the point is "was there
 * activity recently", not a log of every mouse move.
 */
export function IdleGuard() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastWrite = useRef(0);

  const touch = useCallback(() => {
    const now = Date.now();
    if (now - lastWrite.current < WRITE_THROTTLE_MS) return;
    lastWrite.current = now;
    markActivity(now);
  }, []);

  const stayActive = useCallback(() => {
    lastWrite.current = Date.now();
    markActivity(lastWrite.current);
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    // Entering the ERP is activity.
    stayActive();

    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'pointermove'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));

    const check = () => {
      const last = lastActivity() ?? Date.now();
      const left = last + idleTimeoutMs() - Date.now();
      if (left <= 0) {
        setSignoutReason('idle');
        logout();
        router.replace('/login');
        return;
      }
      setSecondsLeft(left <= WARN_BEFORE_MS ? Math.ceil(left / 1000) : null);
    };
    const timer = window.setInterval(check, TICK_MS);
    // Another tab's activity clears this tab's warning straight away.
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVITY_STORAGE_KEY) check();
    };
    window.addEventListener('storage', onStorage);

    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
      window.removeEventListener('storage', onStorage);
    };
  }, [logout, router, stayActive, touch]);

  if (secondsLeft === null) return null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Session about to end"
      className="fixed bottom-5 right-5 z-[60] flex max-w-sm items-start gap-3 rounded-surface border border-border bg-surface p-4 shadow-pop"
    >
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="flex-1">
        <p className="text-body font-medium text-fg">You will be signed out in {secondsLeft}s</p>
        <p className="mt-0.5 text-caption text-fg-muted">No activity was detected for a while.</p>
        <button
          onClick={stayActive}
          className="mt-3 rounded-control bg-accent px-3 py-1.5 text-caption font-medium text-accent-fg hover:bg-accent-hover"
        >
          Stay signed in
        </button>
      </div>
    </div>
  );
}
