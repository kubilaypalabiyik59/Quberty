'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemeChoice } from '@/components/ThemeProvider';

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/**
 * A three-state segmented control, not a two-state switch.
 *
 * "System" has to be reachable, and it has to be distinguishable from light —
 * a toggle that only flips light/dark silently opts the user out of following
 * their OS, and they can never opt back in.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-control border border-border bg-surface-sunken p-0.5',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              'inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-[5px]',
              'transition-colors duration-quick',
              active
                ? 'bg-surface text-fg shadow-rest'
                : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

export default ThemeToggle;
