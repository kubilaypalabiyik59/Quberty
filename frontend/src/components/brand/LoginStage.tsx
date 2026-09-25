'use client';

import { useEffect, useRef } from 'react';
import styles from './brand.module.css';

/**
 * The sign-in scene: an empty stage, a glass cube floating in its light beam,
 * dust drifting through the beam, and a little parallax under the pointer.
 *
 * The cube is a separate layer screen-blended over the stage, which is what
 * lets it float and turn without re-rendering the photograph around it.
 * Decorative throughout and `aria-hidden`.
 */
export function LoginStage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const dustRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const root = rootRef.current;
    const canvas = dustRef.current;
    if (!root || !canvas) return;

    // Parallax: the cube sits nearer the viewer than the stage, so it travels further.
    const layers = Array.from(root.querySelectorAll<HTMLElement>('[data-depth]'));
    const onMove = (e: PointerEvent) => {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      for (const l of layers) {
        const d = Number(l.dataset.depth);
        l.style.transform = `translate3d(${-nx * d * 14}px, ${-ny * d * 10}px, 0)`;
      }
    };
    const parallax = !reduce && window.matchMedia('(pointer: fine)').matches;
    if (parallax) window.addEventListener('pointermove', onMove);

    // Dust: a few dozen motes drifting down through the beam.
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    let w = 0;
    let h = 0;
    type Mote = { x: number; y: number; r: number; vy: number; vx: number; a: number; t: number };
    let motes: Mote[] = [];
    const spawn = (anywhere: boolean): Mote => ({
      x: w * 0.8 + (Math.random() - 0.5) * w * 0.22,
      y: anywhere ? Math.random() * h * 0.75 : -10,
      r: (Math.random() * 1.4 + 0.4) * dpr,
      vy: (Math.random() * 0.12 + 0.04) * dpr,
      vx: (Math.random() - 0.5) * 0.08 * dpr,
      a: Math.random() * 0.6 + 0.2,
      t: Math.random() * Math.PI * 2,
    });
    const resize = () => {
      w = canvas.width = window.innerWidth * dpr;
      h = canvas.height = window.innerHeight * dpr;
      motes = Array.from({ length: 70 }, () => spawn(true));
    };
    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#7fe3dc';
      for (const m of motes) {
        m.t += 0.01;
        m.y += m.vy;
        m.x += m.vx + Math.sin(m.t) * 0.05;
        if (m.y > h * 0.72) Object.assign(m, spawn(false));
        ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(m.t * 2));
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!reduce) raf = requestAnimationFrame(tick);
    };
    resize();
    tick();
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      if (parallax) window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <div ref={rootRef} className={styles.stage} aria-hidden>
      <div className={`${styles.layer} ${styles.plate}`} data-depth="0.6" />
      <div className={`${styles.layer} ${styles.beam}`} data-depth="0.8" />
      <div className={`${styles.layer} ${styles.cubeLayer}`} data-depth="1.6">
        <div className={styles.cubeAnchor}>
          <div className={styles.reflection} />
          <div className={styles.cube} />
        </div>
      </div>
      <canvas ref={dustRef} className={styles.dust} />
      <div className={styles.scrim} />
    </div>
  );
}
