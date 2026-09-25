'use client';

import { useRef } from 'react';
import { MOSAIC, drawMosaic } from './mosaic';

/** Reduced take on the "Vignette Bloom" mosaic look for the landing background. */
export function MosaicField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const resize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMosaic(ctx, canvas.clientWidth, canvas.clientHeight, reduce ? 0 : performance.now());
  };

  const tick = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const now = performance.now();
    if (now - last < 33) return;
    if (document.hidden) return;
    drawMosaic(ctx, canvas.clientWidth, canvas.clientHeight, (now / 1000) * MOSAIC.waveSpeed);
    last = now;
    requestAnimationFrame(tick);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const onResize = () => resize();

    let last = 0;
    const onFrame = () => requestAnimationFrame(onFrame);

    window.addEventListener('resize', onResize);

    if (reduce) {
      resize();
    } else {
      requestAnimationFrame(onFrame);
    }

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(onFrame);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={className} />;
}
