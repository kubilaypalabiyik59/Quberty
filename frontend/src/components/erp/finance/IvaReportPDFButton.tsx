'use client';

import dynamic from 'next/dynamic';
import { Download } from 'lucide-react';
import { IvaReportPDF } from './IvaReportPDF';

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(m => m.PDFDownloadLink),
  { ssr: false }
);

interface Props {
  facturas: any[];
  totals: any;
  year: number;
  month: number;
}

export function IvaReportPDFButton({ facturas, totals, year, month }: Props) {
  const fileName = `Libro-Ventas-${year}-${String(month).padStart(2, '0')}.pdf`;
  const doc = <IvaReportPDF facturas={facturas} totals={totals} year={year} month={month} />;

  return (
    // @ts-ignore
    <PDFDownloadLink document={doc} fileName={fileName}>
      {({ loading }: { loading: boolean }) => (
        <button
          disabled={loading}
          className="flex items-center gap-2 bg-gray-900 hover:bg-gray-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Download className="h-4 w-4" />
          {loading ? 'Generating...' : 'Export PDF'}
        </button>
      )}
    </PDFDownloadLink>
  );
}
