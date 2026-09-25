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

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMosaic(ctx, canvas.clientWidth, canvas.clientHeight, (performance.now() / 1000) * MOSAIC.waveSpeed);
    };

    const tick = () => {
      const now = performance.now();
      if (now - last < 33) return;
      if (document.hidden) return;
      drawMosaic(ctx, canvas.clientWidth, canvas.clientHeight, (now / 1000) * MOSAIC.waveSpeed);
      last = now;
      requestAnimationFrame(tick);
    };

    let last = 0;
    let raf = 0;

    const onResize = () => resize();

    window.addEventListener('resize', onResize);

    if (reduce) {
      drawMosaic(ctx, canvas.clientWidth, canvas.clientHeight, 0);
    } else {
      raf = requestAnimationFrame(tick);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
