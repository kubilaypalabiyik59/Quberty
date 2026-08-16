'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { StatusPill } from '@/components/erp/StatusPill';
import { PageHeader, TableShell, Th, Td, EmptyRow, LoadingRows } from '@/components/erp/PageHeader';

const money = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2 });
const qty = (n: any) => Number(n ?? 0).toLocaleString('es-BO', { maximumFractionDigits: 2 });
const day = (d: any) => (d ? new Date(d).toLocaleDateString('es-BO') : '—');

/**
 * Product receipts.
 *
 * [OFFICIAL] the product receipt is the PHYSICAL half of a purchase: it records
 * that goods arrived, and it carries the supplier's packing slip reference,
 * which "is required for accounting, because it enables checks or audits of
 * supplier packing slips against what is received and the accounted inventory".
 *
 * The column that matters most here is "invoiced": a receipt whose lines are not
 * yet fully consumed by a vendor invoice is money sitting in goods-received-not-
 * invoiced. That is the number the accrual account holds.
 */
export default function ProductReceiptsPage() {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['product-receipts'],
    queryFn: () => api.get('/purchase/receipts').then((r) => r.data),
  });

  const rows: any[] = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Product receipts"
        subtitle="What physically arrived, and against which packing slip. The vendor invoice is a separate document — this one moves stock, that one creates the payable."
        actions={
          <Link
            href="/purchase/orders"
            className="inline-flex h-8 items-center rounded-control border border-border bg-surface px-3 text-caption text-fg hover:bg-surface-sunken"
          >
            Receive against an order
          </Link>
        }
      />

      <TableShell>
        <thead>
          <tr>
            <Th>Receipt</Th>
            <Th>Packing slip</Th>
            <Th>Order</Th>
            <Th>Supplier</Th>
            <Th>Date</Th>
            <Th className="text-right">Lines</Th>
            <Th className="text-right">Invoiced</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {isLoading && <LoadingRows cols={8} />}
          {!isLoading && rows.length === 0 && (
            <EmptyRow colSpan={8}>
              No product receipts yet. Receiving a confirmed purchase order raises one.
            </EmptyRow>
          )}
          {rows.map((r) => {
            const received = r.lines?.reduce((s: number, l: any) => s + Number(l.quantity), 0) ?? 0;
            const matched = r.lines?.reduce((s: number, l: any) => s + Number(l.matched_qty), 0) ?? 0;
            const fully = received > 0 && matched >= received - 0.001;
            return (
              <tr
                key={r.id}
                className="cursor-pointer hover:bg-surface-sunken"
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              >
                <Td>
                  <span className="font-mono text-caption text-accent">{r.receipt_number}</span>
                </Td>
                <Td className="font-mono text-caption">{r.packing_slip}</Td>
                <Td className="font-mono text-caption text-fg-muted">{r.purchase_order?.po_number ?? '—'}</Td>
                <Td>{r.supplier?.name ?? '—'}</Td>
                <Td className="text-caption text-fg-muted">{day(r.receipt_date)}</Td>
                <Td className="text-right tabular-nums">{r.lines?.length ?? 0}</Td>
                <Td className="text-right tabular-nums">
                  <span className={fully ? 'text-fg-muted' : 'text-warning'}>
                    {qty(matched)} / {qty(received)}
                  </span>
                </Td>
                <Td>
                  <StatusPill status={r.status} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </TableShell>

      <p className="mt-3 text-caption text-fg-muted">
        A receipt that is not fully invoiced is sitting in <strong>goods received not invoiced</strong> — the
        accrual the vendor invoice reverses.
      </p>
    </div>
  );
}
