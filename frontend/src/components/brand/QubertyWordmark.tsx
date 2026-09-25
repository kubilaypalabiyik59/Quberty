import { Syncopate } from 'next/font/google';
import { cn } from '@/lib/utils';
import styles from './brand.module.css';

/**
 * Wide, tracked display face for the product name only.
 *
 * Plex stays the interface font everywhere else; this is the one place the
 * brand speaks louder than the UI, so it is loaded here rather than in the
 * root layout and only ships with the pages that render the wordmark.
 */
const display = Syncopate({
  subsets: ['latin'],
  weight: '700',
  variable: '--font-display',
  display: 'swap',
});

interface QubertyWordmarkProps {
  /** `loop` repeats the light sweep; `once` plays it a single time. */
  sweep?: 'loop' | 'once';
  className?: string;
  children?: React.ReactNode;
}

/** The silver QUBERTY wordmark. Real text, so it stays sharp at any size. */
export function QubertyWordmark({ sweep = 'loop', className, children }: QubertyWordmarkProps) {
  return (
    <div
      role="img"
      aria-label="Quberty"
      className={cn(
        display.variable,
        styles.wordmark,
        sweep === 'loop' ? styles.sweepLoop : styles.sweepOnce,
        className,
      )}
    >
      QUBERTY
      {children}
    </div>
  );
}
