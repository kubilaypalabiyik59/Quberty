'use client';

import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * The one button.
 *
 * There were two component systems in `components/ui`: this file with a
 * hand-rolled variant map, and shadcn-style `card.tsx` alongside it.
 * `class-variance-authority` was already a dependency and unused. It is used
 * now, so variants are declared once and typed rather than string-concatenated.
 *
 * Two behaviour notes carried over deliberately:
 * - `primary` was `bg-gray-900`, i.e. the brand had no presence on its own
 *   primary action. It is the accent now.
 * - Callers pass `variant="outline"` and `variant="success"` in a few places
 *   and silently got nothing, because neither existed in the old map. Both are
 *   real variants here, which also clears those type errors.
 */
const button = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-control font-medium',
    'transition-colors duration-quick',
    'cursor-pointer',
    'disabled:pointer-events-none disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'border border-border bg-surface text-fg hover:bg-surface-sunken hover:border-border-strong',
        outline: 'border border-border-strong bg-transparent text-fg hover:bg-surface-sunken',
        ghost: 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
        danger: 'bg-danger text-fg-onDark hover:opacity-90',
        success: 'bg-success text-fg-onDark hover:opacity-90',
      },
      size: {
        /** Dense rows and toolbars. */
        sm: 'h-8 px-2.5 text-caption',
        md: 'h-9 px-3.5 text-body',
        lg: 'h-10 px-4 text-body',
        /** Square, for a lone icon. Meets the 24px minimum target with padding. */
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant, size, className, ...props }, ref) => (
    <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
  ),
);

Button.displayName = 'Button';

export { button as buttonVariants };
export default Button;
