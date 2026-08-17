'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, AlertTriangle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows, ErrorNote } from '@/components/erp/PageHeader';

/**
 * Financial dimensions — the ledger's extra axes.
 *
 * A dimension answers "revenue, but whose?". Store is the obvious one for a
 * multi-store retailer: without it a P&L by store cannot be produced at all — not
 * slowly, not approximately, because the data is not on the journal line.
 *
 * Two rules this screen enforces rather than explains away:
 *
 * · **Slot and source are immutable.** Moving an axis between slots would silently
 *   re-interpret every voucher already coded against it. The API refuses it.
 * · **Making an axis REQUIRED can refuse a posting.** So the screen asks the server
 *   what it would cost first, and shows the documents that would be blocked — by
 *   name — before anybody flips it.
 */
export default function FinanceDimensionsPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [valuesFor, setValuesFor] = useState<any | null>(null);
  const [error, setError] = useState('');

  const dims = useQuery({
    queryKey: ['dimensions'],
    queryFn: () => api.get('/setup/dimensions').then((r) => r.data.data ?? []),
  });
  const meta = useQuery({
    queryKey: ['dimensions-meta'],
    queryFn: () => api.get('/setup/dimensions/meta').then((r) => r.data.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['dimensions'] });
    qc.invalidateQueries({ queryKey: ['setup-readiness'] });
    setError('');
  };

  const setRule = useMutation({
    mutationFn: ({ id, category, requirement }: any) =>
      api.put(`/setup/dimensions/${id}/rules`, { account_category: category, requirement }),
    onSuccess: refresh,
    onError: (e) => setError(apiErrorMessage(e, 'Could not change the rule.')),
  });

  // The two categories that decide whether a P&L by anything is possible. The API
  // accepts any category; these are the ones worth putting on the screen.
  const KEY_CATEGORIES = ['REVENUE', 'COGS'];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financial dimensions"
        subtitle="The axes every journal line is coded against — store, department, cost centre"
      />
      <ErrorNote message={error || (dims.error ? 'Could not load dimensions.' : '')} />

      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New dimension
        </Button>
      </div>

      {dims.isLoading && <div className="text-caption text-fg-muted">Loading…</div>}

      {dims.data?.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-body text-fg">No dimensions yet.</p>
          <p className="mt-1 text-caption text-fg-muted">
            Add a STORE axis taking its values from Site to get a profit and loss per shop.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {dims.data?.map((d: any) => (
          <section key={d.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-body font-medium text-fg">
                  <span className="font-mono">{d.code}</span> — {d.name}
                  {!d.is_active && <span className="text-caption text-fg-muted">(inactive)</span>}
                </h2>
                <p className="flex items-center gap-1.5 text-caption text-fg-muted">
                  <Lock className="h-3 w-3" />
                  slot {d.slot} · values from {d.value_source} · {d._count.values} value(s)
                </p>
              </div>
              {d.value_source === 'CUSTOM' && (
                <Button size="sm" variant="secondary" onClick={() => setValuesFor(d)}>
                  <Plus className="h-4 w-4" /> Value
                </Button>
              )}
            </div>

            {d.value_source !== 'CUSTOM' && (
              <p className="mb-3 text-caption text-fg-muted">
                Values appear automatically the first time each {d.value_source.toLowerCase().replace('_', ' ')} is
                used on a posting, and are renamed on that record — not here.
              </p>
            )}

            {d.values.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {d.values.map((v: any) => (
                  <span key={v.id} className="rounded-control border border-border px-2 py-0.5 font-mono text-caption text-fg">
                    {v.code}
                  </span>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-3">
              <div className="mb-2 text-micro font-semibold uppercase tracking-wide text-fg-muted">
                Required on
              </div>
              <div className="flex flex-wrap gap-4">
                {KEY_CATEGORIES.map((cat) => {
                  const rule = d.rules.find((r: any) => r.account_category === cat);
                  const required = rule?.requirement === 'REQUIRED';
                  return (
                    <label key={cat} className="flex items-center gap-2 text-caption">
                      <input
                        type="checkbox" checked={required}
                        onChange={(e) => setRule.mutate({
                          id: d.id, category: cat,
                          requirement: e.target.checked ? 'REQUIRED' : 'OPTIONAL',
                        })}
                      />
                      <span className="text-fg">{cat}</span>
                    </label>
                  );
                })}
              </div>
              <ImpactNote dimensionId={d.id} />
            </div>
          </section>
        ))}
      </div>

      {creating && (
        <NewDimensionDialog
          meta={meta.data}
          taken={(dims.data ?? []).map((d: any) => d.slot)}
          onClose={() => setCreating(false)}
          onSaved={refresh}
        />
      )}
      {valuesFor && (
        <NewValueDialog dimension={valuesFor} onClose={() => setValuesFor(null)} onSaved={refresh} />
      )}
    </div>
  );
}

/**
 * What making this required would refuse, in documents, by name.
 *
 * This exists because that question was real and could only be answered by writing
 * a one-off script against the database. Nobody should learn the answer by breaking
 * invoicing.
 */
function ImpactNote({ dimensionId }: { dimensionId: string }) {
  const { data } = useQuery({
    queryKey: ['dimension-impact', dimensionId],
    queryFn: () => api.get(`/setup/dimensions/${dimensionId}/impact`).then((r) => r.data.data),
  });

  if (!data?.supported || data.blocked_count === 0) return null;

  return (
    <div className="mt-3 flex items-start gap-2 rounded-control border border-warning/40 bg-warning/10 p-2.5">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <div className="text-caption text-fg">
        <p>{data.note}</p>
        <p className="mt-1 font-mono text-micro text-fg-muted">
          {data.blocked_orders.slice(0, 14).map((o: any) => o.order_number).join(' · ')}
          {data.blocked_count > 14 && ` … +${data.blocked_count - 14}`}
        </p>
      </div>
    </div>
  );
}

function NewDimensionDialog({
  meta, taken, onClose, onSaved,
}: { meta: any; taken: number[]; onClose: () => void; onSaved: () => void }) {
  const free = [1, 2, 3, 4].filter((s) => !taken.includes(s));
  const [f, setF] = useState({ code: '', name: '', slot: String(free[0] ?? ''), value_source: 'SITE' });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => api.post('/setup/dimensions', { ...f, slot: Number(f.slot) }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create the dimension.')),
  });

  const blockedReason = !free.length
    ? 'All four slots are occupied. A fifth needs a migration — one nullable column.'
    : !f.code ? 'A code is required.'
    : !f.name ? 'A name is required.'
    : !f.slot ? 'Choose a slot.'
    : null;

  return (
    <Dialog
      title="New financial dimension"
      description="An axis every journal line can be coded against. The slot and source cannot be changed later."
      onClose={onClose} error={error} blockedReason={blockedReason}
      submitLabel="Create dimension" submitting={create.isPending} onSubmit={() => create.mutate()}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">Code *
          <input className={dialogField} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="STORE" />
        </label>
        <label className="text-caption text-fg-muted">Name *
          <input className={dialogField} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Store" />
        </label>
        <label className="text-caption text-fg-muted">Slot *
          <select className={dialogField} value={f.slot} onChange={(e) => setF({ ...f, slot: e.target.value })}>
            {free.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-caption text-fg-muted">Values from *
          <select className={dialogField} value={f.value_source} onChange={(e) => setF({ ...f, value_source: e.target.value })}>
            {(meta?.value_sources ?? ['CUSTOM', 'SITE', 'WAREHOUSE', 'OPERATING_UNIT', 'EMPLOYEE', 'PRODUCT_CATEGORY']).map((v: string) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-3 text-micro text-fg-subtle">
        <strong>SITE</strong> gives a profit and loss per shop. <strong>OPERATING_UNIT</strong> gives one
        per department. <strong>CUSTOM</strong> means you maintain the values by hand. The slot decides
        which column stores it, so it cannot move afterwards without changing what past vouchers mean.
      </p>
    </Dialog>
  );
}

function NewValueDialog({
  dimension, onClose, onSaved,
}: { dimension: any; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: '', name: '' });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => api.post(`/setup/dimensions/${dimension.id}/values`, f),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create the value.')),
  });

  const blockedReason = !f.code ? 'A code is required.'
    : f.code.length > 30 ? 'A dimension value code is limited to 30 characters.'
    : /\s/.test(f.code) ? 'A value code cannot contain spaces.'
    : !f.name ? 'A name is required.'
    : null;

  return (
    <Dialog
      title={`New value — ${dimension.code}`}
      onClose={onClose} error={error} blockedReason={blockedReason}
      submitLabel="Add value" submitting={create.isPending} onSubmit={() => create.mutate()}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">Code *
          <input className={dialogField} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={30} />
        </label>
        <label className="text-caption text-fg-muted">Name *
          <input className={dialogField} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
      </div>
    </Dialog>
  );
}
