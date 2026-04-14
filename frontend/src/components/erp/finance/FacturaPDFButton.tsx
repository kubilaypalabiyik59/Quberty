'use client';

import dynamic from 'next/dynamic';
import { FileText, Eye } from 'lucide-react';

// Dynamically imported to prevent SSR issues with @react-pdf/renderer
const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(m => m.PDFDownloadLink),
  { ssr: false }
);

const BlobProvider = dynamic(
  () => import('@react-pdf/renderer').then(m => m.BlobProvider),
  { ssr: false }
);

// FacturaPDF is also dynamic since it imports from @react-pdf/renderer
import { FacturaPDF } from './FacturaPDF';

interface Props {
  factura: any;
  variant?: 'download' | 'view' | 'both';
}

export function FacturaPDFButton({ factura, variant = 'both' }: Props) {
  const doc = <FacturaPDF factura={factura} />;
  const fileName = `Factura-${String(factura.factura_number).padStart(6, '0')}.pdf`;

  return (
    <div className="flex items-center gap-1">
      {(variant === 'view' || variant === 'both') && (
        // @ts-ignore — BlobProvider is dynamically loaded
        <BlobProvider document={doc}>
          {({ url, loading }: { url: string | null; loading: boolean }) => (
            <button
              onClick={() => url && window.open(url, '_blank')}
              disabled={loading || !url}
              title="View PDF"
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
              title="Download PDF"
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
