import { cn } from '@/lib/utils';

/**
 * One status pill for every document in the chain.
 *
 * `components/ui/Badge.tsx` takes a COLOUR name — `color="green"` — which puts
 * the decision "is APPROVED green or blue?" in every caller, and hardcodes
 * `bg-green-100` besides, which the design system exists to remove. This takes a
 * STATUS and decides the colour once, from meaning:
 *
 *   neutral   nothing has happened yet         DRAFT, CREATED
 *   info      in flight, waiting on someone    SENT, IN_REVIEW, RECEIVED, OPEN
 *   success   the good terminal state          APPROVED, CONFIRMED, WON, ACCEPTED
 *   warning   needs attention, not fatal       EXPIRED, REVISED
 *   danger    the bad terminal state           REJECTED, LOST, CANCELLED
 *
 * Colour is never the only signal — the label is always spelled out.
 */
const TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  // shared
  DRAFT: 'neutral',
  CREATED: 'neutral',
  OPEN: 'info',
  SENT: 'info',
  CANCELLED: 'danger',
  CLOSED: 'success',

  // lead
  QUALIFIED: 'success',
  DISQUALIFIED: 'danger',

  // opportunity
  WON: 'success',
  LOST: 'danger',

  // quotation
  REVISED: 'warning',
  CONFIRMED: 'success',
  EXPIRED: 'warning',

  // requisition
  IN_REVIEW: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',

  // rfq
  RECEIVED: 'info',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  AWARDED: 'success',

  // purchase documents — product receipt and vendor invoice
  POSTED: 'success',
  PARTIALLY_RECEIVED: 'warning',
  INVOICED: 'success',

  // invoice matching verdicts. [OFFICIAL] a line that needs no matching shows
  // "Not performed" rather than a pass — silence is not a verdict.
  PASSED: 'success',
  FAILED: 'danger',
  PENDING: 'info',
  NOT_APPLICABLE: 'neutral',

  // order / po, so the same pill works downstream
  RESERVED: 'info',
  PACKED: 'info',
  SHIPPED: 'success',
  COMPLETED: 'success',
  RETURNED: 'warning',
  PAID: 'success',
};

const TONE_CLASS = {
  neutral: 'bg-surface-sunken text-fg-muted border-border',
  info: 'bg-info-soft text-info border-info/25',
  success: 'bg-success-soft text-success border-success/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
} as const;

export function StatusPill({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return <span className="text-fg-subtle">—</span>;
  const tone = TONE[status] ?? 'neutral';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-control border px-2 py-0.5 text-micro font-medium uppercase tracking-wide',
        TONE_CLASS[tone],
        className,
      )}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export default StatusPill;
