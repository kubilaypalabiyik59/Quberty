'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Building2, Warehouse as WarehouseIcon, Users } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows, ErrorNote } from '@/components/erp/PageHeader';

/**
 * Organisation setup — sites, warehouses and operating units.
 *
 * This is the page that answers "how do I open a new store without asking anyone".
 * A store is a SITE plus a WAREHOUSE: `Warehouse.site_id` is NOT NULL and every
 * demand document derives its site from its warehouse, so the two are created
 * together and in that order.
 *
 * **[OFFICIAL]** the department master is not a table of its own — a department is
 * an OPERATING UNIT whose type is *Department*, and operating units are what D365
 * uses as financial dimensions. That is why one section covers departments, cost
 * centres and business units: same entity, different type.
 */
export default function OrganisationSetupPage() {
  const qc = useQueryClient();
  const [newSite, setNewSite] = useState(false);
  const [newWarehouse, setNewWarehouse] = useState(false);
  const [newUnit, setNewUnit] = useState(false);

  const sites = useQuery({
    queryKey: ['sites'],
    queryFn: () => api.get('/warehouse/sites').then((r) => r.data.data ?? []),
  });
  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouse/warehouses').then((r) => r.data.data ?? []),
  });
  const units = useQuery({
    queryKey: ['operating-units'],
    queryFn: () => api.get('/setup/operating-units').then((r) => r.data.data ?? []),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['sites'] });
    qc.invalidateQueries({ queryKey: ['warehouses'] });
    qc.invalidateQueries({ queryKey: ['operating-units'] });
    qc.invalidateQueries({ queryKey: ['setup-readiness'] });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Organisation"
        subtitle="Sites, warehouses and the department master — a store is a site plus a warehouse"
      />
      <ErrorNote message={sites.error || warehouses.error ? 'Could not load the organisation.' : ''} />

      {/* ── Sites ─────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-body font-medium text-fg">
            <Building2 className="h-4 w-4 text-fg-muted" /> Sites
          </h2>
          <Button size="sm" onClick={() => setNewSite(true)}>
            <Plus className="h-4 w-4" /> New site
          </Button>
        </div>
        <p className="text-caption text-fg-muted">
          A site is a geographic place. It is the store axis of the ledger when the STORE financial
          dimension is on, and it is what the operations map plots.
        </p>

        <TableShell>
          <thead>
            <tr><Th>Code</Th><Th>Name</Th><Th>City</Th><Th>Country</Th><Th>Warehouses</Th></tr>
          </thead>
          <tbody>
            {sites.isLoading && <LoadingRows rows={3} cols={5} />}
            {sites.data?.length === 0 && (
              <EmptyRow colSpan={5}>
                No sites yet. Create one before a warehouse — a warehouse must belong to a site.
              </EmptyRow>
            )}
            {sites.data?.map((s: any) => (
              <tr key={s.id}>
                <Td className="font-mono">{s.code}</Td>
                <Td>{s.name}</Td>
                <Td>{s.city}</Td>
                <Td>{s.country}</Td>
                <Td>{warehouses.data?.filter((w: any) => w.site_id === s.id).length ?? 0}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </section>

      {/* ── Warehouses ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-body font-medium text-fg">
            <WarehouseIcon className="h-4 w-4 text-fg-muted" /> Warehouses
          </h2>
          <Button size="sm" onClick={() => setNewWarehouse(true)}>
            <Plus className="h-4 w-4" /> New warehouse
          </Button>
        </div>
        <p className="text-caption text-fg-muted">
          Stock lives in a warehouse, and a document&apos;s site is derived from its warehouse — never set
          independently. Putaway behaviour is per warehouse, under Warehouse setup.
        </p>

        <TableShell>
          <thead>
            <tr><Th>Code</Th><Th>Name</Th><Th>Site</Th><Th>Type</Th><Th>Active</Th></tr>
          </thead>
          <tbody>
            {warehouses.isLoading && <LoadingRows rows={3} cols={5} />}
            {warehouses.data?.length === 0 && <EmptyRow colSpan={5}>No warehouses yet.</EmptyRow>}
            {warehouses.data?.map((w: any) => (
              <tr key={w.id}>
                <Td className="font-mono">{w.code}</Td>
                <Td>{w.name}</Td>
                <Td>{w.site?.name ?? sites.data?.find((s: any) => s.id === w.site_id)?.name ?? '—'}</Td>
                <Td>{w.type}</Td>
                <Td>{w.is_active ? 'yes' : 'no'}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </section>

      {/* ── Operating units ───────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-body font-medium text-fg">
            <Users className="h-4 w-4 text-fg-muted" /> Operating units
          </h2>
          <Button size="sm" onClick={() => setNewUnit(true)}>
            <Plus className="h-4 w-4" /> New unit
          </Button>
        </div>
        <p className="text-caption text-fg-muted">
          Departments, cost centres and business units are one entity with a type — Microsoft&apos;s own
          model, and why adding a cost-centre dimension later needs no new table. A department on an
          employee is what splits payroll expense by functional area.
        </p>

        <TableShell>
          <thead>
            <tr><Th>Number</Th><Th>Name</Th><Th>Type</Th><Th>Parent</Th><Th>Staff</Th><Th>Active</Th></tr>
          </thead>
          <tbody>
            {units.isLoading && <LoadingRows rows={3} cols={6} />}
            {units.data?.length === 0 && (
              <EmptyRow colSpan={6}>
                None yet. Create a department to code payroll and revenue by functional area.
              </EmptyRow>
            )}
            {units.data?.map((u: any) => (
              <tr key={u.id}>
                <Td className="font-mono">{u.code}</Td>
                <Td>{u.name}</Td>
                <Td className="text-fg-muted">{u.unit_type}</Td>
                <Td>{u.parent?.code ?? '—'}</Td>
                <Td>{u._count?.staff ?? 0}</Td>
                <Td>{u.is_active ? 'yes' : 'no'}</Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </section>

      {newSite && <NewSiteDialog onClose={() => setNewSite(false)} onSaved={refresh} />}
      {newWarehouse && (
        <NewWarehouseDialog sites={sites.data ?? []} loading={sites.isLoading} onClose={() => setNewWarehouse(false)} onSaved={refresh} />
      )}
      {newUnit && (
        <NewUnitDialog units={units.data ?? []} onClose={() => setNewUnit(false)} onSaved={refresh} />
      )}
    </div>
  );
}

function NewSiteDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: '', name: '', city: '', country: 'BO', address: '' });
  const [error, setError] = useState('');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const create = useMutation({
    mutationFn: () => api.post('/warehouse/sites', {
      code: f.code, name: f.name, city: f.city,
      country: f.country || 'BO', address: f.address || null,
    }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create the site.')),
  });

  const blockedReason = !f.code ? 'A code is required.' : !f.name ? 'A name is required.' : !f.city ? 'A city is required — it is what the map geocodes.' : null;

  return (
    <Dialog
      title="New site" description="A geographic place. Create this before the warehouse that sits in it."
      onClose={onClose} error={error} blockedReason={blockedReason}
      submitLabel="Create site" submitting={create.isPending} onSubmit={() => create.mutate()}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">Code *
          <input className={dialogField} value={f.code} onChange={set('code')} placeholder="SITE-SCZ" />
        </label>
        <label className="text-caption text-fg-muted">Name *
          <input className={dialogField} value={f.name} onChange={set('name')} placeholder="Santa Cruz Store" />
        </label>
        <label className="text-caption text-fg-muted">City *
          <input className={dialogField} value={f.city} onChange={set('city')} placeholder="Santa Cruz de la Sierra" />
        </label>
        <label className="text-caption text-fg-muted">Country
          <input className={dialogField} value={f.country} onChange={set('country')} placeholder="BO" />
        </label>
        <label className="col-span-2 text-caption text-fg-muted">Address
          <input className={dialogField} value={f.address} onChange={set('address')} placeholder="optional — improves the map pin" />
        </label>
      </div>
      <p className="mt-3 text-micro text-fg-subtle">
        Put the real city in the city field. A country name there drops the pin hundreds of kilometres
        away, which looks plausible and is wrong — worse than a map that looks broken.
      </p>
    </Dialog>
  );
}

function NewWarehouseDialog({
  sites, loading, onClose, onSaved,
}: { sites: any[]; loading: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: '', name: '', site_id: '', type: 'standard' });
  const [error, setError] = useState('');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const create = useMutation({
    mutationFn: () => api.post('/warehouse/warehouses', f),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create the warehouse.')),
  });

  const blockedReason = loading
    ? 'Loading sites…'
    : !sites.length ? 'No sites exist yet — create one first.'
    : !f.code ? 'A code is required.'
    : !f.name ? 'A name is required.'
    : !f.site_id ? 'Choose the site this warehouse sits in.'
    : null;

  return (
    <Dialog
      title="New warehouse" description="Where stock physically is. Its site is inherited, never set separately."
      onClose={onClose} error={error} blockedReason={blockedReason}
      submitLabel="Create warehouse" submitting={create.isPending} onSubmit={() => create.mutate()}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">Code *
          <input className={dialogField} value={f.code} onChange={set('code')} placeholder="WH-SCZ" />
        </label>
        <label className="text-caption text-fg-muted">Name *
          <input className={dialogField} value={f.name} onChange={set('name')} placeholder="Santa Cruz Store" />
        </label>
        <label className="text-caption text-fg-muted">Site *
          <select className={dialogField} value={f.site_id} onChange={set('site_id')}>
            <option value="">— select —</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
        </label>
        <label className="text-caption text-fg-muted">Type
          <select className={dialogField} value={f.type} onChange={set('type')}>
            <option value="standard">Standard</option>
            <option value="retail">Retail store</option>
            <option value="distribution">Distribution centre</option>
          </select>
        </label>
      </div>
      <p className="mt-3 text-micro text-fg-subtle">
        A new warehouse starts with no zones or locations. Add at least one PICK location under
        Warehouse setup before switching on directed putaway, or its stock counts as unsellable.
      </p>
    </Dialog>
  );
}

function NewUnitDialog({
  units, onClose, onSaved,
}: { units: any[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ code: '', name: '', unit_type: 'DEPARTMENT', parent_id: '', memo: '' });
  const [error, setError] = useState('');
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  const create = useMutation({
    mutationFn: () => api.post('/setup/operating-units', {
      code: f.code, name: f.name, unit_type: f.unit_type,
      parent_id: f.parent_id || null, memo: f.memo || null,
    }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create the operating unit.')),
  });

  const blockedReason = !f.code ? 'A number is required.' : !f.name ? 'A name is required.' : null;

  return (
    <Dialog
      title="New operating unit"
      description="A department, cost centre or business unit. The number is unique across all of them."
      onClose={onClose} error={error} blockedReason={blockedReason}
      submitLabel="Create unit" submitting={create.isPending} onSubmit={() => create.mutate()}
    >
      <div className="grid grid-cols-2 gap-2.5">
        <label className="text-caption text-fg-muted">Number *
          <input className={dialogField} value={f.code} onChange={set('code')} placeholder="SALES" />
        </label>
        <label className="text-caption text-fg-muted">Name *
          <input className={dialogField} value={f.name} onChange={set('name')} placeholder="Sales" />
        </label>
        <label className="col-span-2 text-caption text-fg-muted">Type *
          <select className={dialogField} value={f.unit_type} onChange={set('unit_type')}>
            <option value="DEPARTMENT">Department — a functional area, can carry P&amp;L</option>
            <option value="COST_CENTER">Cost centre — accountable for budgeted spend</option>
            <option value="BUSINESS_UNIT">Business unit — an industry or product line</option>
            <option value="RETAIL_CHANNEL">Retail channel — a store or online channel</option>
            <option value="VALUE_STREAM">Value stream — a production flow</option>
          </select>
        </label>
        <label className="col-span-2 text-caption text-fg-muted">Parent
          <select className={dialogField} value={f.parent_id} onChange={set('parent_id')}>
            <option value="">— none (a root unit) —</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
          </select>
        </label>
        <label className="col-span-2 text-caption text-fg-muted">Memo
          <input className={dialogField} value={f.memo} onChange={set('memo')} />
        </label>
      </div>
      <p className="mt-3 text-micro text-fg-subtle">
        To use this as a ledger axis, add a DEPT dimension under Finance setup with its values coming
        from Operating unit. Assign employees to it on their HR record.
      </p>
    </Dialog>
  );
}
