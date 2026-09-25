'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/** A styled link that renders an <a> for mailto:/http hrefs or a next/link otherwise. */
export function CtaLink({
  href,
  variant,
  size = 'md',
  className,
  children,
}: {
  href: string;
  variant: 'primary' | 'outline' | 'ghost';
  size?: 'md' | 'lg';
  className?: string;
  children: ReactNode;
}) {
  const classes = cn(buttonVariants({ variant, size }), className);

  if (href.startsWith('mailto:') || href.startsWith('http')) {
    return <a href={href} className={classes}>{children}</a>;
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
