'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';
import { PageHeader, ErrorNote } from '@/components/erp/PageHeader';

/**
 * Warehouse setup — putaway behaviour and location directives, per warehouse.
 *
 * **[OFFICIAL]** D365 sets warehouse behaviour on the individual warehouse, which
 * is also what a multi-store retailer needs: "receive it and it is sellable" in the
 * shops and directed putaway in the distribution centre, at the same time.
 *
 * The two switches here can make stock unsellable if they are turned on before the
 * warehouse can support them, so the page shows the cost BEFORE the switch is
 * flipped and the API refuses the impossible combinations outright — a warehouse
 * with no pick location cannot count only pick locations, and putaway with no
 * directive creates no work at all.
 */
export default function WarehouseSetupPage() {
  const qc = useQueryClient();
  const [directiveFor, setDirectiveFor] = useState<any | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['warehouse-parameters'],
    queryFn: () => api.get('/warehouse/parameters').then((r) => r.data.data ?? []),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['warehouse-parameters'] });
    qc.invalidateQueries({ queryKey: ['setup-readiness'] });
    setError('');
  };

  const save = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => api.put(`/warehouse/parameters/${id}`, body),
    onSuccess: refresh,
    onError: (e) => setError(apiErrorMessage(e, 'Could not save the parameters.')),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouse setup"
        subtitle="Putaway and availability, per warehouse — plus the directives that decide where goods go"
      />
      <ErrorNote message={error || (loadError ? 'Could not load warehouses.' : '')} />

      {isLoading && <div className="text-caption text-fg-muted">Loading…</div>}

      <div className="space-y-4">
        {data?.map((w: any) => {
          const p = w.parameters;
          const r = w.readiness;
          const putawayOn = p?.require_putaway ?? false;
          const pickOnly = (p?.availability_counts ?? 'ALL_LOCATIONS') === 'PICK_LOCATIONS_ONLY';
          const receiveLocations = w.zones.flatMap((z: any) => z.locations).filter((l: any) => l.is_receive_location);
          const putawayDirectives = w.location_directives.filter((d: any) => d.directive_type === 'PUTAWAY');

          return (
            <section key={w.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-body font-medium text-fg">
                    <span className="font-mono">{w.code}</span> — {w.name}
                  </h2>
                  <p className="text-caption text-fg-muted">
                    site {w.site?.code} · {r.pick_location_count} pick location(s) ·{' '}
                    {putawayDirectives.length} putaway directive(s)
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setDirectiveFor(w)}>
                  <Plus className="h-4 w-4" /> Directive
                </Button>
              </div>

              {/* The cost of switching on, before it is switched on. */}
              {!r.can_enable_putaway && (
                <div className="mb-3 flex items-start gap-2 rounded-control border border-warning/40 bg-warning/10 p-2.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                  <span className="text-caption text-fg">
                    {r.pick_location_count === 0
                      ? 'No pick location. Directed putaway has nowhere to put anything, and counting only pick locations would make ALL of this warehouse’s stock unsellable.'
                      : 'No putaway directive. Work would be created with no destination, so none is created at all.'}
                  </span>
                </div>
              )}
              {r.units_outside_pick_locations > 0 && (
                <div className="mb-3 rounded-control border border-border bg-canvas p-2.5 text-caption text-fg-muted">
                  <span className="font-mono text-fg">{r.units_outside_pick_locations}</span> unit(s) sit
                  outside a pick location. Switching availability to pick-only stops them counting as
                  sellable until they are put away — that is the point of the setting, not a side effect.
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox" className="mt-1" checked={putawayOn}
                    disabled={!r.can_enable_putaway && !putawayOn}
                    onChange={(e) => save.mutate({ id: w.id, body: { require_putaway: e.target.checked } })}
                  />
                  <span className="text-caption">
                    <span className="text-fg">Require putaway</span>
                    <span className="block text-fg-muted">
                      A receipt lands in the receiving location and warehouse work moves it to a shelf.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5">
                  <input
                    type="checkbox" className="mt-1" checked={pickOnly}
                    disabled={r.pick_location_count === 0 && !pickOnly}
                    onChange={(e) => save.mutate({
                      id: w.id,
                      body: { availability_counts: e.target.checked ? 'PICK_LOCATIONS_ONLY' : 'ALL_LOCATIONS' },
                    })}
                  />
                  <span className="text-caption">
                    <span className="text-fg">Only put-away stock is sellable</span>
                    <span className="block text-fg-muted">
                      Goods on the dock stop counting as available until they reach a pick location.
                    </span>
                  </span>
                </label>

                <label className="text-caption text-fg-muted">
                  Default receive location
                  <select
                    className={dialogField}
                    value={p?.default_receive_location_id ?? ''}
                    onChange={(e) => save.mutate({ id: w.id, body: { default_receive_location_id: e.target.value } })}
                  >
                    <option value="">— none —</option>
                    {receiveLocations.map((l: any) => (
                      <option key={l.id} value={l.id}>{l.code}</option>
                    ))}
                  </select>
                </label>

                <label className="flex items-start gap-2.5 opacity-60">
                  <input type="checkbox" className="mt-1" checked={p?.require_pick_work ?? false} disabled />
                  <span className="text-caption">
                    <span className="text-fg">Require pick work</span>
                    <span className="block text-fg-muted">
                      Declared, and nothing reads it yet — outbound work is a later phase. Shown rather
                      than hidden so nobody switches it on expecting an effect.
                    </span>
                  </span>
                </label>
              </div>

              {putawayDirectives.length > 0 && (
                <div className="mt-3 border-t border-border pt-3">
                  <div className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-fg-muted">
                    Putaway directives
                  </div>
                  {putawayDirectives.map((d: any) => (
                    <div key={d.id} className="flex items-center justify-between py-1 text-caption">
                      <span className="text-fg"><span className="font-mono">{d.code}</span> — {d.name}</span>
                      <span className="text-fg-muted">{d.work_type}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {directiveFor && (
        <NewDirectiveDialog warehouse={directiveFor} onClose={() => setDirectiveFor(null)} onSaved={refresh} />
      )}
    </div>
  );
}

/**
 * **[OFFICIAL]** for a purchase-order putaway Microsoft prescribes TWO actions in
 * sequence — Consolidate, then Empty location with no incoming work — and Put is
 * the only supported work type. The dialog creates both lines by default because
 * one alone leaves a real gap: consolidate-only fails for a product nothing has in
 * stock, and empty-only scatters the same product across the warehouse.
 */
function NewDirectiveDialog({
  warehouse, onClose, onSaved,
}: { warehouse: any; onClose: () => void; onSaved: () => void }) {
  const pickZones = warehouse.zones.filter((z: any) =>
    z.locations.some((l: any) => l.is_pick_location && l.is_active));

  const [f, setF] = useState({
    code: `PUTAWAY-${warehouse.code}`,
    name: `Putaway — ${warehouse.name}`,
    zone_id: pickZones[0]?.id ?? '',
    consolidate: true,
    empty: true,
  });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/warehouse/location-directives', {
        code: f.code, name: f.name, directive_type: 'PUTAWAY',
        warehouse_id: warehouse.id, work_type: 'PUT', sequence: 1,
      });
      const id = data.data.id;
      let seq = 1;
      if (f.consolidate) {
        await api.post(`/warehouse/location-directives/${id}/lines`, {
          sequence: seq++, strategy: 'CONSOLIDATE', zone_id: f.zone_id, from_qty: 0,
        });
      }
      if (f.empty) {
        await api.post(`/warehouse/location-directives/${id}/lines`, {
          sequence: seq++, strategy: 'EMPTY_LOCATION', zone_id: f.zone_id, from_qty: 0,
        });
      }
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create the directive.')),
  });

  const blockedReason = !pickZones.length
    ? 'This warehouse has no zone containing a pick location. Create one first.'
    : !f.code ? 'A code is required.'
    : !f.zone_id ? 'Choose the zone goods should be put away into.'
    : !f.consolidate && !f.empty ? 'Select at least one strategy, or the directive resolves nothing.'
    : null;

  return (
    <Dialog
      title={`Putaway directive — ${warehouse.code}`}
      description="Where received goods go. Evaluated in order until one resolves a location."
      onClose={onClose} error={error} blockedReason={blockedReason}
      submitLabel="Create directive" submitting={create.isPending} onSubmit={() => create.mutate()}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">Code *
          <input className={dialogField} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </label>
        <label className="text-caption text-fg-muted">Name
          <input className={dialogField} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label className="col-span-2 text-caption text-fg-muted">Put away into zone *
          <select className={dialogField} value={f.zone_id} onChange={(e) => setF({ ...f, zone_id: e.target.value })}>
            <option value="">— select —</option>
            {pickZones.map((z: any) => (
              <option key={z.id} value={z.id}>
                {z.code} — {z.name} ({z.locations.filter((l: any) => l.is_pick_location).length} pick locations)
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 space-y-2 rounded-control border border-border p-3">
        <div className="text-micro font-semibold uppercase tracking-wide text-fg-muted">Strategies, in order</div>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-1" checked={f.consolidate}
            onChange={(e) => setF({ ...f, consolidate: e.target.checked })} />
          <span className="text-caption">
            <span className="text-fg">1. Consolidate</span>
            <span className="block text-fg-muted">Put it where the same product already is.</span>
          </span>
        </label>
        <label className="flex items-start gap-2.5">
          <input type="checkbox" className="mt-1" checked={f.empty}
            onChange={(e) => setF({ ...f, empty: e.target.checked })} />
          <span className="text-caption">
            <span className="text-fg">2. Empty location with no incoming work</span>
            <span className="block text-fg-muted">
              Otherwise the first free location — one with no stock and nothing already on its way.
            </span>
          </span>
        </label>
      </div>

      <p className="mt-3 text-micro text-fg-subtle">
        Work type is Put — for a purchase-order directive that is the only supported value. If nothing
        resolves, no work is created and the goods stay on the dock, visibly not put away.
      </p>
    </Dialog>
  );
}
