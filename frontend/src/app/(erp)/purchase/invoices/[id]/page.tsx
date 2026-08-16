'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { PageHeader, TableShell, Th, Td } from '@/components/erp/PageHeader';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 });
const qty = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { maximumFractionDigits: 2 });
const day = (d: any) => (d ? new Date(d).toLocaleDateString('es-BO') : '—');

function Field({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div>
      <div className="text-micro uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={`text-body text-fg ${mono ? 'font-mono text-caption' : ''}`}>{value ?? '—'}</div>
    </div>
  );
}

/**
 * Vendor invoice — matching details and posting.
 *
 * [OFFICIAL] the Invoice matching details page shows, per line, the *Matching
 * policy*, *Product receipt quantity match*, *Price match* and *Price total
 * match*, and it is where the "Approve posting with matching discrepancies"
 * toggle lives. A line that needs no matching shows "Not performed" rather than
 * a pass, because silence is not a verdict.
 *
 * The one thing this screen refuses to do is hide WHY something failed. Every
 * failed verdict carries its reason in words, next to the number that caused it.
 */
export default function VendorInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [banner, setBanner] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['vendor-invoice', id],
    queryFn: () => api.get(`/purchase/invoices/${id}`).then((r) => r.data),
  });

  const invoice = data?.data;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['vendor-invoice', id] });
    qc.invalidateQueries({ queryKey: ['vendor-invoices'] });
    qc.invalidateQueries({ queryKey: ['received-not-invoiced'] });
  };
  const fail = (e: any, fallback: string) =>
    setBanner({ tone: 'bad', text: e?.response?.data?.error?.message ?? fallback });

  const match = useMutation({
    mutationFn: () => api.post(`/purchase/invoices/${id}/match`).then((r) => r.data),
    onSuccess: (r) => {
      refresh();
      const o = r.data;
      setBanner({
        tone: o.header_match_status === 'FAILED' ? 'bad' : 'ok',
        text:
          o.header_match_status === 'FAILED'
            ? `Match status: FAILED — ${o.reasons.join(' · ')}`
            : `Match status: ${o.header_match_status}.`,
      });
    },
    onError: (e) => fail(e, 'Could not update the match status.'),
  });

  const approve = useMutation({
    mutationFn: () => api.post(`/purchase/invoices/${id}/approve-discrepancies`).then((r) => r.data),
    onSuccess: () => {
      refresh();
      setBanner({ tone: 'ok', text: 'Discrepancies approved. The invoice can now be posted.' });
    },
    onError: (e) => fail(e, 'Could not approve the discrepancies.'),
  });

  const post = useMutation({
    mutationFn: () => api.post(`/purchase/invoices/${id}/post`).then((r) => r.data),
    onSuccess: (r) => {
      refresh();
      setBanner({ tone: 'ok', text: r.data.posting_note });
    },
    onError: (e) => fail(e, 'Could not post the invoice.'),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/purchase/invoices/${id}/cancel`).then((r) => r.data),
    onSuccess: () => {
      refresh();
      setBanner({ tone: 'ok', text: 'Invoice cancelled and its receipt matches released.' });
    },
    onError: (e) => fail(e, 'Could not cancel the invoice.'),
  });

  if (isLoading) return <div className="text-caption text-fg-muted">Loading…</div>;
  if (!invoice) return <div className="text-caption text-danger">Invoice not found.</div>;

  const draft = invoice.status === 'DRAFT';
  const failed = invoice.header_match_status === 'FAILED';

  return (
    <div>
      <PageHeader
        title={`Invoice ${invoice.invoice_number}`}
        subtitle={`${invoice.internal_number} · ${invoice.supplier?.name ?? ''}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusPill status={invoice.status} />
            {draft && (
              <>
                <button
                  onClick={() => match.mutate()}
                  disabled={match.isPending}
                  className="h-8 rounded-control border border-border bg-surface px-3 text-caption text-fg hover:bg-surface-sunken disabled:opacity-50"
                >
                  {match.isPending ? 'Matching…' : 'Update match status'}
                </button>
                {failed && !invoice.discrepancy_approved && (
                  <button
                    onClick={() => approve.mutate()}
                    disabled={approve.isPending}
                    className="h-8 rounded-control border border-warning bg-warning-soft px-3 text-caption font-medium text-warning hover:opacity-90 disabled:opacity-50"
                  >
                    Approve discrepancies
                  </button>
                )}
                <button
                  onClick={() => post.mutate()}
                  disabled={post.isPending}
                  className="h-8 rounded-control border border-accent bg-accent-soft px-3 text-caption font-medium text-accent-onSoft hover:opacity-90 disabled:opacity-50"
                >
                  {post.isPending ? 'Posting…' : 'Post'}
                </button>
                <button
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                  className="h-8 rounded-control border border-border bg-surface px-3 text-caption text-fg-muted hover:bg-surface-sunken disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        }
      />

      {banner && (
        <div
          role="alert"
          className={`mb-4 rounded-surface border px-3 py-2 text-caption ${
            banner.tone === 'ok'
              ? 'border-success/25 bg-success-soft text-success'
              : 'border-danger/25 bg-danger-soft text-danger'
          }`}
        >
          {banner.text}
        </div>
      )}

      {invoice.discrepancy_approved && draft && (
        <div className="mb-4 rounded-surface border border-warning/25 bg-warning-soft px-3 py-2 text-caption text-warning">
          Posting with matching discrepancies has been approved for this invoice.
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="mb-5 grid grid-cols-2 gap-4 rounded-surface border border-border bg-surface p-4 md:grid-cols-4">
        <Field label="Supplier" value={invoice.supplier?.name} />
        <Field label="Purchase order" value={invoice.purchase_order?.po_number} mono />
        <Field label="Invoice date" value={day(invoice.invoice_date)} />
        <Field label="Posting date" value={day(invoice.posting_date)} />
        <Field label="Supplier NIT" value={invoice.supplier_tax_id} mono />
        <Field label="Authorisation code" value={invoice.fiscal_authorization_code} mono />
        <Field label="Control code" value={invoice.fiscal_control_code} mono />
        <Field label="Last matched" value={invoice.last_matched_at ? day(invoice.last_matched_at) : 'never'} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 rounded-surface border border-border bg-surface p-4 md:grid-cols-5">
        <Field label="Subtotal (net)" value={money(invoice.subtotal)} />
        <Field label="Recoverable tax" value={money(invoice.tax_amount)} />
        <Field label="Non-recoverable" value={money(invoice.non_recoverable_tax)} />
        <Field label="Invoice total" value={<strong>{money(invoice.total_amount)}</strong>} />
        <div>
          <div className="text-micro uppercase tracking-wide text-fg-muted">Totals match</div>
          <StatusPill status={invoice.totals_match_status} />
        </div>
      </div>

      {/* ── Matching details ───────────────────────────────────────────── */}
      <h2 className="mb-2 text-body font-semibold text-fg">Matching details</h2>
      <TableShell>
        <thead>
          <tr>
            <Th>Item</Th>
            <Th className="text-right">Qty</Th>
            <Th className="text-right">Unit price</Th>
            <Th className="text-right">Ordered</Th>
            <Th className="text-right">Net amount</Th>
            <Th>Policy</Th>
            <Th>Receipt qty</Th>
            <Th>Price</Th>
            <Th>Price total</Th>
            <Th className="text-right">Variance</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {invoice.lines.map((l: any) => (
            <tr key={l.id} className="align-top hover:bg-surface-sunken">
              <Td>
                <div>{l.product?.name ?? l.description ?? '—'}</div>
                <div className="font-mono text-micro text-fg-muted">{l.product?.sku ?? ''}</div>
                {l.matches?.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {l.matches.map((m: any) => (
                      <div key={m.id} className="text-micro text-fg-muted">
                        matched {qty(m.quantity)} from{' '}
                        <span className="font-mono">{m.receipt_line?.receipt?.receipt_number}</span>
                        {m.receipt_line?.receipt?.packing_slip ? ` · slip ${m.receipt_line.receipt.packing_slip}` : ''}
                      </div>
                    ))}
                  </div>
                )}
                {l.matches?.length === 0 && l.matching_policy === 'THREE_WAY' && (
                  <div className="mt-1 text-micro text-danger">not matched to any product receipt</div>
                )}
              </Td>
              <Td className="text-right tabular-nums">{qty(l.quantity)}</Td>
              <Td className="text-right tabular-nums">{money(l.unit_price)}</Td>
              <Td className="text-right tabular-nums text-fg-muted">
                {l.po_line ? money(l.po_line.unit_cost) : '—'}
              </Td>
              <Td className="text-right tabular-nums">{money(l.line_net_amount)}</Td>
              <Td className="text-caption text-fg-muted">{l.matching_policy.replace('_', '-').toLowerCase()}</Td>
              <Td>
                <StatusPill status={l.receipt_qty_match_status} />
              </Td>
              <Td>
                <StatusPill status={l.price_match_status} />
              </Td>
              <Td>
                <StatusPill status={l.price_total_match_status} />
              </Td>
              <Td className="text-right tabular-nums">
                {l.price_variance_pct != null ? (
                  <span className={Number(l.price_variance_pct) > 0 ? 'text-danger' : 'text-fg-muted'}>
                    {Number(l.price_variance_pct) > 0 ? '+' : ''}
                    {Number(l.price_variance_pct).toFixed(2)}%
                  </span>
                ) : (
                  '—'
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableShell>

      <p className="mt-3 text-caption text-fg-muted">
        Three-way matching compares the invoice price to the order and the invoice quantity to the product receipts
        it is tied to. The tolerance applied to each line is the one that was in force when the line was matched — it
        is stored with the line, so a later change to the tolerance cannot rewrite the verdict on a posted document.
      </p>

      <div className="mt-4">
        <Link href="/purchase/invoices" className="text-caption text-accent hover:underline">
          ← All vendor invoices
        </Link>
      </div>
    </div>
  );
}
