'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Pencil, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useMoney } from '@/components/CurrencyProvider';
import { useAuthStore } from '@/stores/authStore';
import { can } from '@/lib/access';
import { Button } from '@/components/ui/Button';
import { Dialog, dialogField, apiErrorMessage } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows } from '@/components/erp/PageHeader';

interface Customer {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  segment: string;
  notes: string | null;
  total_orders: number;
  lifetime_value: number | string;
  open_balance: number;
  last_order_at: string | null;
}

const PAGE = 20;

/**
 * Customers: who they are, how to reach and invoice them, and what they owe.
 *
 * "Statement" replaces the old Transactions button, which listed stock
 * movements — a customer's account is their orders, facturas and payments.
 * Terms of payment, credit limit and customer type are D365 customer fields
 * this model does not have yet; they are proposed for WORK-054's customer
 * migration rather than added here.
 */
export default function CustomersPage() {
  const { money } = useMoney();
  const qc = useQueryClient();
  const permissions = useAuthStore((s) => s.user?.permissions);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [statementOf, setStatementOf] = useState<Customer | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['customers', page, search],
    queryFn: () =>
      api.get('/customers', { params: { page, limit: PAGE, ...(search ? { search } : {}) } })
        .then((r) => ({ rows: r.data.data as Customer[], total: (r.data.meta?.total ?? 0) as number })),
  });
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Who you sell to, how to reach and invoice them, and what they owe."
        actions={can(permissions, 'customer.create') && (
          <Button onClick={() => setEditing('new')}><Plus className="h-4 w-4" aria-hidden /> New customer</Button>
        )}
      />

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <input
          className={`${dialogField} pl-9`}
          placeholder="Search name, email, code or NIT…"
          aria-label="Search customers"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th>NIT / CI</Th>
            <Th>Contact</Th>
            <Th>City</Th>
            <Th>Segment</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Open balance</Th>
            <Th>Last order</Th>
            <Th className="w-44" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={10} />}
          {!isLoading && rows.length === 0 && <EmptyRow colSpan={10}>No customers found.</EmptyRow>}
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-surface-sunken">
              <Td className="font-mono text-caption">{c.code}</Td>
              <Td className="font-medium">{c.first_name} {c.last_name}</Td>
              <Td className="font-mono text-caption text-fg-muted">{c.tax_id ?? '—'}</Td>
              <Td className="text-caption text-fg-muted">
                <div>{c.email ?? '—'}</div>
                {c.phone && <div>{c.phone}</div>}
              </Td>
              <Td className="text-caption text-fg-muted">{[c.city, c.country].filter(Boolean).join(', ') || '—'}</Td>
              <Td><span className="rounded bg-surface-sunken px-1.5 py-0.5 text-micro capitalize">{c.segment}</span></Td>
              <Td className="text-right font-mono text-caption">{c.total_orders}</Td>
              <Td className={`text-right font-mono text-caption ${c.open_balance > 0 ? 'font-semibold text-warning' : 'text-fg-muted'}`}>
                {money(c.open_balance)}
              </Td>
              <Td className="text-caption text-fg-muted">{c.last_order_at ? new Date(c.last_order_at).toLocaleDateString() : '—'}</Td>
              <Td className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setStatementOf(c)}>
                    <FileText className="h-3.5 w-3.5" aria-hidden /> Statement
                  </Button>
                  {can(permissions, 'customer.update') && (
                    <Button size="sm" variant="ghost" aria-label={`Edit ${c.code}`} onClick={() => setEditing(c)}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-caption text-fg-muted">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      {editing && (
        <CustomerDialog
          customer={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['customers'] }); }}
        />
      )}
      {statementOf && <StatementDialog customer={statementOf} onClose={() => setStatementOf(null)} />}
    </div>
  );
}

const FIELDS: Array<{ key: keyof Customer; label: string; wide?: boolean; type?: string }> = [
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name / company' },
  { key: 'tax_id', label: 'NIT / CI' },
  { key: 'segment', label: 'Segment' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address', wide: true },
  { key: 'city', label: 'City' },
  { key: 'country', label: 'Country' },
  { key: 'notes', label: 'Notes', wide: true },
];

function CustomerDialog({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String(customer?.[f.key] ?? (f.key === 'segment' ? 'regular' : ''))])));
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: () => {
      // Empty optional fields go as null (clear), never as "".
      const body: Record<string, string | null> = {};
      for (const f of FIELDS) {
        const v = form[f.key].trim();
        body[f.key] = v === '' && !['first_name', 'last_name', 'segment'].includes(f.key) ? null : v;
      }
      if (!body.segment) delete body.segment;
      return customer ? api.put(`/customers/${customer.id}`, body) : api.post('/customers', body);
    },
    onSuccess: onSaved,
    onError: (e: any) => setError(apiErrorMessage(e, 'Could not save the customer.')),
  });

  const email = form.email.trim();
  const blocked =
    !form.first_name.trim() || !form.last_name.trim() ? 'Enter the first and last name (or company name).'
    : email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? 'The email is not valid.'
    : null;

  return (
    <Dialog
      title={customer ? `Customer ${customer.code}` : 'New customer'}
      description={customer ? undefined : 'The customer code is assigned automatically.'}
      onClose={onClose}
      error={error}
      blockedReason={blocked}
      submitLabel={customer ? 'Save' : 'Create customer'}
      onSubmit={() => save.mutate()}
      submitting={save.isPending}
      width="max-w-2xl"
    >
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? 'col-span-2' : undefined}>
            <label htmlFor={`cu-${f.key}`} className="mb-1 block text-caption text-fg-muted">{f.label}</label>
            <input
              id={`cu-${f.key}`}
              className={dialogField}
              type={f.type ?? 'text'}
              value={form[f.key]}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
            />
          </div>
        ))}
      </div>
    </Dialog>
  );
}

const PAYMENT_PILL: Record<string, string> = {
  OPEN: 'bg-warning-soft text-warning',
  PAID: 'bg-success-soft text-success',
  CLOSED: 'bg-surface-sunken text-fg-muted',
  NOT_INVOICED: 'bg-surface-sunken text-fg-subtle',
};

function StatementDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { money } = useMoney();
  const { data, isLoading, error } = useQuery({
    queryKey: ['customer-statement', customer.id],
    queryFn: () => api.get(`/customers/${customer.id}/statement`).then((r) => r.data.data),
  });
  const t = data?.totals;

  return (
    <Dialog
      title={`Statement — ${customer.first_name} ${customer.last_name}`}
      description={`${customer.code}${customer.tax_id ? ` · NIT ${customer.tax_id}` : ''}`}
      onClose={onClose}
      error={error ? apiErrorMessage(error, 'Could not load the statement.') : undefined}
      submitLabel="Close"
      onSubmit={onClose}
      width="max-w-4xl"
    >
      <div className="mb-4 grid grid-cols-4 gap-2">
        {([['Ordered', t?.ordered], ['Invoiced', t?.invoiced], ['Paid', t?.paid], ['Open', t?.open]] as const).map(([label, v]) => (
          <div key={label} className="rounded-control border border-border bg-surface-sunken px-3 py-2">
            <div className="text-micro uppercase tracking-wide text-fg-muted">{label}</div>
            <div className={`font-mono text-body font-semibold ${label === 'Open' && (v ?? 0) > 0 ? 'text-warning' : 'text-fg'}`}>
              {isLoading ? '…' : money(v ?? 0)}
            </div>
          </div>
        ))}
      </div>
      <div className="max-h-[50vh] overflow-y-auto">
        <TableShell>
          <thead>
            <tr><Th>Date</Th><Th>Order</Th><Th>Status</Th><Th>Factura</Th><Th className="text-right">Amount</Th><Th>Payment</Th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && <LoadingRows cols={6} rows={3} />}
            {!isLoading && (data?.orders ?? []).length === 0 && <EmptyRow colSpan={6}>No orders yet.</EmptyRow>}
            {(data?.orders ?? []).map((o: any) => (
              <tr key={o.id}>
                <Td className="text-caption text-fg-muted">{new Date(o.created_at).toLocaleDateString()}</Td>
                <Td className="font-mono text-caption">{o.order_number}</Td>
                <Td className="text-caption">{o.status}</Td>
                <Td className="font-mono text-caption">
                  {o.factura_number ?? '—'}
                  {o.factura_status === 'CANCELLED' && <span className="ml-1 text-micro text-danger">annulled</span>}
                </Td>
                <Td className="text-right font-mono text-caption">{money(Number(o.total_amount))}</Td>
                <Td><span className={`rounded px-1.5 py-0.5 text-micro font-semibold ${PAYMENT_PILL[o.payment_status]}`}>{o.payment_status.replace('_', ' ').toLowerCase()}</span></Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </div>
    </Dialog>
  );
}
