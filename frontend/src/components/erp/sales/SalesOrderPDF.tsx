import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer';

const STATUS_ES: Record<string, string> = {
  DRAFT: 'Borrador', CONFIRMED: 'Confirmado', PICKING: 'En Preparación',
  PACKED: 'Empacado', SHIPPED: 'Enviado', COMPLETED: 'Completado', CANCELLED: 'Cancelado',
};

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 9,
    paddingTop: 36,
    paddingBottom: 48,
    paddingHorizontal: 40,
    color: '#111827',
    backgroundColor: '#ffffff',
  },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18, paddingBottom: 14, borderBottomWidth: 2, borderBottomColor: '#111827' },
  companyName: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 3 },
  companyTag: { fontSize: 8, color: '#6b7280' },

  orderBox: { backgroundColor: '#111827', padding: 10, borderRadius: 4, alignItems: 'center', minWidth: 140 },
  orderLabel: { fontSize: 7, color: '#9ca3af', letterSpacing: 1.5, marginBottom: 4 },
  orderNumber: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  orderStatus: { fontSize: 7, color: '#d1fae5', marginTop: 4, letterSpacing: 0.5 },

  metaRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  metaCard: { flex: 1, backgroundColor: '#f9fafb', borderRadius: 4, padding: 9, borderWidth: 1, borderColor: '#e5e7eb' },
  metaLabel: { fontSize: 7, color: '#9ca3af', letterSpacing: 1, marginBottom: 3 },
  metaValue: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: '#111827' },
  metaValueSm: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#111827' },

  sectionTitle: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#6b7280', letterSpacing: 1, marginBottom: 5, marginTop: 4 },

  tableHeader: { flexDirection: 'row', backgroundColor: '#111827', borderRadius: 3, paddingVertical: 5, paddingHorizontal: 6, marginBottom: 0 },
  tableRow: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  tableRowAlt: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 6, backgroundColor: '#f9fafb', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  thText: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#ffffff', letterSpacing: 0.5 },
  tdText: { fontSize: 8.5, color: '#374151' },
  tdMono: { fontSize: 7.5, color: '#6b7280' },
  tdBold: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: '#111827' },

  colIdx:   { width: 22 },
  colSku:   { width: 78 },
  colName:  { flex: 1 },
  colQty:   { width: 36, alignItems: 'flex-end' },
  colPrice: { width: 70, alignItems: 'flex-end' },
  colDisc:  { width: 44, alignItems: 'flex-end' },
  colTotal: { width: 76, alignItems: 'flex-end' },

  totalsBlock: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  totalsInner: { width: 240 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  totalsLabel: { fontSize: 8.5, color: '#374151' },
  totalsValue: { fontSize: 8.5, color: '#374151' },
  totalsRowFinal: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#111827', borderRadius: 4, paddingVertical: 9, paddingHorizontal: 10, marginTop: 4 },
  totalsFinalLabel: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  totalsFinalValue: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: '#ffffff' },

  notesBox: { marginTop: 14, padding: 9, backgroundColor: '#f9fafb', borderRadius: 4, borderWidth: 1, borderColor: '#e5e7eb' },
  notesLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#6b7280', letterSpacing: 1, marginBottom: 3 },
  notesText: { fontSize: 8.5, color: '#374151', lineHeight: 1.4 },

  footer: { position: 'absolute', bottom: 20, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 6 },
  footerText: { fontSize: 7, color: '#9ca3af' },
});

function fmt(n: number) { return `Bs. ${Number(n).toFixed(2)}`; }
function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface OrderLine {
  id: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  line_total: number;
  product: { name: string; sku: string };
  variant?: { sku_variant: string; attributes?: any } | null;
}

interface SalesOrderPDFProps {
  order: {
    order_number: string;
    status: string;
    created_at: string;
    notes?: string;
    total_amount: number;
    customer?: { first_name: string; last_name: string; code?: string; email?: string } | null;
    lines: OrderLine[];
  };
}

function variantLabel(line: OrderLine): string {
  if (!line.variant) return '';
  if (line.variant.attributes && typeof line.variant.attributes === 'object') {
    const vals = Object.values(line.variant.attributes as Record<string, string>);
    if (vals.length) return ` (${vals.join(' / ')})`;
  }
  return ` (${line.variant.sku_variant})`;
}

export function SalesOrderPDF({ order }: SalesOrderPDFProps) {
  const total    = Number(order.total_amount);
  const subtotal = total / 1.13;
  const iva      = total - subtotal;
  const it       = subtotal * 0.03;
  const customerName = order.customer
    ? `${order.customer.first_name} ${order.customer.last_name}`.trim()
    : 'Walk-in Customer';

  return (
    <Document title={`Pedido-${order.order_number}`}>
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.companyName}>Quberty ERP</Text>
            <Text style={styles.companyTag}>Pedido de Venta</Text>
          </View>
          <View style={styles.orderBox}>
            <Text style={styles.orderLabel}>PEDIDO</Text>
            <Text style={styles.orderNumber}>{order.order_number}</Text>
            <Text style={styles.orderStatus}>{STATUS_ES[order.status] ?? order.status}</Text>
          </View>
        </View>

        {/* Meta cards */}
        <View style={styles.metaRow}>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>FECHA</Text>
            <Text style={styles.metaValue}>{fmtDate(order.created_at)}</Text>
          </View>
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>CLIENTE</Text>
            <Text style={styles.metaValueSm}>{customerName}</Text>
            {order.customer?.code && <Text style={{ fontSize: 7, color: '#9ca3af', marginTop: 1 }}>{order.customer.code}</Text>}
          </View>
          {order.customer?.email && (
            <View style={styles.metaCard}>
              <Text style={styles.metaLabel}>EMAIL</Text>
              <Text style={{ fontSize: 8, color: '#374151' }}>{order.customer.email}</Text>
            </View>
          )}
          <View style={styles.metaCard}>
            <Text style={styles.metaLabel}>ESTADO</Text>
            <Text style={styles.metaValue}>{STATUS_ES[order.status] ?? order.status}</Text>
          </View>
        </View>

        {/* Items table */}
        <Text style={styles.sectionTitle}>LÍNEAS DE PEDIDO</Text>
        <View style={styles.tableHeader}>
          <View style={styles.colIdx}><Text style={styles.thText}>#</Text></View>
          <View style={styles.colSku}><Text style={styles.thText}>SKU</Text></View>
          <View style={styles.colName}><Text style={styles.thText}>Descripción</Text></View>
          <View style={styles.colQty}><Text style={styles.thText}>Cant.</Text></View>
          <View style={styles.colPrice}><Text style={styles.thText}>P. Unit.</Text></View>
          <View style={styles.colDisc}><Text style={styles.thText}>Dscto.</Text></View>
          <View style={styles.colTotal}><Text style={styles.thText}>Total</Text></View>
        </View>

        {order.lines.map((line, i) => (
          <View key={line.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
            <View style={styles.colIdx}><Text style={styles.tdMono}>{i + 1}</Text></View>
            <View style={styles.colSku}><Text style={styles.tdMono}>{line.product.sku}</Text></View>
            <View style={styles.colName}>
              <Text style={styles.tdText}>{line.product.name}{variantLabel(line)}</Text>
            </View>
            <View style={styles.colQty}><Text style={{ ...styles.tdText, textAlign: 'right' }}>{line.quantity}</Text></View>
            <View style={styles.colPrice}><Text style={styles.tdText}>{fmt(Number(line.unit_price))}</Text></View>
            <View style={styles.colDisc}>
              <Text style={styles.tdMono}>{Number(line.discount_pct) > 0 ? `${Number(line.discount_pct).toFixed(0)}%` : '—'}</Text>
            </View>
            <View style={styles.colTotal}><Text style={styles.tdBold}>{fmt(Number(line.line_total))}</Text></View>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalsInner}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal (sin IVA)</Text>
              <Text style={styles.totalsValue}>{fmt(subtotal)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>IVA 13%</Text>
              <Text style={styles.totalsValue}>{fmt(iva)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>IT 3%</Text>
              <Text style={styles.totalsValue}>{fmt(it)}</Text>
            </View>
            <View style={styles.totalsRowFinal}>
              <Text style={styles.totalsFinalLabel}>TOTAL</Text>
              <Text style={styles.totalsFinalValue}>{fmt(total)}</Text>
            </View>
          </View>
        </View>

        {order.notes && (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>NOTAS</Text>
            <Text style={styles.notesText}>{order.notes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Quberty ERP • Pedido {order.order_number}</Text>
          <Text style={styles.footerText}>Generado el {new Date().toLocaleDateString('es-BO')}</Text>
        </View>
      </Page>
    </Document>
  );
}
