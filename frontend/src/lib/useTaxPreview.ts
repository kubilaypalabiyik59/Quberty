'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * What the tax on an amount would be, according to the engine that will post it.
 *
 * ── Why a client must never work this out itself ───────────────────────────
 * Six screens each ran `total / 1.13` for IVA and `subtotal * 0.03` for IT. That
 * arithmetic is recorded as a DEFECT in `backend/src/__tests__/tax.service.test.ts`:
 * on Bs 1 299 it yields 149,44 / 38,97 where the configured engine yields
 * 168,87 / 38,97, because Bolivian IVA is *por dentro* — 13% OF the invoiced
 * amount, not 13% added to a back-computed net.
 *
 * The consequence was not cosmetic. The till, the PDF the customer keeps, the
 * factura screen and the general ledger could each describe one sale differently.
 *
 * It also hardcoded Bolivia into every client. The rates live in TaxCode rows,
 * date-effective, per tax group ∩ item tax group — so a tenant in another country,
 * or Bolivia itself after Ley 1733, is a configuration change that these screens
 * would have silently ignored.
 *
 * ── What this does not do ──────────────────────────────────────────────────
 * It previews under TODAY's tax codes. Re-displaying a document issued under an
 * older rate needs the split stored on the document itself. `Factura` stores
 * `iva_amount` / `it_amount` and its list reads them directly — do not use this
 * hook there. `SalesOrder` has a single `tax_amount` column that cannot hold a
 * split, which is why its screens preview instead, and why a tax-line table is
 * the next schema step.
 */
export interface TaxPreview {
  subtotal: number;
  vat: number;
  turnover: number;
  total: number;
  lines: Array<{ code: string; base: number; rate: number; amount: number; tax_type: string }>;
  source: 'ENGINE' | 'LEGACY';
}

export function useTaxPreview(
  amount: number,
  opts: { partyId?: string | null; productId?: string | null; side?: 'SALES' | 'PURCHASE'; enabled?: boolean } = {},
) {
  const { partyId = null, productId = null, side = 'SALES', enabled = true } = opts;
  const valid = Number.isFinite(amount) && amount > 0;

  const q = useQuery({
    queryKey: ['tax-preview', amount, partyId, productId, side],
    enabled: enabled && valid,
    // The answer depends on TaxCode rows, which change on the order of years, and
    // on nothing the user is typing. Re-asking on every keystroke would be a
    // request per character for a figure that does not move.
    staleTime: 5 * 60_000,
    queryFn: () =>
      api
        .get('/finance/tax/preview', {
          params: {
            amount,
            ...(partyId ? { party_id: partyId } : {}),
            ...(productId ? { product_id: productId } : {}),
            side,
          },
        })
        .then((r) => r.data.data as TaxPreview),
  });

  return {
    ...q,
    /**
     * Zeroes while loading rather than a guess. A wrong tax figure that looks
     * settled is worse than a blank one — this is what the customer is shown.
     */
    tax: q.data ?? { subtotal: 0, vat: 0, turnover: 0, total: amount || 0, lines: [], source: 'ENGINE' as const },
  };
}
