'use client';

import { useState } from 'react';
import { Footprints } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A product's own photograph, or an honest placeholder.
 *
 * The storefront used to fall back to a random stock photo (bridges, coasts)
 * when a product had no image — on a shoe shop that reads as broken. And it
 * must never fall back to a generated shoe either: a customer would take it
 * for the article they are buying. So a product without a photo says so,
 * quietly, in the shop's own colours.
 */
export function ProductImage({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={`${alt} — photo coming soon`}
        className={cn(
          'flex h-full w-full flex-col items-center justify-center gap-2',
          'bg-[radial-gradient(120%_90%_at_30%_20%,#f7efe6_0%,#ecdccb_55%,#e2cbb4_100%)] text-[#a8703f]',
          className,
        )}
      >
        <Footprints className="h-7 w-7 opacity-70" aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-[0.25em] opacity-70">Photo soon</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- product photos come from arbitrary tenant hosts
    <img src={src} alt={alt} onError={() => setFailed(true)} className={cn('h-full w-full object-cover', className)} />
  );
}
