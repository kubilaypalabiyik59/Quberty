'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/**
 * The one modal.
 *
 * It exists because the first three dialogs written for the process chain all
 * shared two defects, and both of them present to the user as "I clicked the
 * button and nothing happened":
 *
 * 1. **The error was rendered behind the modal.** The mutation's `onError` set
 *    state on the PARENT page, which the open modal covers. A rejected request
 *    therefore produced no visible feedback at all.
 *
 * 2. **The submit button was disabled with no stated reason.** A form that
 *    refuses to submit and will not say why is indistinguishable from a broken
 *    one.
 *
 * So this component takes the error and the blocking reason as props and is
 * responsible for showing both. A caller cannot forget.
 */
export function Dialog({
  title,
  description,
  onClose,
  error,
  /** Why the primary action is unavailable. Non-empty ⇒ the button is disabled AND the reason is shown. */
  blockedReason,
  submitLabel,
  onSubmit,
  submitting,
  children,
  width = 'max-w-lg',
}: {
  title: string;
  description?: string;
  onClose: () => void;
  error?: string;
  blockedReason?: string | null;
  submitLabel: string;
  onSubmit: () => void;
  submitting?: boolean;
  children: React.ReactNode;
  width?: string;
}) {
  // Escape closes. Expected of anything that covers the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-fg/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('w-full rounded-surface border border-border bg-surface shadow-pop', width)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-lead font-semibold text-fg">{title}</h2>
            {description && <p className="mt-0.5 text-caption text-fg-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-4 py-3">
          {/* Inside the modal, above the fields — where the person who caused it is looking. */}
          {error && (
            <div
              role="alert"
              className="mb-3 rounded-control border border-danger/25 bg-danger-soft px-3 py-2 text-caption text-danger"
            >
              {error}
            </div>
          )}
          {children}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          {/* The reason lives next to the button it disables, not in a tooltip. */}
          <p className="text-caption text-fg-muted">{blockedReason ?? ''}</p>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={Boolean(blockedReason) || submitting} onClick={onSubmit}>
              {submitting ? 'Saving…' : submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Shared field styling, so a form control looks the same in every dialog. */
export const dialogField =
  'h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg ' +
  'placeholder:text-fg-subtle focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-ring';

/** Turn an axios failure into the sentence the API actually sent, never "[object Object]". */
export function apiErrorMessage(e: any, fallback: string): string {
  const err = e?.response?.data?.error;
  if (err?.details?.length) {
    return `${err.message}: ${err.details.map((d: any) => `${d.field} — ${d.message}`).join('; ')}`;
  }
  return err?.message ?? e?.message ?? fallback;
}

export default Dialog;
