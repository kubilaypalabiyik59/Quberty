'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { QubertyWordmark } from '@/components/brand/QubertyWordmark';
import brand from '@/components/brand/brand.module.css';

/**
 * The moment between signing in and the dashboard.
 *
 * Redirecting straight to /dashboard is faster but tells the user nothing, and
 * the first screen of a dense ERP is intimidating with no framing. This holds
 * for a beat on a living picture of what the product does — stores, warehouse
 * and office, with light running along the streets from each of them into one
 * cube — so the dashboard arrives as the answer to something rather than a
 * wall of numbers.
 *
 * It is a curtain, not a loading screen: it makes no claim about progress and
 * never blocks. `onDone` fires on a timer, or at once on a click or key press,
 * because someone who signs in ten times a day must not be made to sit
 * through it ten times.
 *
 * Under `prefers-reduced-motion` the scene is a still and the hold is short.
 */

const PILLARS = [
  { label: 'Sales', copy: 'Orders, counters and customers flowing into one book.' },
  { label: 'Inventory', copy: 'What is on hand, on order, and where it sits — live.' },
  { label: 'Finance', copy: 'Every movement posted to the ledger as you trade.' },
];

/*
 * Routes traced on welcome-city.webp's own pixel grid (1536×1024). The plate
 * and the lights share one SVG with the same "slice" crop, so the routes stay
 * on the streets at any viewport. Replacing the image means retracing these.
 */
type Pt = readonly [number, number];
const CUBE: Pt = [768, 92];
const ROUTES: Pt[][] = [
  [[0, 330], [140, 285], [320, 235], [480, 195], [610, 160], [700, 125], CUBE],
  [[0, 715], [120, 700], [260, 590], [400, 490], [540, 400], [615, 340], [570, 295], [560, 250], [640, 185], [720, 125], CUBE],
  [[470, 1024], [330, 930], [170, 820], [40, 745]],
  [[1536, 950], [1330, 865], [1160, 760], [1110, 700], [1160, 640], [1240, 575], [1140, 490], [1030, 410], [950, 345], [905, 295], [915, 240], [870, 170], [805, 110], CUBE],
  [[1110, 190], [980, 165], [870, 130], [800, 100], CUBE],
];
/** Lit windows that breathe: [x, y, radius]. */
const WINDOWS: Pt[] = [[150, 545], [300, 420], [450, 345], [1410, 610], [1410, 690], [1495, 395]];
const WINDOW_R = [60, 55, 50, 70, 70, 35];

/** Catmull-Rom through the traced points, as cubic Béziers. */
function toPath(p: Pt[]) {
  let d = `M${p[0][0]},${p[0][1]}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] ?? p[i];
    const b = p[i];
    const c = p[i + 1];
    const e = p[i + 2] ?? c;
    d += ` C${b[0] + (c[0] - a[0]) / 6},${b[1] + (c[1] - a[1]) / 6} ${c[0] - (e[0] - b[0]) / 6},${c[1] - (e[1] - b[1]) / 6} ${c[0]},${c[1]}`;
  }
  return d;
}
const PATHS = ROUTES.map(toPath);

export function WelcomeCurtain({
  name,
  onDone,
  holdMs = 3200,
}: {
  name?: string;
  onDone: () => void;
  holdMs?: number;
}) {
  const reduced = useReducedMotion();
  const hold = reduced ? 900 : holdMs;
  const routesRef = React.useRef<SVGGElement>(null);
  const pulsesRef = React.useRef<SVGGElement>(null);
  const windowsRef = React.useRef<SVGGElement>(null);
  const coreRef = React.useRef<SVGCircleElement>(null);

  // One exit, whichever comes first: the timer, a click or a key.
  const done = React.useRef(false);
  const finish = React.useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  React.useEffect(() => {
    const t = window.setTimeout(finish, hold);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') finish();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [finish, hold]);

  // Comets: a bright head with a fading tail, travelling each street into the cube.
  React.useEffect(() => {
    if (reduced) return;
    const paths = Array.from(routesRef.current?.querySelectorAll('path') ?? []);
    const pulseLayer = pulsesRef.current;
    const windows = Array.from(windowsRef.current?.querySelectorAll('circle') ?? []);
    const core = coreRef.current;
    if (!pulseLayer || !core) return;

    const NS = 'http://www.w3.org/2000/svg';
    const routes = paths.map((el, i) => ({
      el,
      len: el.getTotalLength(),
      toCube: ROUTES[i][ROUTES[i].length - 1] === CUBE,
    }));
    const start = performance.now();
    const pulses = routes.flatMap((r, i) =>
      [0, 1, 2].map((k) => {
        const g = document.createElementNS(NS, 'g');
        const tail = Array.from({ length: 7 }, (_, j) => {
          const c = document.createElementNS(NS, 'circle');
          c.setAttribute('r', String(5.5 - j * 0.6));
          c.setAttribute('fill', j ? '#45c4bb' : '#e6fffc');
          c.setAttribute('opacity', String(1 - j * 0.13));
          g.appendChild(c);
          return c;
        });
        pulseLayer.appendChild(g);
        return { r, g, tail, t0: start + i * 160 + k * 900 + Math.random() * 300, dur: 1700 + Math.random() * 900, hit: false };
      }),
    );
    const phases = windows.map(() => ({ ph: Math.random() * Math.PI * 2, sp: 0.6 + Math.random() * 0.8 }));

    let flash = 0;
    let raf = 0;
    const frame = (now: number) => {
      for (const p of pulses) {
        const u = (now - p.t0) / p.dur;
        if (u < 0 || u > 1) {
          p.g.style.display = 'none';
          if (u > 1) {
            if (p.r.toCube && !p.hit) flash = 1;
            p.t0 = now + 300 + Math.random() * 900;
            p.hit = false;
          }
          continue;
        }
        p.g.style.display = '';
        const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
        p.tail.forEach((c, j) => {
          const pt = p.r.el.getPointAtLength(Math.max(0, e * p.r.len - j * 9));
          c.setAttribute('cx', String(pt.x));
          c.setAttribute('cy', String(pt.y));
        });
        p.g.setAttribute('opacity', String(Math.min(1, u * 6, (1 - u) * 8)));
      }
      windows.forEach((w, i) => {
        w.setAttribute('opacity', String(0.55 + 0.45 * Math.sin((now / 1000) * phases[i].sp + phases[i].ph)));
      });
      flash *= 0.93;
      core.setAttribute('opacity', String(0.35 + 0.125 * Math.sin(now / 420) + flash * 0.65));
      core.setAttribute('r', String(70 + flash * 26));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      pulseLayer.replaceChildren();
    };
  }, [reduced]);

  // One sequence, one clock: each element's delay comes from its index.
  const step = reduced ? 0 : 0.12;
  const rise = {
    hidden: { opacity: 0, y: reduced ? 0 : 10 },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: 0.1 + i * step, duration: reduced ? 0 : 0.6, ease: [0.2, 0.6, 0.3, 1] as const },
    }),
  };

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      transition={{ duration: 0.25 }}
      onClick={finish}
      className={`dark ${brand.curtain}`}
      style={{ '--hold': `${hold}ms` } as React.CSSProperties}
    >
      <svg
        className={brand.city}
        viewBox="0 0 1536 1024"
        preserveAspectRatio="xMidYMin slice"
        aria-hidden
      >
        <defs>
          <filter id="wc-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="wc-halo">
            <stop offset="0" stopColor="#bff7f2" stopOpacity=".95" />
            <stop offset=".35" stopColor="#45c4bb" stopOpacity=".55" />
            <stop offset="1" stopColor="#45c4bb" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="wc-amber">
            <stop offset="0" stopColor="#ffd59a" stopOpacity=".55" />
            <stop offset="1" stopColor="#ffb34d" stopOpacity="0" />
          </radialGradient>
        </defs>
        <image href="/brand/welcome-city.webp" x="0" y="0" width="1536" height="1024" />
        <g ref={windowsRef} style={{ mixBlendMode: 'screen' }}>
          {WINDOWS.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={WINDOW_R[i]} fill="url(#wc-amber)" opacity={0.75} />
          ))}
        </g>
        <g ref={routesRef} fill="none" stroke="transparent">
          {PATHS.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </g>
        <g ref={pulsesRef} style={{ mixBlendMode: 'screen' }} filter="url(#wc-glow)" />
        <circle
          ref={coreRef}
          cx={768}
          cy={64}
          r={70}
          fill="url(#wc-halo)"
          opacity={0.35}
          style={{ mixBlendMode: 'screen' }}
        />
      </svg>
      <div className={brand.cityScrim} aria-hidden />

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3.5 px-5 pb-[12vh] text-center max-sm:pb-[30vh]">
        <motion.div custom={0} variants={rise} initial="hidden" animate="show">
          <QubertyWordmark sweep="once" className={brand.curtainWordmark} />
        </motion.div>
        <motion.p
          custom={1}
          variants={rise}
          initial="hidden"
          animate="show"
          className={`text-lead font-medium text-fg ${brand.curtainText}`}
        >
          {name ? (
            <>
              Welcome back, <span className="text-accent">{name}</span>.
            </>
          ) : (
            'Welcome to Quberty.'
          )}
        </motion.p>
        <motion.p
          custom={2}
          variants={rise}
          initial="hidden"
          animate="show"
          className={`text-caption text-fg-muted ${brand.curtainText}`}
        >
          Every store, every shipment, every ledger line — already in step.
        </motion.p>
      </div>

      <div className="absolute bottom-[7vh] left-1/2 grid w-[min(860px,calc(100%-32px))] -translate-x-1/2 gap-2 sm:grid-cols-3 sm:gap-3">
        {PILLARS.map(({ label, copy }, i) => (
          <motion.div
            key={label}
            custom={3 + i}
            variants={rise}
            initial="hidden"
            animate="show"
            className={`rounded-surface px-4 py-3.5 text-left ${brand.pillar}`}
          >
            <span className="flex items-center gap-2 text-caption font-semibold text-fg">
              <i className={brand.pillarDot} aria-hidden />
              {label}
            </span>
            <p className="mt-1.5 text-caption leading-relaxed text-fg-muted max-sm:hidden">{copy}</p>
          </motion.div>
        ))}
      </div>

      {/* A determinate bar for a known, fixed wait. A spinner here would imply
          the system is working on something, which it is not. */}
      <div
        className={`absolute bottom-[3.6vh] left-1/2 h-px w-[min(860px,calc(100%-32px))] -translate-x-1/2 overflow-hidden bg-white/10 ${brand.progress}`}
        aria-hidden
      />
      <span className="absolute bottom-3.5 right-5 text-[11px] tracking-wide text-white/35" aria-hidden>
        Click or press Enter to continue
      </span>

      <span className="sr-only">Signed in. Opening your dashboard.</span>
    </motion.div>
  );
}

export default WelcomeCurtain;
