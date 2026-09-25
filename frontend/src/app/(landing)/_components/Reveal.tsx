'use client';

import { motion } from 'framer-motion';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Fades its children up once as they scroll into view. Reduced-motion users get the final
 * state from CSS. The component must not branch on useReducedMotion(), because the server
 * render and the hydrated render would disagree.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={cn('motion-reduce:!transform-none motion-reduce:!opacity-100', className)}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}
