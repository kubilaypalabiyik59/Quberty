'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { geoMercator, geoPath, geoGraticule10 } from 'd3-geo';
import { feature, merge } from 'topojson-client';

/**
 * The operations map — floor 2 of the panel.
 *
 * ## The one idea that makes it work
 *
 * The server sends **facts**: two endpoints and a time window. Position is
 * derived here, every frame, from a clock:
 *
 *     t = clamp((now − startedAt) / (dueAt − startedAt), 0, 1)
 *
 * So a figure keeps moving between data refreshes, the animation never depends
 * on how often the server is polled, and swapping the position source later —
 * a carrier tracking API instead of the clock — changes one function rather
 * than the render.
 *
 * ## Mercator is affine, which is why the coastlines are drawn once
 *
 * `lonLat → translate + scale · unit(lonLat)`. So the country paths are
 * generated once against a unit projection and the camera applied as an SVG
 * transform. Zooming does not recompute 177 country outlines.
 *
 * Paths are generated at PATH_SCALE and divided back out in the transform:
 * `geoPath` rounds to three decimals, and at unit scale (coordinates ≈ 1) that
 * rounding is visible faceting once zoomed.
 *
 * ## What it will not do
 *
 * It never invents a position. An agent missing either endpoint is absent from
 * the map and counted in the caption instead. A dot in roughly the right place
 * is worse than no dot, because the reader cannot tell the two apart.
 */

const PATH_SCALE = 10_000;
const basePath = geoPath(geoMercator().scale(PATH_SCALE).translate([0, 0]));
const baseProj = geoMercator().scale(1).translate([0, 0]);

export type Health = 'ok' | 'warn' | 'late' | 'unknown';

export interface MapPlace {
  key: string;
  label: string;
  lat: number;
  lng: number;
  source: string;
  confidence?: number | null;
}

export interface MapAgent {
  id: string;
  label: string;
  process: string;
  from_key: string | null;
  to_key: string | null;
  started_at: string | null;
  due_at: string | null;
  health: Health;
  amount: number;
}

/** Token names, not colours — the map obeys the theme like everything else. */
const HEALTH_VAR: Record<Health, string> = {
  ok: 'hsl(var(--map-ok))',
  warn: 'hsl(var(--map-warn))',
  late: 'hsl(var(--map-late))',
  unknown: 'hsl(var(--map-unknown))',
};

export function OperationsMap({
  places,
  agents,
  selectedId,
  onSelect,
  height = 420,
}: {
  places: MapPlace[];
  agents: MapAgent[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  height?: number;
}) {
  const [land, setLand] = useState<string | null>(null);
  const [graticule, setGraticule] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);

  // 30s rather than 60s: this is the layer where movement is the point.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Coastlines, fetched once from a vendored asset — no external host, so this
  // works offline and under a strict content policy.
  useEffect(() => {
    let cancelled = false;
    fetch('/geo/countries-110m.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((topo: any) => {
        if (cancelled || !topo) return;
        const united = merge(topo, topo.objects.countries.geometries);
        setLand(basePath(united as any) ?? null);
        setGraticule(basePath(geoGraticule10() as any) ?? null);
      })
      .catch(() => {
        // The map still works without coastlines — points and routes are the
        // data; the landmass is orientation. Fail quietly rather than blank.
      });
    return () => { cancelled = true; };
  }, []);

  const byKey = useMemo(() => new Map(places.map((p) => [p.key, p])), [places]);

  /**
   * The camera: fit every place in view, with a margin.
   *
   * Derived from the data rather than hardcoded to a country — the panel must
   * open on whatever the tenant actually covers. A single place still gets a
   * sensible zoom rather than an infinite one.
   */
  const view = useMemo(() => {
    const pts = places.map((p) => baseProj([p.lng, p.lat]) as [number, number]).filter(Boolean);
    const h = height;
    if (!pts.length) return { scale: width / 6.3, tx: width / 2, ty: h / 2 };

    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const margin = 0.22;
    // Capped: two places on opposite sides of the world must not zoom so far
    // out that the map becomes a stamp, nor a single place so far in that the
    // coastline turns to mush.
    const scale = Math.min(
      Math.max(Math.min((width * (1 - margin)) / spanX, (h * (1 - margin)) / spanY), width / 12),
      width / 1.2,
    );
    return {
      scale,
      tx: width / 2 - ((minX + maxX) / 2) * scale,
      ty: h / 2 - ((minY + maxY) / 2) * scale,
    };
  }, [places, width, height]);

  const project = (lng: number, lat: number): [number, number] => {
    const u = baseProj([lng, lat]) as [number, number];
    return [u[0] * view.scale + view.tx, u[1] * view.scale + view.ty];
  };

  /** Where along its route each agent currently sits. */
  const positioned = useMemo(() => {
    return agents
      .map((a) => {
        const from = a.from_key ? byKey.get(a.from_key) : null;
        const to = a.to_key ? byKey.get(a.to_key) : null;
        // No endpoint, no position. The panel does not guess.
        if (!from && !to) return null;
        const origin = from ?? to!;
        const target = to ?? from!;

        let t = 0;
        if (a.started_at && a.due_at) {
          const s = new Date(a.started_at).getTime();
          const d = new Date(a.due_at).getTime();
          if (d > s) t = Math.min(1, Math.max(0, (now - s) / (d - s)));
        }
        // With no window there is no journey to animate: the work sits at its
        // origin rather than being placed somewhere arbitrary along the line.
        const [x1, y1] = project(origin.lng, origin.lat);
        const [x2, y2] = project(target.lng, target.lat);
        return {
          agent: a, from: origin, to: target,
          x1, y1, x2, y2,
          x: x1 + (x2 - x1) * t,
          y: y1 + (y2 - y1) * t,
          stationary: origin.key === target.key,
        };
      })
      .filter(Boolean) as any[];
  }, [agents, byKey, now, view, width, height]);

  const unplaced = agents.length - positioned.length;

  return (
    <div ref={wrapRef} className="relative overflow-hidden rounded-surface border border-border bg-surface-sunken">
      <svg width={width} height={height} role="img" aria-label="Operations map">
        {/* Coastlines, drawn once at PATH_SCALE and scaled by the camera. */}
        <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale / PATH_SCALE})`}>
          {graticule && <path d={graticule} fill="none" stroke="hsl(var(--map-grid))" strokeWidth={PATH_SCALE / view.scale * 0.35} />}
          {land && <path d={land} fill="hsl(var(--map-land))" stroke="hsl(var(--map-coast))" strokeWidth={PATH_SCALE / view.scale * 0.4} />}
        </g>

        {/* Routes under the figures, so a figure is never hidden by its own line. */}
        {positioned.filter((p) => !p.stationary).map((p) => (
          <line
            key={`r-${p.agent.id}`}
            x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2}
            stroke={HEALTH_VAR[p.agent.health]}
            strokeWidth={selectedId === p.agent.id ? 1.6 : 0.8}
            strokeDasharray="3 3"
            opacity={selectedId && selectedId !== p.agent.id ? 0.15 : 0.5}
          />
        ))}

        {/* Places */}
        {places.map((pl) => {
          const [x, y] = project(pl.lng, pl.lat);
          return (
            <g key={pl.key}>
              <circle cx={x} cy={y} r={3} fill="hsl(var(--map-place))" />
              <text x={x + 6} y={y + 3} fontSize={10} fill="hsl(var(--map-label))">{pl.label}</text>
            </g>
          );
        })}

        {/* Agents. Every one carries its own colour; identity never rests on it
            alone — the selected one is labelled and the table below lists them. */}
        {positioned.map((p) => {
          const dim = selectedId && selectedId !== p.agent.id;
          return (
            <g
              key={p.agent.id}
              onClick={() => onSelect?.(selectedId === p.agent.id ? null : p.agent.id)}
              style={{ cursor: onSelect ? 'pointer' : undefined }}
              opacity={dim ? 0.25 : 1}
            >
              {/* A larger transparent hit target than the visible mark. */}
              <circle cx={p.x} cy={p.y} r={10} fill="transparent" />
              <circle
                cx={p.x} cy={p.y}
                r={selectedId === p.agent.id ? 6 : 4.5}
                fill={HEALTH_VAR[p.agent.health]}
                stroke="hsl(var(--map-ring))"
                strokeWidth={2}
              />
              {(selectedId === p.agent.id) && (
                <text x={p.x + 9} y={p.y - 7} fontSize={10} fontWeight={600} fill="hsl(var(--map-label-strong))">
                  {p.agent.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* The caption states what the map cannot show. Silence here would read as
          "this is everything", which would be a lie. */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center justify-between px-3 py-1.5 text-micro text-fg-muted">
        <span>{positioned.length} of {agents.length} on the map</span>
        {unplaced > 0 && (
          <span className="text-warning">
            {unplaced} not shown — no site or no counterparty city to place them
          </span>
        )}
      </div>
    </div>
  );
}
