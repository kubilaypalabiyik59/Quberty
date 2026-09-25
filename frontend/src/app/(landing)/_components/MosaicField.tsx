'use client';

import { useEffect, useRef } from 'react';
import { MOSAIC, drawMosaic } from './mosaic';

/** Reduced take on the "Vignette Bloom" mosaic look for the landing background. */
export function MosaicField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeAt = (now: number) => (reduce ? 0 : (now / 1000) * MOSAIC.waveSpeed);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMosaic(ctx, canvas.clientWidth, canvas.clientHeight, timeAt(performance.now()));
    };

    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 33 || document.hidden) return;
      last = now;
      drawMosaic(ctx, canvas.clientWidth, canvas.clientHeight, timeAt(now));
    };

    resize();
    window.addEventListener('resize', resize);
    if (!reduce) raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
