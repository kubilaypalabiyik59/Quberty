'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AlertTriangle, CheckCircle2, ArrowRight, Wand2 } from 'lucide-react';
import { PageHeader, ErrorNote } from '@/components/erp/PageHeader';

/**
 * The Setup hub.
 *
 * ── Why this page exists ───────────────────────────────────────────────────
 * Everything the ERP needs configured was reachable only by running scripts from
 * the repository. That made every new store an errand for whoever wrote the
 * migration — the opposite of a product. This page is the entry point for
 * configuring the system without a developer.
 *
 * ── Why it reports facts and not a score ───────────────────────────────────
 * "3 of 8 products have no item group" tells somebody what to do. "Products 62%
 * configured" does not. Every row is a count with what it should be, and the only
 * judgement the page makes is whether a module BLOCKS trading — which is a real
 * distinction, not a severity guess: no posting profile means documents refuse to
 * post, while no location directive simply means you cannot do directed putaway.
 */
export default function SetupHubPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['setup-readiness'],
    queryFn: () => api.get('/setup/readiness').then((r) => r.data.data),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Setup"
        subtitle="Everything this system needs configured, and what is still missing"
      />

      <ErrorNote message={error ? 'Could not load setup status.' : ''} />

      <Link
        href="/setup/wizard"
        className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4 hover:border-accent"
      >
        <Wand2 className="h-5 w-5 text-accent" />
        <div className="flex-1">
          <div className="text-body font-medium text-fg">New company wizard</div>
          <div className="text-caption text-fg-muted">
            Country, chart of accounts and a first warehouse, in one pass. Start here for a brand-new tenant.
          </div>
        </div>
        <ArrowRight className="h-4 w-4 text-fg-muted" />
      </Link>

      {isLoading && <div className="text-caption text-fg-muted">Loading…</div>}

      {data && (
        <>
          {!data.ready && (
            <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="text-caption text-fg">
                Some modules are not configured enough to trade. Those are marked below — the rest are
                optional refinements.
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {data.modules.map((m: any) => (
              <Link
                key={m.key}
                href={m.href}
                className={`block rounded-lg border bg-surface p-4 transition hover:border-accent ${
                  m.blocking ? 'border-danger/50' : 'border-border'
                }`}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-body font-medium text-fg">{m.label}</span>
                  {m.blocking ? (
                    <span className="flex items-center gap-1 text-caption text-danger">
                      <AlertTriangle className="h-3.5 w-3.5" /> blocks trading
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-caption text-success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> ready
                    </span>
                  )}
                </div>

                <dl className="space-y-1.5">
                  {m.facts.map((f: any) => (
                    <div key={f.label} className="flex items-baseline justify-between gap-3">
                      <dt className="text-caption text-fg-muted">{f.label}</dt>
                      <dd className="flex items-baseline gap-2 font-mono text-caption text-fg">
                        <span>{String(f.value)}</span>
                        <span className="text-fg-subtle">want {f.want}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
