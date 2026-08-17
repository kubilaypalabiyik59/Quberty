'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/erp/PageHeader';
import { Dialog } from '@/components/erp/Dialog';
import { MapPin, Layers, Star, AlertTriangle, Wand2, Plus } from 'lucide-react';

/**
 * Warehouse setup — sites, warehouses, zones and locations.
 *
 * Follows the order Microsoft documents, minus the master tables an SME does not
 * need. **[OFFICIAL]** the full D365 order is zone groups → zones → location
 * types → location formats → location profiles → locations
 * (learn.microsoft.com/dynamics365/supply-chain/warehousing/tasks/configure-locations-wms-enabled-warehouse).
 * We keep zones and locations, keep the naming rule, and skip the four master
 * tables — see locationFormat.service.ts for why, and for the schema hooks that
 * mean adding them later is not a data migration.
 *
 * The screen deliberately shows the things that make a MISCONFIGURATION visible,
 * not just the happy path: which warehouse sales default to, how many locations
 * each one really has, and whether stock is sitting somewhere nobody sells from.
 */

type Segment = { label: string; from: number; to: number; width: number; separator: string };

const DEFAULT_SEGMENTS: Segment[] = [
  { label: 'Aisle', from: 1, to: 2, width: 2, separator: '-' },
  { label: 'Rack', from: 1, to: 3, width: 2, separator: '-' },
  { label: 'Shelf', from: 1, to: 3, width: 2, separator: '' },
];

export default function WarehouseSetupPage() {
  const qc = useQueryClient();
  const [selectedWarehouse, setSelectedWarehouse] = useState<any>(null);
  const [selectedZone, setSelectedZone] = useState<any>(null);
  const [dialog, setDialog] = useState<null | 'warehouse' | 'zone' | 'location' | 'bulk'>(null);
  const [error, setError] = useState('');

  const { data: overview, isLoading } = useQuery({
    queryKey: ['warehouse-overview'],
    queryFn: () => api.get('/warehouse/overview').then((r) => r.data.data),
  });

  const { data: sites } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get('/warehouse/sites').then((r) => r.data.data),
  });

  const { data: zones } = useQuery({
    queryKey: ['zones', selectedWarehouse?.id],
    queryFn: () => api.get(`/warehouse/zones?warehouse_id=${selectedWarehouse.id}`).then((r) => r.data.data),
    enabled: !!selectedWarehouse,
  });

  const { data: locations } = useQuery({
    queryKey: ['locations', selectedZone?.id],
    queryFn: () => api.get(`/warehouse/locations?zone_id=${selectedZone.id}`).then((r) => r.data.data),
    enabled: !!selectedZone,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['warehouse-overview'] });
    qc.invalidateQueries({ queryKey: ['zones'] });
    qc.invalidateQueries({ queryKey: ['locations'] });
  };

  const close = () => { setDialog(null); setError(''); };
  const fail = (e: any) => setError(e?.response?.data?.error?.message ?? e?.message ?? 'Request failed');

  // ── forms ────────────────────────────────────────────────────────────────
  const [wForm, setWForm] = useState({
    code: '', name: '', type: 'standard',
    site_id: '', create_site: false, site_name: '', site_city: '', site_country: '',
  });
  const [zForm, setZForm] = useState({ code: '', name: '', zone_type: 'storage' });
  const [lForm, setLForm] = useState({
    code: '', aisle: '', rack: '', shelf: '', bin: '',
    location_type: 'bulk', is_pick_location: false, is_receive_location: false,
  });
  const [segments, setSegments] = useState<Segment[]>(DEFAULT_SEGMENTS);
  const [bulkOpts, setBulkOpts] = useState({ location_type: 'bulk', is_pick_location: true, is_receive_location: false });

  const createWarehouse = useMutation({
    mutationFn: () => api.post('/warehouse/warehouses', {
      code: wForm.code, name: wForm.name, type: wForm.type,
      ...(wForm.create_site
        ? { create_site: true, site_name: wForm.site_name, site_city: wForm.site_city, site_country: wForm.site_country }
        : { site_id: wForm.site_id }),
    }),
    onSuccess: () => { refresh(); close(); },
    onError: fail,
  });

  const createZone = useMutation({
    mutationFn: () => api.post('/warehouse/zones', { warehouse_id: selectedWarehouse.id, ...zForm }),
    onSuccess: () => { refresh(); close(); },
    onError: fail,
  });

  const createLocation = useMutation({
    mutationFn: () => api.post('/warehouse/locations', { zone_id: selectedZone.id, ...lForm }),
    onSuccess: () => { refresh(); close(); },
    onError: fail,
  });

  // The wizard previews before it writes. A range that looks small often is not.
  const preview = useMutation({
    mutationFn: () => api.post('/warehouse/locations/bulk', {
      zone_id: selectedZone.id, segments, ...bulkOpts, dry_run: true,
    }).then((r) => r.data.data),
    onError: fail,
  });

  const commitBulk = useMutation({
    mutationFn: () => api.post('/warehouse/locations/bulk', {
      zone_id: selectedZone.id, segments, ...bulkOpts, dry_run: false,
    }),
    onSuccess: () => { refresh(); close(); preview.reset(); },
    onError: fail,
  });

  // Mirrors the server rule so the reader sees the problem while typing rather
  // than after submitting. The server still enforces it — this is not the check.
  const nameLength = useMemo(
    () => segments.reduce((n, s) => n + s.width + s.separator.length, 0),
    [segments],
  );
  const estimatedCount = useMemo(
    () => segments.reduce((n, s) => n * Math.max(0, s.to - s.from + 1), 1),
    [segments],
  );

  const warehouses = overview?.warehouses ?? [];
  // Array.from rather than spreading the Set: this project's tsconfig target
  // predates downlevelIteration, so `[...set]` does not compile.
  const countries: string[] = Array.from(
    new Set<string>(warehouses.map((w: any) => w.site?.country).filter(Boolean)),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Warehouse setup"
        subtitle="Sites, warehouses, zones and locations — in the order they depend on each other"
        actions={
          <button
            onClick={() => { setDialog('warehouse'); setError(''); }}
            className="inline-flex items-center gap-1.5 rounded-control bg-accent px-3 py-1.5 text-caption font-medium text-accent-fg hover:bg-accent-hover"
          >
            <Plus className="h-3.5 w-3.5" /> New warehouse
          </button>
        }
      />

      {/* Configuration warnings — the reason this screen exists */}
      {overview && (
        <div className="space-y-2">
          {!overview.default_warehouse_id && (
            <Notice tone="danger">
              No default sales warehouse is set. Orders that do not name one cannot record where they ship from.
            </Notice>
          )}
          {countries.length > 1 && (
            <Notice tone="warning">
              Warehouses span {countries.length} countries ({countries.join(', ')}). Confirm which are real —
              a leftover from a template will still appear on reports and maps.
            </Notice>
          )}
          {warehouses.some((w: any) => w.on_hand > 0 && w.location_count === 0) && (
            <Notice tone="warning">
              A warehouse holds stock but has no locations defined. Stock with nowhere to sit cannot be picked.
            </Notice>
          )}
        </div>
      )}

      {/* ── Warehouses ─────────────────────────────────────────────────── */}
      <section className="rounded-surface border border-border bg-surface">
        <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-body font-semibold text-fg">Warehouses</h2>
          {overview?.warehouse_required && (
            <span className="text-micro uppercase tracking-wide text-fg-muted">warehouse mandatory on sales</span>
          )}
        </header>

        {isLoading ? (
          <p className="px-4 py-6 text-caption text-fg-muted">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-caption">
              <thead>
                <tr className="border-b border-border text-left text-micro uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-2 font-medium">Warehouse</th>
                  <th className="px-4 py-2 font-medium">Site</th>
                  <th className="px-4 py-2 font-medium">City</th>
                  <th className="px-4 py-2 text-right font-medium">Zones</th>
                  <th className="px-4 py-2 text-right font-medium">Locations</th>
                  <th className="px-4 py-2 text-right font-medium">On hand</th>
                  <th className="px-4 py-2 text-right font-medium">Docs</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w: any) => (
                  <tr
                    key={w.id}
                    onClick={() => { setSelectedWarehouse(w); setSelectedZone(null); }}
                    className={`h-row cursor-pointer border-b border-border transition-colors hover:bg-surface-sunken ${
                      selectedWarehouse?.id === w.id ? 'bg-accent-soft' : ''
                    }`}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-fg">{w.code}</span>
                        {w.is_default && (
                          <span className="inline-flex items-center gap-1 rounded-control bg-accent-soft px-1.5 py-0.5 text-micro font-medium text-accent-onSoft">
                            <Star className="h-3 w-3" /> sales default
                          </span>
                        )}
                      </div>
                      <div className="text-fg-muted">{w.name}</div>
                    </td>
                    <td className="px-4 py-2 text-fg-muted">{w.site?.name ?? '—'}</td>
                    <td className="px-4 py-2 text-fg-muted">
                      {w.site?.city ?? '—'}
                      {looksLikeACountry(w.site?.city, w.site?.country) && (
                        <span
                          className="ml-1 text-danger"
                          title="This looks like a country, not a city. Geocoding it would place the site at the country's centroid — plausible on a map, and wrong."
                        >
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg">{w.zone_count}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg">{w.location_count}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg">{w.on_hand}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-fg-muted">
                      {w.sales_orders + w.purchase_orders}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Zones + locations ──────────────────────────────────────────── */}
      {selectedWarehouse && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel
            title={`Zones — ${selectedWarehouse.name}`}
            icon={<Layers className="h-4 w-4" />}
            action={
              <button onClick={() => { setDialog('zone'); setError(''); }} className="text-caption text-accent hover:underline">
                Add zone
              </button>
            }
          >
            {(zones ?? []).length === 0 ? (
              <Empty>No zones yet. A location belongs to a zone, so start here.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {zones.map((z: any) => (
                  <li key={z.id}>
                    <button
                      onClick={() => setSelectedZone(z)}
                      className={`flex w-full items-center justify-between px-4 py-2 text-left text-caption transition-colors hover:bg-surface-sunken ${
                        selectedZone?.id === z.id ? 'bg-accent-soft' : ''
                      }`}
                    >
                      <span>
                        <span className="font-mono text-fg">{z.code}</span>
                        <span className="ml-2 text-fg-muted">{z.name}</span>
                      </span>
                      <span className="tabular-nums text-fg-subtle">{z._count?.locations ?? 0} loc</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title={selectedZone ? `Locations — ${selectedZone.name}` : 'Locations'}
            icon={<MapPin className="h-4 w-4" />}
            action={
              selectedZone && (
                <div className="flex items-center gap-3">
                  <button onClick={() => { setDialog('bulk'); setError(''); preview.reset(); }} className="inline-flex items-center gap-1 text-caption text-accent hover:underline">
                    <Wand2 className="h-3.5 w-3.5" /> Generate
                  </button>
                  <button onClick={() => { setDialog('location'); setError(''); }} className="text-caption text-accent hover:underline">
                    Add one
                  </button>
                </div>
              )
            }
          >
            {!selectedZone ? (
              <Empty>Pick a zone to see its locations.</Empty>
            ) : (locations ?? []).length === 0 ? (
              <Empty>No locations in this zone. Use Generate for a range, or add one by hand.</Empty>
            ) : (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-caption">
                  <tbody>
                    {locations.map((l: any) => (
                      <tr key={l.id} className="border-b border-border">
                        <td className="px-4 py-1.5 font-mono text-fg">{l.code}</td>
                        <td className="px-4 py-1.5 text-fg-muted">{l.location_type}</td>
                        <td className="px-4 py-1.5 text-right text-micro text-fg-subtle">
                          {l.is_pick_location && <span className="mr-2">pick</span>}
                          {l.is_receive_location && <span>receive</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      )}

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      {dialog === 'warehouse' && (
        <Dialog
          title="New warehouse"
          description="A warehouse belongs to a site. Site is the operational unit above it — several warehouses can share one."
          onClose={close}
          error={error}
          blockedReason={
            !wForm.code || !wForm.name
              ? 'Code and name are required'
              : wForm.create_site
                ? (!wForm.site_name || !wForm.site_city || !wForm.site_country ? 'New site needs a name, city and country' : null)
                : (!wForm.site_id ? 'Choose a site, or tick "create a new site"' : null)
          }
          submitLabel="Create warehouse"
          submitting={createWarehouse.isPending}
          onSubmit={() => createWarehouse.mutate()}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code"><input className={inputCls} value={wForm.code} onChange={(e) => setWForm({ ...wForm, code: e.target.value })} /></Field>
            <Field label="Name"><input className={inputCls} value={wForm.name} onChange={(e) => setWForm({ ...wForm, name: e.target.value })} /></Field>
          </div>

          <label className="mt-3 flex items-center gap-2 text-caption text-fg">
            <input type="checkbox" checked={wForm.create_site} onChange={(e) => setWForm({ ...wForm, create_site: e.target.checked })} />
            Create a new site for it
          </label>

          {wForm.create_site ? (
            <div className="mt-2 grid grid-cols-3 gap-3">
              <Field label="Site name"><input className={inputCls} value={wForm.site_name} onChange={(e) => setWForm({ ...wForm, site_name: e.target.value })} /></Field>
              <Field label="City"><input className={inputCls} value={wForm.site_city} onChange={(e) => setWForm({ ...wForm, site_city: e.target.value })} /></Field>
              <Field label="Country"><input className={inputCls} placeholder="BO" value={wForm.site_country} onChange={(e) => setWForm({ ...wForm, site_country: e.target.value })} /></Field>
            </div>
          ) : (
            <Field label="Site" className="mt-2">
              <select className={inputCls} value={wForm.site_id} onChange={(e) => setWForm({ ...wForm, site_id: e.target.value })}>
                <option value="">Choose…</option>
                {(sites ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name} ({s.city})</option>
                ))}
              </select>
            </Field>
          )}
          <p className="mt-2 text-micro text-fg-subtle">
            No city or country is defaulted here on purpose — a hardcoded city is wrong in every country but one.
          </p>
        </Dialog>
      )}

      {dialog === 'zone' && (
        <Dialog
          title={`New zone in ${selectedWarehouse?.name}`}
          description="A zone is a logical grouping of locations — receiving, bulk, picking, dispatch."
          onClose={close}
          error={error}
          blockedReason={!zForm.code || !zForm.name ? 'Code and name are required' : null}
          submitLabel="Create zone"
          submitting={createZone.isPending}
          onSubmit={() => createZone.mutate()}
        >
          <div className="grid grid-cols-3 gap-3">
            <Field label="Code"><input className={inputCls} value={zForm.code} onChange={(e) => setZForm({ ...zForm, code: e.target.value })} /></Field>
            <Field label="Name"><input className={inputCls} value={zForm.name} onChange={(e) => setZForm({ ...zForm, name: e.target.value })} /></Field>
            <Field label="Type">
              <select className={inputCls} value={zForm.zone_type} onChange={(e) => setZForm({ ...zForm, zone_type: e.target.value })}>
                {['storage', 'receiving', 'picking', 'dispatch', 'staging'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
        </Dialog>
      )}

      {dialog === 'location' && (
        <Dialog
          title={`New location in ${selectedZone?.name}`}
          onClose={close}
          error={error}
          blockedReason={!lForm.code ? 'A code is required' : null}
          submitLabel="Create location"
          submitting={createLocation.isPending}
          onSubmit={() => createLocation.mutate()}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Code"><input className={inputCls} value={lForm.code} onChange={(e) => setLForm({ ...lForm, code: e.target.value })} /></Field>
            <Field label="Type">
              <select className={inputCls} value={lForm.location_type} onChange={(e) => setLForm({ ...lForm, location_type: e.target.value })}>
                {['bulk', 'pick', 'receive', 'staging', 'dispatch'].map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-3">
            {(['aisle', 'rack', 'shelf', 'bin'] as const).map((k) => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                <input className={inputCls} value={(lForm as any)[k]} onChange={(e) => setLForm({ ...lForm, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-caption text-fg">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={lForm.is_pick_location} onChange={(e) => setLForm({ ...lForm, is_pick_location: e.target.checked })} /> Pick location
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={lForm.is_receive_location} onChange={(e) => setLForm({ ...lForm, is_receive_location: e.target.checked })} /> Receive location
            </label>
          </div>
        </Dialog>
      )}

      {dialog === 'bulk' && (
        <Dialog
          title={`Generate locations in ${selectedZone?.name}`}
          description="The equivalent of D365's Location setup wizard. Names are built from segments, and the total length is capped at 10 characters so a label stays scannable."
          onClose={() => { close(); preview.reset(); }}
          error={error}
          width="max-w-2xl"
          blockedReason={
            nameLength > 10 ? `This format makes ${nameLength}-character names — over the 10-character ceiling` :
            estimatedCount > 2000 ? `${estimatedCount.toLocaleString()} locations is over the 2,000 limit for one run` :
            !preview.data ? 'Preview it first' : null
          }
          submitLabel={preview.data ? `Create ${preview.data.will_create} location(s)` : 'Create'}
          submitting={commitBulk.isPending}
          onSubmit={() => commitBulk.mutate()}
        >
          <div className="space-y-2">
            {segments.map((s, i) => (
              <div key={i} className="grid grid-cols-5 items-end gap-2">
                <Field label="Segment">
                  <input className={inputCls} value={s.label}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                </Field>
                <Field label="From">
                  <input type="number" className={inputCls} value={s.from}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, from: Number(e.target.value) } : x))} />
                </Field>
                <Field label="To">
                  <input type="number" className={inputCls} value={s.to}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, to: Number(e.target.value) } : x))} />
                </Field>
                <Field label="Width">
                  <input type="number" min={1} max={4} className={inputCls} value={s.width}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, width: Number(e.target.value) } : x))} />
                </Field>
                <Field label="Separator">
                  <input maxLength={1} className={inputCls} value={s.separator}
                    onChange={(e) => setSegments(segments.map((x, j) => j === i ? { ...x, separator: e.target.value } : x))} />
                </Field>
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between text-caption">
            <div className="flex gap-3">
              <button
                onClick={() => setSegments([...segments, { label: 'Bin', from: 1, to: 2, width: 2, separator: '' }])}
                className="text-accent hover:underline"
                disabled={segments.length >= 4}
              >
                Add segment
              </button>
              {segments.length > 1 && (
                <button onClick={() => setSegments(segments.slice(0, -1))} className="text-fg-muted hover:underline">
                  Remove last
                </button>
              )}
            </div>
            <span className={nameLength > 10 ? 'text-danger' : 'text-fg-muted'}>
              name length {nameLength}/10 · ~{estimatedCount.toLocaleString()} locations
            </span>
          </div>

          <div className="mt-3 flex gap-4 text-caption text-fg">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={bulkOpts.is_pick_location}
                onChange={(e) => setBulkOpts({ ...bulkOpts, is_pick_location: e.target.checked })} /> Pick locations
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={bulkOpts.is_receive_location}
                onChange={(e) => setBulkOpts({ ...bulkOpts, is_receive_location: e.target.checked })} /> Receive locations
            </label>
          </div>

          <button
            onClick={() => preview.mutate()}
            disabled={preview.isPending || nameLength > 10}
            className="mt-3 rounded-control border border-border px-3 py-1.5 text-caption text-fg hover:bg-surface-sunken disabled:opacity-50"
          >
            {preview.isPending ? 'Previewing…' : 'Preview'}
          </button>

          {preview.data && (
            <div className="mt-3 rounded-control border border-border bg-surface-sunken p-3 text-caption">
              <p className="text-fg">
                <strong className="tabular-nums">{preview.data.will_create}</strong> to create
                {preview.data.already_exist > 0 && (
                  <span className="text-fg-muted"> · {preview.data.already_exist} already exist and will be skipped</span>
                )}
              </p>
              <p className="mt-1 font-mono text-fg-muted">{preview.data.sample.join('  ')}{preview.data.total > 5 ? '  …' : ''}</p>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

// ── small pieces ───────────────────────────────────────────────────────────

/**
 * Is the "city" actually the country?
 *
 * The anchor tenant has a site with `city = 'Bolivia'` and `country = 'BO'`.
 * Geocoding that puts the store at the centroid of Bolivia — roughly 400 km from
 * Santa Cruz — and the resulting map looks entirely plausible, which is worse
 * than one that looks broken.
 *
 * `Intl.DisplayNames` resolves the ISO code to a name, so there is no country
 * lookup table to maintain and it works for every jurisdiction we might sell
 * into rather than the handful someone remembered to list.
 */
function looksLikeACountry(city?: string | null, country?: string | null): boolean {
  if (!city || !country) return false;
  const c = city.trim().toLowerCase();
  if (c === country.trim().toLowerCase()) return true;
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'region' }).of(country.toUpperCase());
    return !!name && name.toLowerCase() === c;
  } catch {
    return false;
  }
}

const inputCls =
  'w-full rounded-control border border-border bg-surface px-2 py-1.5 text-caption text-fg focus:outline-none focus:ring-2 focus:ring-ring';

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-micro uppercase tracking-wide text-fg-subtle">{label}</span>
      {children}
    </label>
  );
}

function Panel({ title, icon, action, children }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-surface border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-body font-semibold text-fg">{icon}{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-center text-caption text-fg-muted">{children}</p>;
}

function Notice({ tone, children }: { tone: 'warning' | 'danger'; children: React.ReactNode }) {
  const cls = tone === 'danger'
    ? 'border-danger/40 bg-danger-soft text-fg'
    : 'border-warning/40 bg-warning-soft text-fg';
  return (
    <div className={`flex items-start gap-2 rounded-control border px-3 py-2 text-caption ${cls}`}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
