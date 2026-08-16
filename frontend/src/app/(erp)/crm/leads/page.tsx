'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, UserCheck, UserX, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/erp/StatusPill';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows, ErrorNote } from '@/components/erp/PageHeader';

/**
 * Leads — the first document in Prospect to Quote.
 *
 * The two actions that matter are qualify and disqualify, and they are not
 * symmetrical: qualifying creates a customer AND an opportunity, while
 * disqualifying is refused outright once an opportunity exists. Both rules come
 * from the backend; the UI surfaces the refusal rather than hiding the button,
 * so the reason is visible instead of mysterious.
 */
const STATUSES = ['', 'OPEN', 'QUALIFIED', 'DISQUALIFIED'];

export default function LeadsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['leads', status, search],
    queryFn: () =>
      api
        .get('/crm/leads', { params: { ...(status && { status }), ...(search && { search }), limit: 50 } })
        .then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['leads'] });
    qc.invalidateQueries({ queryKey: ['opportunities'] });
    setError('');
  };
  const fail = (e: any) => setError(e.response?.data?.error?.message ?? 'Action failed');

  const qualify = useMutation({
    mutationFn: (id: string) => api.post(`/crm/leads/${id}/qualify`, {}),
    onSuccess: invalidate,
    onError: fail,
  });
  const disqualify = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/crm/leads/${id}/disqualify`, { reason }),
    onSuccess: invalidate,
    onError: fail,
  });
  const reopen = useMutation({
    mutationFn: (id: string) => api.post(`/crm/leads/${id}/reopen`, {}),
    onSuccess: invalidate,
    onError: fail,
  });

  const leads = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Unqualified prospects. Qualifying one creates a customer and an opportunity."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New lead
          </Button>
        }
      />

      <ErrorNote message={error} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, email, number…"
          className="h-8 w-72 rounded-control border border-border bg-surface px-2.5 text-body text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {STATUSES.map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={`h-8 rounded-control border px-2.5 text-caption transition-colors duration-quick ${
              status === s
                ? 'border-accent bg-accent-soft text-accent-onSoft font-medium'
                : 'border-border bg-surface text-fg-muted hover:bg-surface-sunken'
            }`}
          >
            {s ? s.replace(/_/g, ' ') : 'All'}
          </button>
        ))}
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Company / Contact</Th>
            <Th>Source</Th>
            <Th>Rating</Th>
            <Th className="text-right">Estimated</Th>
            <Th>Status</Th>
            <Th>Converted to</Th>
            <Th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={8} />}
          {!isLoading && leads.length === 0 && (
            <EmptyRow colSpan={8}>
              No leads yet. A lead is somebody who might buy — it is deliberately kept out of the
              customer list until it is qualified.
            </EmptyRow>
          )}
          {leads.map((l: any) => (
            <tr key={l.id} className="hover:bg-surface-sunken">
              <Td>
                <Link href={`/crm/leads/${l.id}`} className="font-mono text-caption text-accent hover:underline">
                  {l.lead_number}
                </Link>
              </Td>
              <Td>
                <div className="font-medium">{l.company_name ?? '—'}</div>
                <div className="text-caption text-fg-muted">
                  {[l.first_name, l.last_name].filter(Boolean).join(' ')}
                  {l.email ? ` · ${l.email}` : ''}
                </div>
              </Td>
              <Td className="text-caption text-fg-muted">{l.source}</Td>
              <Td className="text-caption text-fg-muted">{l.rating}</Td>
              <Td className="text-right font-mono text-caption">
                {l.estimated_amount ? Number(l.estimated_amount).toLocaleString('es-BO', { minimumFractionDigits: 2 }) : '—'}
              </Td>
              <Td><StatusPill status={l.status} /></Td>
              <Td className="text-caption">
                {l.converted_customer ? (
                  <Link href={`/sales/customers`} className="text-accent hover:underline">
                    {l.converted_customer.code}
                  </Link>
                ) : (
                  <span className="text-fg-subtle">—</span>
                )}
              </Td>
              <Td className="text-right">
                <div className="flex justify-end gap-1.5">
                  {l.status === 'OPEN' && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={qualify.isPending}
                        onClick={() => qualify.mutate(l.id)}
                        title="Create a customer and an opportunity from this lead"
                      >
                        <UserCheck className="h-3.5 w-3.5" /> Qualify
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disqualify.isPending}
                        onClick={() => {
                          const reason = window.prompt('Why is this lead disqualified?');
                          if (reason !== null) disqualify.mutate({ id: l.id, reason });
                        }}
                      >
                        <UserX className="h-3.5 w-3.5" /> Disqualify
                      </Button>
                    </>
                  )}
                  {l.status === 'DISQUALIFIED' && (
                    <Button size="sm" variant="ghost" onClick={() => reopen.mutate(l.id)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Reopen
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {creating && <NewLeadDialog onClose={() => setCreating(false)} onSaved={invalidate} onError={fail} />}
    </div>
  );
}

function NewLeadDialog({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: () => void;
  onError: (e: any) => void;
}) {
  const [form, setForm] = useState({
    company_name: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    city: '',
    source: 'MANUAL',
    rating: 'WARM',
    estimated_amount: '',
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/crm/leads', {
        ...form,
        company_name: form.company_name || undefined,
        last_name: form.last_name || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        city: form.city || undefined,
        estimated_amount: form.estimated_amount ? Number(form.estimated_amount) : undefined,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError,
  });

  const field = 'h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none focus:ring-1 focus:ring-ring';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fg/30 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-surface border border-border bg-surface p-4 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-lead font-semibold text-fg">New lead</h2>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="col-span-2 text-caption text-fg-muted">
            Company
            <input className={field} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
          </label>
          <label className="text-caption text-fg-muted">
            First name *
            <input className={field} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          </label>
          <label className="text-caption text-fg-muted">
            Last name
            <input className={field} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          </label>
          <label className="text-caption text-fg-muted">
            Email
            <input className={field} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <label className="text-caption text-fg-muted">
            Phone
            <input className={field} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </label>
          <label className="text-caption text-fg-muted">
            Source
            <select className={field} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
              {['MANUAL', 'WEB', 'REFERRAL', 'CAMPAIGN', 'WALK_IN', 'STOREFRONT'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-caption text-fg-muted">
            Rating
            <select className={field} value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>
              {['HOT', 'WARM', 'COLD'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="col-span-2 text-caption text-fg-muted">
            Estimated value
            <input className={field} type="number" value={form.estimated_amount} onChange={(e) => setForm({ ...form, estimated_amount: e.target.value })} />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!form.first_name || create.isPending} onClick={() => create.mutate()}>
            Create lead
          </Button>
        </div>
      </div>
    </div>
  );
}
