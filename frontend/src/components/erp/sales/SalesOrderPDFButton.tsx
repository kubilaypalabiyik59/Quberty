'use client';

import dynamic from 'next/dynamic';
import { FileText, Eye, AlertCircle, RefreshCw } from 'lucide-react';
import { SalesOrderPDF } from './SalesOrderPDF';
import { useTaxPreview } from '@/lib/useTaxPreview';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(m => m.PDFDownloadLink),
  { ssr: false }
);

const BlobProvider = dynamic(
  () => import('@react-pdf/renderer').then(m => m.BlobProvider),
  { ssr: false }
);

interface Props {
  order: any;
  variant?: 'download' | 'view' | 'both';
}

/**
 * ── Why this gate exists ───────────────────────────────────────────────────
 * The document cannot fetch, so the tax is resolved here and handed down. Until
 * it is KNOWN, neither button is offered.
 *
 * The important half is the failure case, not the loading one. An earlier
 * version checked `isPending` alone while the hook returned a zero-filled tax
 * object on error — so once a request failed, `isPending` went false, the
 * buttons enabled, and the customer received a PDF stating this order carries no
 * tax. That document looks entirely legitimate. `useTaxPreview` now returns null
 * rather than zeros, and this component refuses to build a document without a
 * figure, so the failure is visible and recoverable instead of printed.
 */
export function SalesOrderPDFButton({ order, variant = 'both' }: Props) {
  const preview = useTaxPreview(Number(order.total_amount), {
    partyId: order.customer_id ?? null,
  });

  if (preview.status === 'error') {
    return (
      <div className="flex items-center gap-1">
        <span
          title={preview.error ?? undefined}
          className="flex items-center gap-1 text-xs text-amber-700 border border-amber-200 bg-amber-50 px-2 py-1 rounded-lg"
        >
          <AlertCircle className="h-3 w-3" /> Tax unavailable
        </span>
        <button
          onClick={preview.retry}
          title="Try to calculate the tax again"
          className="flex items-center gap-1 text-xs text-amber-900 font-medium underline px-1 py-1"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      </div>
    );
  }

  // Covers 'loading' and 'idle'.
  //
  // 'idle' means the order total is not an amount the engine will price — zero,
  // or not a number. A zero-total order therefore has no PDF here. That IS a
  // behaviour change: it used to render one carrying a zero tax line.
  // Deliberately NOT special-cased back by constructing a zero tax object, because
  // such an object is indistinguishable from the failure fallback this work item
  // exists to remove. If free-of-charge orders turn out to need a document, the
  // honest fix is for the preview to answer for a zero amount — not for this
  // component to invent the answer.
  if (!preview.tax) {
    return (
      <div className="flex items-center gap-1">
        <span
          title={
            preview.status === 'loading'
              ? 'Waiting for the tax engine'
              : 'This order has no priceable total, so no PDF is generated'
          }
          className="text-xs text-gray-400 px-2 py-1"
        >
          {preview.status === 'loading' ? 'Calculating tax…' : 'No total'}
        </span>
      </div>
    );
  }

  const doc = <SalesOrderPDF order={order} tax={preview.tax} />;
  const fileName = `Pedido-${order.order_number}.pdf`;

  return (
    <div className="flex items-center gap-1">
      {(variant === 'view' || variant === 'both') && (
        // @ts-ignore — BlobProvider is dynamically loaded
        <BlobProvider document={doc}>
          {({ url, loading }: { url: string | null; loading: boolean }) => (
            <button
              onClick={() => url && window.open(url, '_blank')}
              disabled={loading || !url}
              title="View order PDF"
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 hover:border-blue-400 px-2 py-1 rounded-lg disabled:opacity-40 transition-colors"
            >
              <Eye className="h-3 w-3" />
              {loading ? '...' : 'View'}
            </button>
          )}
        </BlobProvider>
      )}

      {(variant === 'download' || variant === 'both') && (
        // @ts-ignore — PDFDownloadLink is dynamically loaded
        <PDFDownloadLink document={doc} fileName={fileName}>
          {({ loading }: { loading: boolean }) => (
            <button
              disabled={loading}
              title="Download order PDF"
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 font-medium border border-gray-200 hover:border-gray-400 px-2 py-1 rounded-lg disabled:opacity-40 transition-colors"
            >
              <FileText className="h-3 w-3" />
              {loading ? '...' : 'PDF'}
            </button>
          )}
        </PDFDownloadLink>
      )}
    </div>
  );
}
