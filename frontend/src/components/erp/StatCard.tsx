'use client';

import Link from 'next/link';
import { ArrowUpRight, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A KPI tile.
 *
 * The previous version put seven treatments on one number: gradient background,
 * dot-grid texture, corner glow orb, bottom accent line, count-up animation,
 * spring hover lift and a text shadow — and shipped two visual languages in the
 * same file (`DarkCard` maroon gradient, `LightCard` white with a red rail).
 * All of it is gone. A metric tile is a label, a number, and how it moved.
 *
 * Two substantive fixes, not just visual:
 *
 * 1. **The trend colours were inverted.** Up rendered red, down rendered green.
 *    On a revenue tile that is backwards, and it had been on the dashboard the
 *    whole time.
 * 2. **Direction is not always good.** Rising returns or rising cost are bad
 *    news. `polarity` says which way is favourable, so the colour follows
 *    meaning rather than sign. Colour is never the only signal — the arrow and
 *    the sign carry it too.
 */

export type StatPolarity = 'up-is-good' | 'down-is-good' | 'neutral';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  /** Percentage change against the comparison period. */
  change?: number;
  trendLabel?: string;
  icon?: React.ReactNode;
  href?: string;
  /** @default 'up-is-good' */
  polarity?: StatPolarity;
}

export function StatCard({
  title,
  value,
  subtitle,
  change,
  trendLabel = 'vs last month',
  icon,
  href,
  polarity = 'up-is-good',
}: StatCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-caption font-medium text-fg-muted">{title}</span>
        {icon ? <span className="text-fg-subtle [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-display font-semibold tracking-tight text-fg" data-numeric>
          {value}
        </span>
        {href ? (
          <ArrowUpRight
            className="h-3.5 w-3.5 shrink-0 text-fg-subtle opacity-0 transition-opacity duration-quick group-hover:opacity-100"
            aria-hidden
          />
        ) : null}
      </div>

      {subtitle ? <p className="mt-1 text-caption text-fg-subtle">{subtitle}</p> : null}

      {change !== undefined ? <Delta change={change} polarity={polarity} label={trendLabel} /> : null}
    </>
  );

  const shell = cn(
    'group block rounded-surface border border-border bg-surface p-4',
    href && 'transition-colors duration-quick hover:border-border-strong',
  );

  return href ? (
    <Link href={href} className={cn(shell, 'cursor-pointer')}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}

function Delta({
  change,
  polarity,
  label,
}: {
  change: number;
  polarity: StatPolarity;
  label: string;
}) {
  const rising = change > 0;
  const flat = change === 0;

  const favourable =
    polarity === 'neutral' || flat
      ? null
      : polarity === 'up-is-good'
        ? rising
        : !rising;

  const tone =
    favourable === null
      ? 'text-fg-subtle'
      : favourable
        ? 'text-success'
        : 'text-danger';

  const Icon = rising ? TrendingUp : TrendingDown;

  return (
    <div className="mt-2.5 flex items-center gap-1.5 text-caption">
      {!flat ? <Icon className={cn('h-3.5 w-3.5', tone)} strokeWidth={2.5} aria-hidden /> : null}
      {/* The sign is spelled out so the direction survives without colour. */}
      <span className={cn('font-medium tabular-nums', tone)}>
        {rising ? '+' : ''}
        {change.toFixed(1)}%
      </span>
      <span className="text-fg-subtle">{label}</span>
    </div>
  );
}

export default StatCard;
