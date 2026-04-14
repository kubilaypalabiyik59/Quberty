'use client';

import { motion, useMotionValue, useTransform, animate, type Variants } from 'framer-motion';
import Link from 'next/link';
import { TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: number;
  trendLabel?: string;
  icon: React.ReactNode;
  href?: string;
  variant?: 'light' | 'dark';
}

// Animated number counter
function CountUp({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const motionVal = useMotionValue(0);
  const rounded = useTransform(motionVal, (v) => `${prefix}${Math.round(v).toLocaleString()}${suffix}`);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const controls = animate(motionVal, value, { duration: 1.2, ease: 'easeOut' });
    return controls.stop;
  }, [value, motionVal]);

  return <motion.span ref={ref}>{rounded}</motion.span>;
}

function DarkCard({ title, value, subtitle, change, trendLabel = 'vs last month', icon, href }: StatCardProps) {
  const trendType = change === undefined ? 'neutral' : change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';
  const TrendIcon = trendType === 'up' ? TrendingUp : trendType === 'down' ? TrendingDown : Minus;
  const trendColor = trendType === 'up' ? 'text-emerald-400' : trendType === 'down' ? 'text-red-400' : 'text-white/20';

  // Try to extract a numeric value for count-up
  const numericMatch = String(value).match(/[\d,]+\.?\d*/);
  const numericValue = numericMatch ? parseFloat(numericMatch[0].replace(/,/g, '')) : null;
  const prefix = String(value).split(/[\d,]/)[0] ?? '';
  const suffix = String(value).split(/[\d,.]+/).slice(-1)[0] ?? '';
  const isLoading = value === '—';

  return (
    <div className="h-full rounded-xl relative overflow-hidden group"
      style={{
        background: 'linear-gradient(135deg, #1c0606 0%, #2a0808 50%, #1a0505 100%)',
        border: '1px solid rgba(180,30,30,0.25)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,80,80,0.05)',
      }}>

      {/* dot-grid texture */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'radial-gradient(rgba(255,80,80,0.07) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }} />

      {/* top-right glow orb */}
      <div className="absolute -top-4 -right-4 w-20 h-20 rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(180,30,30,0.25) 0%, transparent 70%)' }} />

      {/* content */}
      <div className="relative p-5 h-full flex flex-col justify-between">
        <div className="flex items-start justify-between mb-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-red-300/40">{title}</span>
          <div className="flex items-center gap-1.5">
            <div className="p-1.5 rounded-lg text-red-400/70" style={{ background: 'rgba(180,30,30,0.2)' }}>
              {icon}
            </div>
            {href && <ExternalLink className="h-3 w-3 text-red-400/30 group-hover:text-red-400/60 transition-colors" />}
          </div>
        </div>

        <div>
          <div className="text-3xl font-bold tracking-tight leading-none mb-1" style={{ color: '#fef3c7', textShadow: '0 0 24px rgba(251,191,36,0.15)' }}>
            {isLoading ? '—' : (numericValue !== null
              ? <><span className="text-amber-200/60 text-xl font-semibold">{prefix}</span><CountUp value={numericValue} /><span className="text-amber-200/60 text-xl font-semibold">{suffix}</span></>
              : value
            )}
          </div>
          {subtitle && <p className="text-[11px] text-red-300/35 mt-1">{subtitle}</p>}
          {change !== undefined && !isLoading && (
            <div className={cn('flex items-center gap-1 mt-2 text-xs font-medium', trendColor)}>
              <TrendIcon className="h-3 w-3" />
              {Math.abs(change).toFixed(1)}% {trendLabel}
            </div>
          )}
        </div>
      </div>

      {/* bottom accent line */}
      <div className="absolute bottom-0 left-0 right-0 h-[1px]"
        style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(180,30,30,0.6) 50%, transparent 100%)' }} />
    </div>
  );
}

function LightCard({ title, value, subtitle, change, trendLabel = 'vs last month', icon }: StatCardProps) {
  const trendType = change === undefined ? 'neutral' : change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';
  const TrendIcon = trendType === 'up' ? TrendingUp : trendType === 'down' ? TrendingDown : Minus;
  const trendColor = trendType === 'up' ? 'text-green-600' : trendType === 'down' ? 'text-red-600' : 'text-gray-400';

  const numericMatch = String(value).match(/[\d,]+\.?\d*/);
  const numericValue = numericMatch ? parseFloat(numericMatch[0].replace(/,/g, '')) : null;
  const prefix = String(value).split(/[\d,]/)[0] ?? '';
  const suffix = String(value).split(/[\d,.]+/).slice(-1)[0] ?? '';
  const isLoading = value === '—';

  return (
    <div className="h-full rounded-xl bg-white relative overflow-hidden"
      style={{
        border: '1px solid rgba(220,38,38,0.15)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        borderLeft: '3px solid rgba(185,28,28,0.7)',
      }}>
      <div className="p-5 h-full flex flex-col justify-between">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</span>
          <div className="p-2 rounded-lg bg-red-50 text-red-700/70">{icon}</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900 tracking-tight">
            {isLoading ? '—' : (numericValue !== null
              ? <><span className="text-gray-500 font-medium">{prefix}</span><CountUp value={numericValue} /><span className="text-gray-500 font-medium">{suffix}</span></>
              : value
            )}
          </div>
          {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
          {change !== undefined && !isLoading && (
            <div className={cn('flex items-center gap-1 mt-2 text-xs font-medium', trendColor)}>
              <TrendIcon className="h-3 w-3" />
              {Math.abs(change).toFixed(1)}% {trendLabel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const darkHover = {
  whileHover: { y: -4, boxShadow: '0 20px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(200,50,50,0.4)' },
  transition: { type: 'spring' as const, stiffness: 380, damping: 22 },
};
const lightHover = {
  whileHover: { y: -3, boxShadow: '0 8px 24px rgba(185,28,28,0.12)' },
  transition: { type: 'spring' as const, stiffness: 380, damping: 22 },
};

export function StatCard(props: StatCardProps) {
  const { href, variant = 'light' } = props;
  const hoverProps = variant === 'dark' ? darkHover : lightHover;
  const Card = variant === 'dark' ? DarkCard : LightCard;

  const inner = <Card {...props} />;

  if (href) {
    return (
      <motion.div {...hoverProps} className="cursor-pointer rounded-xl h-full">
        <Link href={href} className="block h-full">{inner}</Link>
      </motion.div>
    );
  }
  return <motion.div {...hoverProps} className="rounded-xl h-full">{inner}</motion.div>;
}
