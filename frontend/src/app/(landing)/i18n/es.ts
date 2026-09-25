import type { LandingDictionary } from './types';

/** Spanish landing copy. Generated from docs/design/QUBERTY_LANDING_2026-09-25.md §6. */
export const es: LandingDictionary = {
  meta: {
    title: 'Quberty ERP — un solo sistema para todo tu negocio',
    description:
      'Ventas, compras, inventario, almacén y finanzas en un solo lugar, con un punto de venta y una tienda online que escriben en los mismos libros. Pensado para empresas de 5 a 50 personas.',
  },
  nav: { product: 'Producto', capabilities: 'Funciones', how: 'Cómo funciona', signIn: 'Iniciar sesión', demo: 'Solicitar una demo', languageLabel: 'Idioma' },
  hero: {
    eyebrow: 'ERP para empresas en crecimiento',
    title: 'Gestiona todo tu negocio en un solo sistema.',
    subtitle:
      'Quberty reúne ventas, compras, inventario, almacén y finanzas — con un punto de venta y una tienda online que escriben en los mismos libros. Para equipos de 5 a 50 personas.',
    primary: 'Solicitar una demo',
    secondary: 'Ver cómo funciona',
    proof: ['Un solo stock en todas tus tiendas', 'Libros que se cierran solos', 'En marcha en días, no en meses'],
  },
  problem: {
    title: '¿Te suena?',
    intro: 'La mayoría de las empresas en crecimiento funciona con un parche que servía con cinco personas y se rompe con veinte.',
    items: [
      { title: 'Hojas de cálculo por todas partes', body: 'Pedidos en un archivo, stock en otro, precios en la cabeza de alguien. Cada informe empieza con copiar y pegar.' },
      { title: 'Un stock en el que no confías', body: 'El estante dice una cosa, el sistema otra, y la tienda online vende lo que ya no tienes.' },
      { title: 'Cierres de mes que duran semanas', body: 'El contador reconstruye los libros a partir de recibos porque ventas y compras nunca llegaron bien a ellos.' },
    ],
  },
  oneSystem: {
    title: 'Un solo sistema. Todos los canales.',
    intro: 'Tu oficina, tus tiendas, tu tienda online y tu almacén — trabajando con los mismos datos, en tiempo real.',
    tiles: [
      { title: 'Oficina', body: 'Ventas, compras, finanzas y personal.' },
      { title: 'Punto de venta', body: 'Una caja rápida para cada tienda.' },
      { title: 'Tienda online', body: 'Vende online con el mismo catálogo y el mismo stock.' },
      { title: 'Almacén', body: 'Recibe, ubica, prepara y envía con trabajo guiado.' },
    ],
    ledgerLine: 'Cada venta, recepción y pago llega al mismo stock y a los mismos libros — sin exportar, sin volver a teclear.',
  },
  capabilities: {
    title: 'Todo lo que necesitas. Nada que sobre.',
    intro: 'El núcleo de un ERP serio, pensado para una empresa que no tiene departamento de sistemas.',
    items: [
      { title: 'Clientes', body: 'Del primer contacto a la cotización firmada.', includes: ['Prospectos y contactos', 'Cotizaciones', 'Historial del cliente'] },
      { title: 'Ventas', body: 'Pedidos que fluyen directo al stock y a la factura.', includes: ['Pedidos de venta', 'Facturación', 'Saldos de clientes'] },
      { title: 'Compras', body: 'Compra a tiempo y al precio correcto.', includes: ['Solicitudes de compra', 'Órdenes de compra', 'Facturas de proveedor'] },
      { title: 'Almacén', body: 'Sabe dónde está cada artículo y muévelo con propósito.', includes: ['Recepción y ubicación', 'Olas de preparación', 'Ubicaciones'] },
      { title: 'Finanzas', body: 'Contabilidad de partida doble real, no un libro de caja.', includes: ['Diarios y periodos', 'Conciliación bancaria', 'Estado de resultados y balance'] },
      { title: 'Personas', body: 'Tu equipo, sus roles y sus accesos.', includes: ['Empleados', 'Roles y permisos', 'Asignación a tiendas'] },
      { title: 'Informes', body: 'Las cifras que necesitas, sin tener que construirlas.', includes: ['Panel de dirección', 'Informes de ventas y stock', 'Antigüedad de cobros y pagos'] },
      { title: 'Control', body: 'Mira quién cambió qué, y cuándo.', includes: ['Registro de auditoría completo', 'Documentos listos para aprobación', 'Importación de datos'] },
    ],
  },
  flows: {
    title: 'Cómo fluye el trabajo',
    intro: 'Cada documento sabe de dónde viene y a dónde va. Nada se escribe dos veces.',
    selling: {
      label: 'Vender',
      steps: ['Prospecto', 'Cotización', 'Pedido', 'Preparación y envío', 'Factura', 'Cobro'],
      note: 'La cotización se convierte en pedido, el pedido reserva stock y la factura se contabiliza sola.',
    },
    buying: {
      label: 'Comprar',
      steps: ['Solicitud', 'Orden de compra', 'Recepción', 'Ubicación', 'Factura de proveedor', 'Pago'],
      note: 'Pagas lo que recibes — conciliado con la orden antes de pagar la factura.',
    },
  },
  foundation: {
    title: 'Simple por fuera. Serio por dentro.',
    intro: 'Quberty es fácil para empezar y está construido sobre las mismas bases que los sistemas empresariales — para que no tengas que cambiar nunca más.',
    items: [
      { title: 'Contabilidad real', body: 'Cada operación es un asiento cuadrado en el que tu contador puede confiar.' },
      { title: 'Crece contigo', body: 'Empieza con lo que necesitas hoy; activa más cuando lo necesites, sin migraciones.' },
      { title: 'Muchas tiendas, una vista', body: 'Gestiona varias tiendas y almacenes con stock y resultados de cada uno — y del negocio entero.' },
      { title: 'Nada desaparece', body: 'Las correcciones se registran, no se borran. Siempre puedes ver qué pasó.' },
    ],
  },
  finalCta: {
    title: 'Mira Quberty con tus propios datos.',
    body: 'Agenda una demostración de 30 minutos. Te mostramos tu día en Quberty — pedidos, stock y libros.',
    primary: 'Solicitar una demo',
  },
  footer: { rights: 'Todos los derechos reservados.', signIn: 'Iniciar sesión' },
};
