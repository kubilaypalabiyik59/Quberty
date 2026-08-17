'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/erp/PageHeader';
import { OperationsMap } from '@/components/erp/OperationsMap';
import { AlertTriangle } from 'lucide-react';

/**
 * CEO dashboard — where the business actually is, without opening a report.
 *
 * ## The architecture, in one sentence
 *
 * The server sends **facts** (statuses and dates) and this file derives
 * everything time-dependent from a clock that ticks locally. Health is never
 * computed on the server: a colour computed there is stale the moment it is
 * sent, and an order that crosses its due date at 14:00 should turn amber at
 * 14:00, not at the next refresh.
 *
 *     progress = clamp((now − start) / (due − start), 0, 1)
 *
 * That is also what lets the refresh interval be a free parameter rather than a
 * design constraint.
 *
 * ## Rules that are not negotiable
 *
 *  - **Colour marks a situation, never a person.** No name appears on any tile
 *    here and none may be added. A panel that assigns blame gets gamed, and then
 *    the data behind it starts lying.
 *  - **No time window means no colour claim.** Work with no promised date is
 *    grey, labelled "no date", and counted separately — never green. Painting it
 *    green would be the panel asserting something it cannot know, and this
 *    tenant currently has no promised dates at all, so that distinction is the
 *    difference between an honest screen and a fictional one.
 *  - **Status colour is never a series colour**, and never the only signal: each
 *    band carries its label and count in text.
 */

type Health = 'ok' | 'warn' | 'late' | 'unknown';

const AMBER_AT = 0.8;
const RED_AT = 1.0;

function healthOf(now: number, start: string | null, due: string | null): Health {
  if (!start || !due) return 'unknown';
  const s = new Date(start).getTime();
  const d = new Date(due).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(d) || d <= s) return 'unknown';
  const r = (now - s) / (d - s);
  if (r >= RED_AT) return 'late';
  if (r >= AMBER_AT) return 'warn';
  return 'ok';
}

function daysLate(now: number, due: string | null): number | null {
  if (!due) return null;
  return Math.floor((now - new Date(due).getTime()) / 86_400_000);
}

const HEALTH_LABEL: Record<Health, string> = {
  ok: 'On track', warn: 'Due soon', late: 'Overdue', unknown: 'No date',
};
// Tokens, not raw colour. `unknown` is a neutral and must never drift to green.
const HEALTH_BG: Record<Health, string> = {
  ok: 'bg-success', warn: 'bg-warning', late: 'bg-danger', unknown: 'bg-fg-subtle/40',
};
const HEALTH_TEXT: Record<Health, string> = {
  ok: 'text-success', warn: 'text-warning', late: 'text-danger', unknown: 'text-fg-subtle',
};

const PROCESS_TITLE: Record<string, string> = {
  'order-to-cash': 'Order to Cash',
  'source-to-pay': 'Source to Pay',
};
const PROCESS_SUB: Record<string, string> = {
  'order-to-cash': 'From order to money in',
  'source-to-pay': 'From need to supplier paid',
};

export default function CeoDashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['ceo-dashboard'],
    queryFn: () => api.get('/reports/ceo-dashboard').then((r) => r.data.data),
    // "Live" for a CEO is minutes, not seconds. Operations do not move faster
    // than this, and the clock below keeps colour current in between.
    refetchInterval: 15 * 60 * 1000,
  });

  const [selected, setSelected] = useState<string | null>(null);

  // The virtual clock. Ticks independently of the data so colour stays live
  // between refreshes — the whole point of sending facts rather than colours.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const agents = data?.agents ?? [];

  const withHealth = useMemo(
    () => agents.map((a: any) => ({ ...a, health: healthOf(now, a.started_at, a.due_at) as Health })),
    [agents, now],
  );

  const selectedAgent = useMemo(
    () => withHealth.find((a: any) => a.id === selected) ?? null,
    [withHealth, selected],
  );

  const worst = useMemo(() => {
    const late = withHealth
      .filter((a: any) => a.health === 'late')
      .map((a: any) => ({ ...a, late_by: daysLate(now, a.due_at) ?? 0 }))
      .sort((a: any, b: any) => b.late_by - a.late_by);
    return late;
  }, [withHealth, now]);

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader title="CEO dashboard" />
        <p className="text-body text-danger">Could not load the panel.</p>
      </div>
    );
  }

  const cov = data?.coverage;

  return (
    <div className="space-y-5">
      <PageHeader
        title="CEO dashboard"
        subtitle="Where the work is, and what is stuck — read at a glance, no report to open"
        actions={
          data && (
            <span className="text-micro uppercase tracking-wide text-fg-subtle">
              read {new Date(data.read_at).toLocaleTimeString()}
            </span>
          )
        }
      />

      {/* Honesty banner. What the panel cannot tell you, stated up front rather
          than hidden behind confident-looking green. */}
      {cov && cov.o2c_without_due_date > 0 && (
        <div className="flex items-start gap-2 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-caption">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>{cov.o2c_without_due_date} of {cov.o2c_total}</strong> open sales orders carry no promised
            delivery date, so this panel cannot say whether they are late — they show as <em>no date</em>, not as
            on track.
            {cov.o2c_without_site > 0 && (
              <> <strong>{cov.o2c_without_site}</strong> also carry no warehouse, so they appear under
              “no site” below.</>
            )}
          </span>
        </div>
      )}

      {isLoading ? (
        <p className="text-caption text-fg-muted">Loading…</p>
      ) : (
        <>
          {/* ── Floor 1: process cards ────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(data?.processes ?? []).map((p: any) => {
              const mine = withHealth.filter((a: any) => a.process === p.key);
              const counts: Record<Health, number> = {
                ok: mine.filter((a: any) => a.health === 'ok').length,
                warn: mine.filter((a: any) => a.health === 'warn').length,
                late: mine.filter((a: any) => a.health === 'late').length,
                unknown: mine.filter((a: any) => a.health === 'unknown').length,
              };
              const worstHere = worst.find((a: any) => a.process === p.key);
              return (
                <section key={p.key} className="rounded-surface border border-border bg-surface p-4">
                  <header className="flex items-start justify-between">
                    <div>
                      <h2 className="text-body font-semibold text-fg">{PROCESS_TITLE[p.key] ?? p.key}</h2>
                      <p className="text-caption text-fg-muted">{PROCESS_SUB[p.key]}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-display font-semibold tabular-nums text-fg">{p.agents}</div>
                      <div className="text-micro uppercase tracking-wide text-fg-subtle">in flight</div>
                    </div>
                  </header>

                  <HealthBar counts={counts} total={mine.length} />

                  {/* Station strip — where the work is sitting right now.
                      Mirrors D365's Document Status sequence. */}
                  <div className="mt-4 grid grid-cols-5 gap-1.5">
                    {p.stops.map((stop: string, i: number) => (
                      <div key={stop} className="rounded-control border border-border bg-surface-sunken px-2 py-1.5 text-center">
                        <div className="text-micro uppercase tracking-wide text-fg-subtle">{stop}</div>
                        <div className={`text-body font-semibold tabular-nums ${p.by_stop[i] ? 'text-fg' : 'text-fg-subtle'}`}>
                          {p.by_stop[i]}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
                    <span className="text-caption text-fg-muted">Value in flight</span>
                    <span className="text-body font-semibold tabular-nums text-fg">
                      Bs. {Math.round(p.value).toLocaleString()}
                    </span>
                  </div>

                  {worstHere && (
                    <p className="mt-2 text-caption text-danger">
                      Worst: <span className="font-mono">{worstHere.label}</span> · {worstHere.late_by} day
                      {worstHere.late_by === 1 ? '' : 's'} overdue
                    </p>
                  )}
                </section>
              );
            })}
          </div>

          {/* ── Floor 2: the map ──────────────────────────────────────── */}
          <section>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-body font-semibold text-fg">Where the work is</h2>
              <div className="flex items-center gap-3 text-micro">
                {(['late', 'warn', 'ok', 'unknown'] as Health[]).map((h) => (
                  <span key={h} className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: `hsl(var(--map-${h}))` }}
                    />
                    <span className="text-fg-muted">{HEALTH_LABEL[h]}</span>
                  </span>
                ))}
              </div>
            </div>
            <OperationsMap
              places={data?.places ?? []}
              agents={withHealth}
              selectedId={selected}
              onSelect={setSelected}
              height={440}
            />
            {(data?.map_coverage?.unresolved_places?.length ?? 0) > 0 && (
              <p className="mt-2 text-micro text-fg-muted">
                Could not place: {data.map_coverage.unresolved_places.join(' · ')} — usually a country
                name sitting in the country <em>code</em> column, or a missing city. Fix the record and it
                appears here.
              </p>
            )}
            {selectedAgent && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-control border border-border bg-surface px-3 py-2 text-caption">
                <span className="font-mono text-fg">{selectedAgent.label}</span>
                <span className="text-fg-muted">{PROCESS_TITLE[selectedAgent.process]}</span>
                <span className="text-fg-muted">{selectedAgent.status}</span>
                <span className={HEALTH_TEXT[selectedAgent.health as Health]}>
                  {HEALTH_LABEL[selectedAgent.health as Health]}
                </span>
                {selectedAgent.party && <span className="text-fg-muted">{selectedAgent.party}</span>}
                <span className="ml-auto tabular-nums text-fg">
                  Bs. {Math.round(selectedAgent.amount).toLocaleString()}
                </span>
              </div>
            )}
          </section>

          {/* ── Needs attention ───────────────────────────────────────── */}
          <section className="rounded-surface border border-border bg-surface">
            <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h2 className="text-body font-semibold text-fg">Needs attention</h2>
              <span className="text-micro uppercase tracking-wide text-fg-subtle">
                situations, not people
              </span>
            </header>
            {worst.length === 0 ? (
              <p className="px-4 py-6 text-center text-caption text-fg-muted">
                Nothing is measurably overdue. With {cov?.o2c_without_due_date ?? 0} orders carrying no promised
                date, that is not the same as “nothing is late”.
              </p>
            ) : (
              <table className="w-full text-caption">
                <thead>
                  <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-fg-subtle">
                    <th className="px-4 py-2 font-medium">Document</th>
                    <th className="px-4 py-2 font-medium">Process</th>
                    <th className="px-4 py-2 font-medium">Stage</th>
                    <th className="px-4 py-2 font-medium">Where</th>
                    <th className="px-4 py-2 text-right font-medium">Overdue</th>
                    <th className="px-4 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {worst.slice(0, 12).map((a: any) => (
                    <tr key={a.id} className="h-row border-b border-border">
                      <td className="px-4 py-2 font-mono text-fg">{a.label}</td>
                      <td className="px-4 py-2 text-fg-muted">{PROCESS_TITLE[a.process]}</td>
                      <td className="px-4 py-2 text-fg-muted">{a.status}</td>
                      <td className="px-4 py-2 text-fg-muted">{a.site_name ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-danger">{a.late_by}d</td>
                      <td className="px-4 py-2 text-right tabular-nums text-fg">
                        Bs. {Math.round(a.amount).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* ── Geography ─────────────────────────────────────────────── */}
          <section className="rounded-surface border border-border bg-surface">
            <header className="border-b border-border px-4 py-2.5">
              <h2 className="text-body font-semibold text-fg">Open value by site</h2>
            </header>
            <table className="w-full text-caption">
              <tbody>
                {(data?.by_site ?? []).map((s: any) => {
                  const max = Math.max(...(data.by_site ?? []).map((x: any) => x.revenue), 1);
                  const unattributed = s.site === '(no site)';
                  return (
                    <tr key={s.site} className="border-b border-border">
                      <td className="w-48 px-4 py-2">
                        <div className={unattributed ? 'text-fg-subtle italic' : 'text-fg'}>{s.site}</div>
                        {s.city && <div className="text-micro text-fg-subtle">{s.city}</div>}
                      </td>
                      <td className="px-4 py-2">
                        <div className="h-2 w-full rounded-full bg-surface-sunken">
                          <div
                            className={`h-2 rounded-full ${unattributed ? 'bg-fg-subtle/40' : 'bg-series-1'}`}
                            style={{ width: `${(s.revenue / max) * 100}%` }}
                          />
                        </div>
                      </td>
                      <td className="w-32 px-4 py-2 text-right tabular-nums text-fg">
                        Bs. {Math.round(s.revenue).toLocaleString()}
                      </td>
                      <td className="w-20 px-4 py-2 text-right tabular-nums text-fg-muted">{s.orders}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * The traffic light as a stacked bar.
 *
 * Every band is labelled with its name and count, so identity never rests on
 * colour alone — required for a colour-blind reader and for print. A 2px surface
 * gap separates adjacent fills.
 */
function HealthBar({ counts, total }: { counts: Record<Health, number>; total: number }) {
  const order: Health[] = ['late', 'warn', 'ok', 'unknown'];
  return (
    <div className="mt-3">
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-sunken">
        {order.map((h) =>
          counts[h] > 0 ? (
            <div
              key={h}
              className={HEALTH_BG[h]}
              style={{ width: `${(counts[h] / Math.max(total, 1)) * 100}%` }}
              title={`${HEALTH_LABEL[h]}: ${counts[h]}`}
            />
          ) : null,
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {order.map((h) => (
          <span key={h} className="inline-flex items-center gap-1.5 text-micro">
            <span className={`h-2 w-2 rounded-full ${HEALTH_BG[h]}`} />
            <span className={HEALTH_TEXT[h]}>{HEALTH_LABEL[h]}</span>
            <span className="tabular-nums text-fg-muted">{counts[h]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
