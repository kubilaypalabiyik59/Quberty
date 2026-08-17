'use client';

import * as React from 'react';

/**
 * Design tokens, resolved to concrete colour strings for charting libraries.
 *
 * Everywhere else in this product a component says `bg-surface` and Tailwind
 * resolves the token. Recharts cannot do that: it writes `fill` and `stroke`
 * attributes onto SVG and needs a real colour string, not a class name. So this
 * is the ONE sanctioned place where tokens are read out as values.
 *
 * It is not an exemption from the rule. A chart component still never names a
 * raw colour — it names a role (`t.series[0]`, `t.grid`, `t.status.late`) and
 * this module is the only thing that knows what those resolve to. Changing
 * `--series-1` in globals.css still changes every chart, which is the property
 * that matters.
 *
 * Why read from the DOM rather than duplicate the hex values here: a second
 * copy of the palette is a second source of truth, and it drifts. That is
 * exactly how SalesChart ended up rendering a maroon dark mode months after the
 * accent became teal.
 */

const SERIES_VARS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5'] as const;

export interface ChartTokens {
  /** Categorical identity. Assign IN ORDER; never cycle past the end. */
  series: string[];
  /** Reserved for the traffic light. Never used as a series colour. */
  status: { ok: string; warn: string; late: string; unknown: string };
  grid: string;
  axis: string;
  surface: string;
  border: string;
  fg: string;
  fgMuted: string;
  /** The hover cursor wash behind a bar. Deliberately near-invisible. */
  cursor: string;
}

/** `184 72% 26%` (a Tailwind-style channel triplet) -> `hsl(184 72% 26%)`. */
function hsl(triplet: string, alpha?: number): string {
  const v = triplet.trim();
  if (!v) return 'transparent';
  return alpha === undefined ? `hsl(${v})` : `hsl(${v} / ${alpha})`;
}

function read(): ChartTokens {
  // SSR and the first paint before hydration: return a neutral set rather than
  // guessing a palette. The effect below replaces it as soon as the DOM exists.
  const empty = 'transparent';
  if (typeof window === 'undefined') {
    return {
      series: SERIES_VARS.map(() => empty),
      status: { ok: empty, warn: empty, late: empty, unknown: empty },
      grid: empty, axis: empty, surface: empty, border: empty,
      fg: empty, fgMuted: empty, cursor: empty,
    };
  }

  const s = getComputedStyle(document.documentElement);
  const get = (name: string) => s.getPropertyValue(name);

  return {
    series: SERIES_VARS.map((v) => hsl(get(v))),
    status: {
      ok: hsl(get('--success')),
      warn: hsl(get('--warning')),
      late: hsl(get('--danger')),
      // No time window means no colour claim — see the panel design doc. The
      // neutral here is deliberate and must never be quietly promoted to green.
      unknown: hsl(get('--fg-subtle')),
    },
    grid: hsl(get('--border'), 0.7),
    axis: hsl(get('--fg-subtle')),
    surface: hsl(get('--surface-raised')),
    border: hsl(get('--border')),
    fg: hsl(get('--fg')),
    fgMuted: hsl(get('--fg-muted')),
    cursor: hsl(get('--fg'), 0.04),
  };
}

/**
 * Live chart tokens for the theme currently on screen.
 *
 * Watches the `dark` class on <html> rather than subscribing to the theme
 * context, so a chart works in any tree — including one rendered outside
 * ThemeProvider, where `useTheme()` throws.
 */
export function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = React.useState<ChartTokens>(read);

  React.useEffect(() => {
    const sync = () => setTokens(read());
    sync(); // hydration: swap the SSR placeholders for real values

    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // `system` theme follows the OS without touching the class list.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', sync);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', sync);
    };
  }, []);

  return tokens;
}
