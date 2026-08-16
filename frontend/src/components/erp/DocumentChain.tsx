'use client';

import Link from 'next/link';
import { ChevronRight, Circle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The chain strip.
 *
 * A document in an ERP is never interesting alone — what a user actually needs
 * is "where did this come from and what did it become". Until now that question
 * had no answer in this product because the order was the first document in the
 * system. Now that there are five documents in front of it, showing the chain is
 * the whole point of having built it.
 *
 *   Lead → Opportunity → Quotation → Sales Order
 *   Requisition → RFQ → Purchase Order
 *
 * A step with no `href` is one that did not happen (most sales go straight to an
 * order, and that is fine); it renders greyed rather than being hidden, so the
 * shape of the process stays legible and a skipped step is visibly a choice.
 */
export interface ChainStep {
  label: string;
  /** Document number, e.g. QT-2026-00004. Absent when the step did not happen. */
  value?: string | null;
  href?: string | null;
  /** Highlights the document currently on screen. */
  current?: boolean;
}

export function DocumentChain({ steps, className }: { steps: ChainStep[]; className?: string }) {
  return (
    <nav
      aria-label="Document chain"
      className={cn(
        'flex flex-wrap items-center gap-x-1 gap-y-2 rounded-surface border border-border bg-surface px-3 py-2.5',
        className,
      )}
    >
      {steps.map((s, i) => {
        const done = Boolean(s.value);
        const Icon = done ? CheckCircle2 : Circle;

        const body = (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-caption transition-colors duration-quick',
              s.current && 'bg-accent-soft text-accent-onSoft font-semibold',
              !s.current && done && 'text-fg hover:bg-surface-sunken',
              !done && 'text-fg-subtle',
            )}
          >
            <Icon className={cn('h-3.5 w-3.5 shrink-0', done ? 'text-success' : 'text-fg-subtle')} />
            <span className="font-medium">{s.label}</span>
            {s.value ? (
              <span className="font-mono text-micro text-fg-muted">{s.value}</span>
            ) : (
              <span className="text-micro">not used</span>
            )}
          </span>
        );

        return (
          <span key={`${s.label}-${i}`} className="inline-flex items-center">
            {s.href && !s.current ? <Link href={s.href}>{body}</Link> : body}
            {i < steps.length - 1 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden />
            )}
          </span>
        );
      })}
    </nav>
  );
}

export default DocumentChain;
