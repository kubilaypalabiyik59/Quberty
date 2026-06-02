import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    paddingTop: 36,
    paddingBottom: 52,
    paddingHorizontal: 40,
    color: '#111827',
    backgroundColor: '#ffffff',
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: '#111827',
  },
  companyName: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 3 },
  companyTag: { fontSize: 8, color: '#6b7280' },
  facturaBox: {
    backgroundColor: '#111827',
    padding: 10,
    borderRadius: 4,
    alignItems: 'center',
    minWidth: 120,
  },
  facturaLabel: { fontSize: 7, color: '#9ca3af', letterSpacing: 1.5, marginBottom: 4 },
  facturaNumber: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  facturaStatus: { fontSize: 7, color: '#9ca3af', marginTop: 3 },

  // Meta grid
  metaRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  metaCard: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderRadius: 4,
    padding: 9,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  metaLabel: { fontSize: 7, color: '#9ca3af', letterSpacing: 1, marginBottom: 3 },
  metaValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#111827' },

  // Section title
  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#6b7280',
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 2,
  },

  // Items table
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderRadius: 3,
    paddingVertical: 5,
    paddingHorizontal: 6,
    marginBottom: 0,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  tableRowAlt: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    backgroundColor: '#f9fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  thText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#ffffff', letterSpacing: 0.5 },
  tdText: { fontSize: 8.5, color: '#374151' },
  tdMono: { fontSize: 7.5, color: '#6b7280' },
  tdBold: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#111827' },

  // Column widths
  colIdx:    { width: 22 },
  colSku:    { width: 80 },
  colName:   { flex: 1 },
  colQty:    { width: 36, alignItems: 'flex-end' },
  colPrice:  { width: 70, alignItems: 'flex-end' },
  colDisc:   { width: 44, alignItems: 'flex-end' },
  colTotal:  { width: 75, alignItems: 'flex-end' },

  // Tax summary
  taxBlock: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  taxInner: { width: 240 },
  taxRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  taxLabel: { fontSize: 8.5, color: '#374151' },
  taxValue: { fontSize: 8.5, color: '#374151' },
  taxRowTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderRadius: 4,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  taxTotalLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  taxTotalValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#ffffff' },

  // IVA note
  ivaNote: {
    marginTop: 12,
    backgroundColor: '#eff6ff',
    borderRadius: 4,
    padding: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  ivaNoteTitle: { fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#1d4ed8', marginBottom: 3 },
  ivaNoteText: { fontSize: 7.5, color: '#1d4ed8', lineHeight: 1.5 },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 22,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 7,
  },
  footerText: { fontSize: 7, color: '#9ca3af' },
});

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface LineItem {
  id: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  line_total: number;
  product: { name: string; sku: string };
  variant?: { sku_variant: string; attributes?: any } | null;
}

interface InvoiceMetadata {
  vat_label?: string;
  secondary_tax_name?: string;
  invoice_label?: string;
  currency_code?: string;
}

interface Factura {
  factura_number: number;
  invoice_date: string;
  customer_name: string;
  customer_nit?: string;
  subtotal: number;
  iva_amount: number;
  it_amount: number;
  total_amount: number;
  status: string;
  notes?: string;
  source_type?: string;
  lines?: LineItem[];
  invoice_metadata?: InvoiceMetadata | null;
}

function variantLabel(line: LineItem): string {
  if (!line.variant) return '';
  if (line.variant.attributes && typeof line.variant.attributes === 'object') {
    const vals = Object.values(line.variant.attributes as Record<string, string>);
    if (vals.length > 0) return ` (${vals.join(' / ')})`;
  }
  return ` (${line.variant.sku_variant})`;
}

export function FacturaPDF({ factura }: { factura: Factura }) {
  const subtotal = Number(factura.subtotal);
  const iva = Number(factura.iva_amount);
  const it = Number(factura.it_amount);
  const total = Number(factura.total_amount);
  const lines = factura.lines ?? [];

  const invoiceLabel      = factura.invoice_metadata?.invoice_label      ?? 'Factura';
  const vatLabel          = factura.invoice_metadata?.vat_label          ?? 'IVA';
  const secondaryTaxName  = factura.invoice_metadata?.secondary_tax_name ?? 'IT';
  const currencyCode      = factura.invoice_metadata?.currency_code      ?? 'BOB';

  function fmtAmt(n: number) {
    return `${currencyCode} ${Number(n).toFixed(2)}`;
  }

  return (
    <Document title={`${invoiceLabel}-${String(factura.factura_number).padStart(6, '0')}`}>
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>Quberty ERP</Text>
            <Text style={styles.companyTag}>Sistema de Gestión Empresarial — Bolivia</Text>
          </View>
          <View style={styles.facturaBox}>
            <Text style={styles.facturaLabel}>{invoiceLabel.toUpperCase()}</Text>
            <Text style={styles.facturaNumber}>N° {String(factura.factura_number).padStart(6, '0')}</Text>
            <Text style={styles.facturaStatus}>{factura.status}</Text>
          </View>
        </View>

        {/* Meta cards */}
        <View style={styles.metaRow}>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>FECHA DE EMISIÓN</Text>
            <Text style={styles.metaValue}>{fmtDate(factura.invoice_date)}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>CLIENTE</Text>
            <Text style={styles.metaValue}>{factura.customer_name}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>NIT / CI</Text>
            <Text style={styles.metaValue}>{factura.customer_nit ?? 'CF'}</Text>
          </View>
        </View>

        {factura.notes && (
          <View style={{ marginBottom: 10 }}>
            <Text style={{ fontSize: 8, color: '#6b7280' }}>Notas: {factura.notes}</Text>
          </View>
        )}

        {/* Items table */}
        <Text style={styles.sectionTitle}>DETALLE DE ARTÍCULOS</Text>

        {/* Table header */}
        <View style={styles.tableHeader}>
          <View style={styles.colIdx}><Text style={styles.thText}>#</Text></View>
          <View style={styles.colSku}><Text style={styles.thText}>SKU</Text></View>
          <View style={styles.colName}><Text style={styles.thText}>Descripción</Text></View>
          <View style={styles.colQty}><Text style={styles.thText}>Cant.</Text></View>
          <View style={styles.colPrice}><Text style={styles.thText}>P. Unitario</Text></View>
          <View style={styles.colDisc}><Text style={styles.thText}>Dscto.</Text></View>
          <View style={styles.colTotal}><Text style={styles.thText}>Total</Text></View>
        </View>

        {/* Line rows */}
        {lines.length > 0 ? lines.map((line, i) => (
          <View key={line.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
            <View style={styles.colIdx}>
              <Text style={styles.tdMono}>{i + 1}</Text>
            </View>
            <View style={styles.colSku}>
              <Text style={styles.tdMono}>{line.product.sku}</Text>
            </View>
            <View style={styles.colName}>
              <Text style={styles.tdText}>
                {line.product.name}{variantLabel(line)}
              </Text>
            </View>
            <View style={styles.colQty}>
              <Text style={styles.tdText}>{line.quantity}</Text>
            </View>
            <View style={styles.colPrice}>
              <Text style={styles.tdText}>{fmtAmt(Number(line.unit_price))}</Text>
            </View>
            <View style={styles.colDisc}>
              <Text style={styles.tdMono}>
                {Number(line.discount_pct) > 0 ? `${Number(line.discount_pct).toFixed(0)}%` : '—'}
              </Text>
            </View>
            <View style={styles.colTotal}>
              <Text style={styles.tdBold}>{fmtAmt(Number(line.line_total))}</Text>
            </View>
          </View>
        )) : (
          // Manual factura — no line items
          <View style={styles.tableRow}>
            <View style={styles.colIdx}><Text style={styles.tdMono}>1</Text></View>
            <View style={styles.colSku}><Text style={styles.tdMono}>—</Text></View>
            <View style={{ ...styles.colName }}>
              <Text style={styles.tdText}>Venta de Mercaderías</Text>
            </View>
            <View style={styles.colQty}><Text style={styles.tdText}>1</Text></View>
            <View style={styles.colPrice}><Text style={styles.tdText}>{fmtAmt(total)}</Text></View>
            <View style={styles.colDisc}><Text style={styles.tdMono}>—</Text></View>
            <View style={styles.colTotal}><Text style={styles.tdBold}>{fmtAmt(total)}</Text></View>
          </View>
        )}

        {/* Tax summary (right-aligned) */}
        <View style={styles.taxBlock}>
          <View style={styles.taxInner}>
            <View style={styles.taxRow}>
              <Text style={styles.taxLabel}>Subtotal (sin {vatLabel})</Text>
              <Text style={styles.taxValue}>{fmtAmt(subtotal)}</Text>
            </View>
            <View style={styles.taxRow}>
              <Text style={styles.taxLabel}>{vatLabel} 13% (incluido en precio)</Text>
              <Text style={styles.taxValue}>{fmtAmt(iva)}</Text>
            </View>
            {secondaryTaxName !== '' && (
              <View style={styles.taxRow}>
                <Text style={styles.taxLabel}>{secondaryTaxName} 3% (Impuesto a las Transacciones)</Text>
                <Text style={styles.taxValue}>{fmtAmt(it)}</Text>
              </View>
            )}
            <View style={styles.taxRowTotal}>
              <Text style={styles.taxTotalLabel}>TOTAL A PAGAR</Text>
              <Text style={styles.taxTotalValue}>{fmtAmt(total)}</Text>
            </View>
          </View>
        </View>

        {/* IVA legal note */}
        <View style={styles.ivaNote}>
          <Text style={styles.ivaNoteTitle}>Nota Fiscal — Ley 843 Bolivia</Text>
          <Text style={styles.ivaNoteText}>
            El IVA está incluido en el precio de venta (Art. 3 Ley 843). La alícuota aplicada es del 13% sobre el precio total.
            {'\n'}El IT del 3% se aplica sobre el monto neto de la transacción (subtotal sin IVA).
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Quberty ERP • Sistema de Facturación Bolivia</Text>
          <Text style={styles.footerText}>{invoiceLabel} N° {String(factura.factura_number).padStart(6, '0')} • {fmtDate(factura.invoice_date)}</Text>
        </View>

      </Page>
    </Document>
  );
}
