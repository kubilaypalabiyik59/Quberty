import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 8,
    paddingTop: 32,
    paddingBottom: 44,
    paddingHorizontal: 32,
    color: '#111827',
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#111827',
  },
  companyName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 2 },
  companyTag: { fontSize: 7, color: '#6b7280' },
  reportBox: {
    backgroundColor: '#111827',
    color: '#ffffff',
    padding: 8,
    borderRadius: 4,
    alignItems: 'center',
    minWidth: 140,
  },
  reportLabel: { fontSize: 6, color: '#9ca3af', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 3 },
  reportPeriod: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#ffffff' },

  // Summary row
  summaryRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  summaryCard: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderRadius: 4,
    padding: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
  },
  summaryLabel: { fontSize: 6.5, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 3 },
  summaryValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#111827' },

  // Table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderRadius: 3,
    paddingVertical: 5,
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  thText: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: '#ffffff', textTransform: 'uppercase', letterSpacing: 0.5 },
  tdText: { fontSize: 7.5, color: '#374151' },
  tdMono: { fontSize: 7, color: '#6b7280', fontFamily: 'Helvetica' },

  // Column widths
  colNum:      { width: 50 },
  colDate:     { width: 56 },
  colClient:   { flex: 1 },
  colNit:      { width: 70 },
  colAmount:   { width: 72, alignItems: 'flex-end' },

  // Totals
  totalsSection: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  totalsBox: {
    width: 260,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 4,
    overflow: 'hidden',
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  totalsRowFinal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  totalsLabel: { fontSize: 8, color: '#374151' },
  totalsValue: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: '#111827' },
  totalsFinalLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  totalsFinalValue: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#ffffff' },

  footer: {
    position: 'absolute',
    bottom: 18,
    left: 32,
    right: 32,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 6,
  },
  footerText: { fontSize: 6.5, color: '#9ca3af' },
  pageNum: { fontSize: 6.5, color: '#9ca3af' },
});

function fmt(n: number) {
  return `Bs. ${Number(n).toFixed(2)}`;
}

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface Factura {
  id: string;
  factura_number: number;
  invoice_date: string;
  customer_name: string;
  customer_nit?: string;
  subtotal: number;
  iva_amount: number;
  it_amount: number;
  total_amount: number;
  status: string;
}

interface Totals {
  subtotal: number;
  iva: number;
  it: number;
  total: number;
}

interface Props {
  facturas: Factura[];
  totals: Totals;
  year: number;
  month: number;
}

export function IvaReportPDF({ facturas, totals, year, month }: Props) {
  const period = `${MONTHS[month - 1]} ${year}`;

  return (
    <Document title={`Libro-de-Ventas-${year}-${String(month).padStart(2, '0')}`}>
      <Page size="A4" orientation="landscape" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>Quberty ERP — Libro de Ventas</Text>
            <Text style={styles.companyTag}>IVA Débito Fiscal — Ley 843 Bolivia</Text>
          </View>
          <View style={styles.reportBox}>
            <Text style={styles.reportLabel}>Período</Text>
            <Text style={styles.reportPeriod}>{period}</Text>
          </View>
        </View>

        {/* Summary cards */}
        <View style={styles.summaryRow}>
          {[
            { label: 'Subtotal Neto', value: fmt(totals.subtotal) },
            { label: 'IVA Débito Fiscal 13%', value: fmt(totals.iva) },
            { label: 'IT 3% sobre Subtotal', value: fmt(totals.it) },
            { label: 'Total Facturado', value: fmt(totals.total) },
            { label: 'Facturas Emitidas', value: String(facturas.length) },
          ].map(c => (
            <View key={c.label} style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{c.label}</Text>
              <Text style={styles.summaryValue}>{c.value}</Text>
            </View>
          ))}
        </View>

        {/* Table header */}
        <View style={styles.tableHeader}>
          <View style={styles.colNum}><Text style={styles.thText}>Factura #</Text></View>
          <View style={styles.colDate}><Text style={styles.thText}>Fecha</Text></View>
          <View style={styles.colClient}><Text style={styles.thText}>Cliente</Text></View>
          <View style={styles.colNit}><Text style={styles.thText}>NIT / CI</Text></View>
          <View style={styles.colAmount}><Text style={styles.thText}>Subtotal</Text></View>
          <View style={styles.colAmount}><Text style={styles.thText}>IVA 13%</Text></View>
          <View style={styles.colAmount}><Text style={styles.thText}>IT 3%</Text></View>
          <View style={styles.colAmount}><Text style={styles.thText}>Total</Text></View>
        </View>

        {/* Rows */}
        {facturas.map((f, i) => (
          <View key={f.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
            <View style={styles.colNum}><Text style={styles.tdMono}>{String(f.factura_number).padStart(6, '0')}</Text></View>
            <View style={styles.colDate}><Text style={styles.tdText}>{fmtDate(f.invoice_date)}</Text></View>
            <View style={styles.colClient}><Text style={styles.tdText}>{f.customer_name}</Text></View>
            <View style={styles.colNit}><Text style={styles.tdMono}>{f.customer_nit ?? 'CF'}</Text></View>
            <View style={styles.colAmount}><Text style={styles.tdText}>{fmt(Number(f.subtotal))}</Text></View>
            <View style={styles.colAmount}><Text style={styles.tdText}>{fmt(Number(f.iva_amount))}</Text></View>
            <View style={styles.colAmount}><Text style={styles.tdText}>{fmt(Number(f.it_amount))}</Text></View>
            <View style={styles.colAmount}><Text style={{ ...styles.tdText, fontFamily: 'Helvetica-Bold' }}>{fmt(Number(f.total_amount))}</Text></View>
          </View>
        ))}

        {facturas.length === 0 && (
          <View style={{ paddingVertical: 20, alignItems: 'center' }}>
            <Text style={{ color: '#9ca3af', fontSize: 9 }}>No hay facturas emitidas para este período.</Text>
          </View>
        )}

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal Neto</Text>
              <Text style={styles.totalsValue}>{fmt(totals.subtotal)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>IVA Débito Fiscal (13%)</Text>
              <Text style={styles.totalsValue}>{fmt(totals.iva)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>IT 3%</Text>
              <Text style={styles.totalsValue}>{fmt(totals.it)}</Text>
            </View>
            <View style={styles.totalsRowFinal}>
              <Text style={styles.totalsFinalLabel}>TOTAL PERÍODO</Text>
              <Text style={styles.totalsFinalValue}>{fmt(totals.total)}</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Quberty ERP • Libro de Ventas {period} • Generado {new Date().toLocaleDateString('es-BO')}</Text>
          <Text render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} style={styles.pageNum} />
        </View>

      </Page>
    </Document>
  );
}
