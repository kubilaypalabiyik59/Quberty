'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { Dialog } from '@/components/erp/Dialog';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows } from '@/components/erp/PageHeader';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 });
const qty = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { maximumFractionDigits: 2 });
const day = (d: any) => (d ? new Date(d).toLocaleDateString('es-BO') : '—');
const today = () => new Date().toISOString().slice(0, 10);

const STATUSES = ['', 'DRAFT', 'POSTED', 'CANCELLED'];

/**
 * Vendor invoices, and the orders waiting for one.
 *
 * [OFFICIAL] "Purchase orders received but not invoiced" is a page in its own
 * right, and the automation workspace carries a "Documents not invoiced" grid
 * with an *Invoice now* button per row. Both are the same idea: the invoice is
 * raised FROM the receipt, so the list of what is waiting belongs next to the
 * list of what exists.
 */
export default function VendorInvoicesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [invoicing, setInvoicing] = useState<any | null>(null);
  const [form, setForm] = useState({ invoice_number: '', invoice_date: today(), supplier_tax_id: '', fiscal_authorization_code: '' });
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['vendor-invoices', status],
    queryFn: () => api.get('/purchase/invoices', { params: { ...(status && { status }) } }).then((r) => r.data),
  });

  const { data: waiting } = useQuery({
    queryKey: ['received-not-invoiced'],
    queryFn: () => api.get('/purchase/orders/received-not-invoiced').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: (body: any) => api.post('/purchase/invoices', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendor-invoices'] });
      qc.invalidateQueries({ queryKey: ['received-not-invoiced'] });
      setInvoicing(null);
      setError('');
    },
    onError: (e: any) => setError(e?.response?.data?.error?.message ?? 'Could not create the invoice.'),
  });

  const rows: any[] = data?.data ?? [];
  const pending: any[] = waiting?.data ?? [];

  const blockedReason = !form.invoice_number.trim()
    ? "Enter the supplier's invoice number."
    : !form.invoice_date
      ? 'Enter the invoice date.'
      : null;

  return (
    <div>
      <PageHeader
        title="Vendor invoices"
        subtitle="The supplier's document: their number, their date, their factura authorisation. Posting it reverses the receipt accrual, recognises the recoverable tax and creates the payable."
      />

      {/* ── Documents not invoiced ─────────────────────────────────────── */}
      {pending.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-body font-semibold text-fg">Received, not invoiced</h2>
          <p className="mb-2 text-caption text-fg-muted">
            These deliveries are sitting in the accrual account until their invoice arrives.
          </p>
          <TableShell>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Supplier</Th>
                <Th>Receipts</Th>
                <Th className="text-right">Awaiting invoice</Th>
                <Th className="text-right">Order total</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pending.map((o) => (
                <tr key={o.id} className="hover:bg-surface-sunken">
                  <Td className="font-mono text-caption">{o.po_number}</Td>
                  <Td>{o.supplier?.name ?? '—'}</Td>
                  <Td className="text-caption text-fg-muted">
                    {o.product_receipts?.map((r: any) => r.receipt_number).join(', ') || '—'}
                  </Td>
                  <Td className="text-right tabular-nums text-warning">{qty(o.uninvoiced_qty)}</Td>
                  <Td className="text-right tabular-nums">{money(o.total_amount)}</Td>
                  <Td className="text-right">
                    <button
                      onClick={() => {
                        setInvoicing(o);
                        setForm({ invoice_number: '', invoice_date: today(), supplier_tax_id: '', fiscal_authorization_code: '' });
                        setError('');
                      }}
                      className="h-7 rounded-control border border-accent bg-accent-soft px-2.5 text-caption font-medium text-accent-onSoft hover:opacity-90"
                    >
                      Invoice now
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </section>
      )}

      {/* ── The invoices ───────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap gap-2">
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
            {s || 'All'}
          </button>
        ))}
      </div>

      <TableShell>
        <thead>
          <tr>
            <Th>Invoice</Th>
            <Th>Internal</Th>
            <Th>Supplier</Th>
            <Th>Order</Th>
            <Th>Date</Th>
            <Th className="text-right">Total</Th>
            <Th>Match</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={8} />}
          {!isLoading && rows.length === 0 && (
            <EmptyRow colSpan={8}>
              No vendor invoices yet. Raise one from a received order above, or from the order itself.
            </EmptyRow>
          )}
          {rows.map((i) => (
            <tr key={i.id} className="hover:bg-surface-sunken">
              <Td>
                <Link href={`/purchase/invoices/${i.id}`} className="font-mono text-caption text-accent hover:underline">
                  {i.invoice_number}
                </Link>
              </Td>
              <Td className="font-mono text-caption text-fg-muted">{i.internal_number}</Td>
              <Td>{i.supplier?.name ?? '—'}</Td>
              <Td className="font-mono text-caption text-fg-muted">{i.purchase_order?.po_number ?? '—'}</Td>
              <Td className="text-caption text-fg-muted">{day(i.invoice_date)}</Td>
              <Td className="text-right tabular-nums">{money(i.total_amount)}</Td>
              <Td>
                <StatusPill status={i.header_match_status} />
              </Td>
              <Td>
                <StatusPill status={i.status} />
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      {invoicing && (
        <Dialog
          title={`Invoice ${invoicing.po_number}`}
          description="Lines default from the product receipts, which is the official default. You can change quantities and prices on the next screen before posting."
          onClose={() => setInvoicing(null)}
          error={error}
          blockedReason={blockedReason}
          submitLabel={create.isPending ? 'Creating…' : 'Create invoice'}
          submitting={create.isPending}
          onSubmit={() =>
            create.mutate({
              purchase_order_id: invoicing.id,
              invoice_number: form.invoice_number.trim(),
              invoice_date: form.invoice_date,
              supplier_tax_id: form.supplier_tax_id || null,
              fiscal_authorization_code: form.fiscal_authorization_code || null,
            })
          }
        >
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Supplier invoice number *</span>
              <input
                autoFocus
                value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                placeholder="the number printed on their factura"
                className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-caption text-fg-muted">Invoice date *</span>
              <input
                type="date"
                value={form.invoice_date}
                onChange={(e) => setForm({ ...form, invoice_date: e.target.value })}
                className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-caption text-fg-muted">Supplier NIT</span>
                <input
                  value={form.supplier_tax_id}
                  onChange={(e) => setForm({ ...form, supplier_tax_id: e.target.value })}
                  className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-caption text-fg-muted">Authorisation code</span>
                <input
                  value={form.fiscal_authorization_code}
                  onChange={(e) => setForm({ ...form, fiscal_authorization_code: e.target.value })}
                  className="h-9 w-full rounded-control border border-border bg-surface px-2.5 text-body text-fg"
                />
              </label>
            </div>
            <p className="text-caption text-fg-muted">
              The NIT and authorisation code are what the IVA purchase ledger is built from. They can be filled in
              later, but not after the invoice is posted.
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
