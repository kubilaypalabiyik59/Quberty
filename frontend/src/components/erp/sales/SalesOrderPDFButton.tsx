'use client';

import dynamic from 'next/dynamic';
import { FileText, Eye } from 'lucide-react';
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

export function SalesOrderPDFButton({ order, variant = 'both' }: Props) {
  // The document itself cannot fetch, so the tax is resolved here and passed in.
  // Until it arrives the buttons stay disabled rather than rendering a PDF with
  // zeroes on it — a customer-facing document with a wrong tax line is worse than
  // a button that is briefly not ready.
  const { tax, isPending } = useTaxPreview(Number(order.total_amount), {
    partyId: order.customer_id ?? null,
  });

  const doc = <SalesOrderPDF order={order} tax={tax} />;
  const fileName = `Pedido-${order.order_number}.pdf`;

  if (isPending) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-xs text-gray-400">…</span>
      </div>
    );
  }

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
