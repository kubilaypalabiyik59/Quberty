import { db } from '../../infrastructure/database/client';
import { resolveAddress, addressKey, type Coords } from '../../shared/services/geocoder.service';

/**
 * The CEO dashboard's data layer.
 *
 * ## The one architectural idea, borrowed from the operations panel
 *
 * **The server sends facts. The browser derives everything time-dependent.**
 *
 * Statuses and dates go over the wire; health, progress and "how late" are
 * computed client-side from a virtual clock. Two reasons, and neither is
 * cosmetic:
 *
 *  1. A colour computed on the server is stale the moment it is sent. An order
 *     that crosses its due date at 14:00 should turn amber at 14:00, not at the
 *     next refresh.
 *  2. It makes the refresh interval a free parameter. **[OFFICIAL]** D365's own
 *     throttling makes second-by-second polling impossible against F&O; against
 *     our own database it is merely wasteful. 15 minutes reads as "live" to a
 *     CEO either way.
 *
 * So there is deliberately no `health` field below — only `started_at` and
 * `due_at`. See docs/design/CEO_DASHBOARD.md §2.
 *
 * ## Two rules this file must not break
 *
 *  - **No person is ever named.** Colour and status mark a SITUATION, never a
 *    human. A panel that assigns blame gets gamed, and then the data it draws
 *    from starts lying. There is no `assigned_to`, no `created_by`, and no
 *    per-user aggregate anywhere in this file, and there must not be one.
 *  - **No time window means no colour claim.** An order with no promised date
 *    reports `due_at: null` and renders as unknown — never as on-time. Painting
 *    it green would be the panel asserting something it cannot know.
 */

export type ProcessKey = 'order-to-cash' | 'source-to-pay';

/** One piece of work in flight. Facts only. */
export interface Agent {
  id: string;
  process: ProcessKey;
  /** Document number, e.g. SO-2026-00073 */
  label: string;
  /** Where it sits in its process chain — index into that process's stops. */
  stop: number;
  status: string;
  /** Movement window. Both may be null; the client renders that as unknown. */
  started_at: string | null;
  due_at: string | null;
  amount: number;
  /** Geography, when the document carries a warehouse to derive it from. */
  site_name: string | null;
  city: string | null;
  party: string | null;

  /**
   * The two ends of the route the work walks, as place keys into `places`.
   *
   * Both may be null — that is not a rendering bug, it is the panel refusing to
   * guess. An order with no warehouse has no origin, and a customer with no city
   * has no destination. Such work is counted in the cards and listed in the
   * table but does not appear on the map, and the map says how many it is
   * hiding. Inventing a position would be worse than omitting one.
   */
  from_key: string | null;
  to_key: string | null;
}

/** A resolved place. `source` is carried so a guess stays visibly a guess. */
export interface Place {
  key: string;
  label: string;
  lat: number;
  lng: number;
  source: Coords['source'];
  confidence?: number | null;
}

export interface ProcessSummary {
  key: ProcessKey;
  /** The delegation chain, in order. Drawn as the station strip. */
  stops: string[];
  agents: number;
  /** Count per stop, so the strip can show where work is piling up. */
  by_stop: number[];
  value: number;
}

/**
 * The chain each process walks.
 *
 * **[OFFICIAL]** the sales side mirrors D365's Document Status sequence —
 * "Confirmation → Picking List → Packing Slip → Invoice" — plus the payment step
 * that closes Order to Cash.
 * learn.microsoft.com/dynamics365/fin-ops-core/dev-itpro/data-entities/dual-write/sales-status-map
 *
 * Note Document Status alone cannot express a partial: `Partially Delivered` and
 * `Partially Invoiced` live on the finer **Processing Status** enumeration. Our
 * statuses map onto stops below; when partial handling is built, it refines the
 * stop rather than adding one.
 */
const O2C_STOPS = ['Draft', 'Confirmed', 'Shipped', 'Invoiced', 'Paid'];
const S2P_STOPS = ['Draft', 'Confirmed', 'Received', 'Invoiced', 'Paid'];

function o2cStop(o: any): number {
  if (o.paid_at) return 4;
  if (o.invoice_id || o.status === 'COMPLETED') return 3;
  if (o.shipped_at || o.status === 'SHIPPED') return 2;
  if (o.confirmed_at || o.status === 'CONFIRMED') return 1;
  return 0;
}

function s2pStop(p: any): number {
  if (p.paid_at) return 4;
  if (p.status === 'INVOICED') return 3;
  if (p.received_at) return 2;
  if (p.confirmed_at || p.status === 'CONFIRMED') return 1;
  return 0;
}

/** Statuses that mean the work has left the pipeline and should not be counted. */
const O2C_CLOSED = new Set(['CANCELLED', 'RETURNED']);
const S2P_CLOSED = new Set(['CANCELLED']);

export interface CeoSnapshot {
  read_at: string;
  processes: ProcessSummary[];
  agents: Agent[];
  /** How much of the picture is missing, stated rather than hidden. */
  coverage: {
    o2c_total: number;
    o2c_without_due_date: number;
    o2c_without_site: number;
    s2p_total: number;
    s2p_without_due_date: number;
  };
  /** Revenue by site — the geographic view, now that site is derivable. */
  by_site: { site: string; city: string | null; revenue: number; orders: number }[];
  /** Every place the agents reference, resolved to coordinates. */
  places: Place[];
  /** How many agents could not be placed, and why — stated, never hidden. */
  map_coverage: { placed: number; unplaced: number; unresolved_places: string[] };
}

export async function buildCeoSnapshot(tenantId: string): Promise<CeoSnapshot> {
  const [salesOrders, purchaseOrders] = await Promise.all([
    db.salesOrder.findMany({
      where: { tenant_id: tenantId },
      select: {
        id: true, order_number: true, status: true, total_amount: true,
        created_at: true, confirmed_at: true, shipped_at: true, completed_at: true,
        paid_at: true, invoice_id: true, requested_delivery_date: true,
        site: { select: { name: true, city: true, country: true, latitude: true, longitude: true } },
        customer: { select: { first_name: true, last_name: true, city: true, country: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 500,
    }),
    db.purchaseOrder.findMany({
      where: { tenant_id: tenantId },
      select: {
        id: true, po_number: true, status: true, total_amount: true,
        order_date: true, expected_date: true, confirmed_at: true,
        received_at: true, paid_at: true,
        site: { select: { name: true, city: true, country: true, latitude: true, longitude: true } },
        supplier: { select: { name: true, city: true, country: true } },
      },
      orderBy: { order_date: 'desc' },
      take: 500,
    }),
  ]);

  const openSales = salesOrders.filter((o) => !O2C_CLOSED.has(o.status));
  const openPurchases = purchaseOrders.filter((p) => !S2P_CLOSED.has(p.status));

  /**
   * Every place referenced, collected before anything is resolved.
   *
   * Resolution is **cache-only** — `resolveAddress(..., false)`. A dashboard
   * load must never wait on a rate-limited external service; the cache is
   * warmed deliberately by `scripts/warmGeocache.ts`. A place that is not in
   * the cache simply does not appear, and the count of what is missing is
   * returned so the screen can say so.
   */
  const wanted = new Map<string, { label: string; city?: string | null; country?: string | null; lat?: number | null; lng?: number | null }>();
  const remember = (
    label: string | null | undefined,
    city: string | null | undefined,
    country: string | null | undefined,
    lat?: number | null,
    lng?: number | null,
  ): string | null => {
    // Site coordinates set by hand win, and they key on the site itself rather
    // than its address text — that is the whole point of an override.
    if (lat != null && lng != null && label) {
      const key = `site:${label}`;
      wanted.set(key, { label, lat, lng });
      return key;
    }
    const key = addressKey({ city, country });
    if (!key) return null;
    if (!wanted.has(key)) wanted.set(key, { label: label ?? city ?? key, city, country });
    return key;
  };

  const salesEnds = openSales.map((o) => ({
    from: remember(o.site?.name, o.site?.city, o.site?.country, o.site?.latitude, o.site?.longitude),
    to: remember(null, o.customer?.city, o.customer?.country),
  }));
  const purchaseEnds = openPurchases.map((p) => ({
    from: remember(null, p.supplier?.city, p.supplier?.country),
    to: remember(p.site?.name, p.site?.city, p.site?.country, p.site?.latitude, p.site?.longitude),
  }));

  const places: Place[] = [];
  const unresolved: string[] = [];
  for (const [key, w] of wanted) {
    if (w.lat != null && w.lng != null) {
      places.push({ key, label: w.label, lat: w.lat, lng: w.lng, source: 'site' });
      continue;
    }
    const hit = await resolveAddress(tenantId, { city: w.city, country: w.country }, false);
    if (hit) {
      places.push({ key, label: w.label, lat: hit.lat, lng: hit.lng, source: hit.source, confidence: hit.confidence });
    } else {
      unresolved.push(key);
    }
  }
  const placed = new Set(places.map((p) => p.key));

  const agents: Agent[] = [
    ...openSales.map((o, i): Agent => ({
      id: o.id,
      process: 'order-to-cash',
      label: o.order_number,
      stop: o2cStop(o),
      status: o.status,
      // The window the health ratio is measured over. `created_at` is when the
      // clock started; the promise is when it should have finished.
      started_at: o.created_at?.toISOString() ?? null,
      due_at: o.requested_delivery_date?.toISOString() ?? null,
      amount: Number(o.total_amount),
      site_name: o.site?.name ?? null,
      city: o.site?.city ?? null,
      party: o.customer ? `${o.customer.first_name} ${o.customer.last_name}`.trim() : null,
      from_key: salesEnds[i].from && placed.has(salesEnds[i].from!) ? salesEnds[i].from : null,
      to_key: salesEnds[i].to && placed.has(salesEnds[i].to!) ? salesEnds[i].to : null,
    })),
    ...openPurchases.map((p, i): Agent => ({
      id: p.id,
      process: 'source-to-pay',
      label: p.po_number,
      stop: s2pStop(p),
      status: p.status,
      started_at: p.order_date?.toISOString() ?? null,
      due_at: p.expected_date?.toISOString() ?? null,
      amount: Number(p.total_amount),
      site_name: p.site?.name ?? null,
      city: p.site?.city ?? null,
      party: p.supplier?.name ?? null,
      from_key: purchaseEnds[i].from && placed.has(purchaseEnds[i].from!) ? purchaseEnds[i].from : null,
      to_key: purchaseEnds[i].to && placed.has(purchaseEnds[i].to!) ? purchaseEnds[i].to : null,
    })),
  ];

  const summarise = (key: ProcessKey, stops: string[]): ProcessSummary => {
    const mine = agents.filter((a) => a.process === key);
    const by_stop = stops.map((_, i) => mine.filter((a) => a.stop === i).length);
    return {
      key,
      stops,
      agents: mine.length,
      by_stop,
      value: mine.reduce((s, a) => s + a.amount, 0),
    };
  };

  // Revenue by site, from the derived dimension. Orders with no warehouse have
  // no site and are reported separately rather than dropped — a report that
  // silently omits 80% of its rows is worse than one that says so.
  const bySite = new Map<string, { site: string; city: string | null; revenue: number; orders: number }>();
  for (const o of salesOrders) {
    if (O2C_CLOSED.has(o.status)) continue;
    const key = o.site?.name ?? '(no site)';
    const row = bySite.get(key) ?? { site: key, city: o.site?.city ?? null, revenue: 0, orders: 0 };
    row.revenue += Number(o.total_amount);
    row.orders += 1;
    bySite.set(key, row);
  }

  return {
    read_at: new Date().toISOString(),
    processes: [summarise('order-to-cash', O2C_STOPS), summarise('source-to-pay', S2P_STOPS)],
    agents,
    coverage: {
      o2c_total: openSales.length,
      o2c_without_due_date: openSales.filter((o) => !o.requested_delivery_date).length,
      o2c_without_site: openSales.filter((o) => !o.site).length,
      s2p_total: openPurchases.length,
      s2p_without_due_date: openPurchases.filter((p) => !p.expected_date).length,
    },
    by_site: [...bySite.values()].sort((a, b) => b.revenue - a.revenue),
    places,
    map_coverage: {
      placed: agents.filter((a) => a.from_key || a.to_key).length,
      unplaced: agents.filter((a) => !a.from_key && !a.to_key).length,
      unresolved_places: unresolved,
    },
  };
}
