'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { NumPad } from './NumPad';
import { useMoney, currencyBlockingReason } from '@/components/CurrencyProvider';
import {
  useFacturaSequence,
  manualFacturaNumberError,
  MANUAL_FACTURA_NUMBER_MAX,
} from '@/lib/facturaNumbering';

/** One payment of the sale: a method, the amount it pays and, for cash, what was handed over. */
export interface TenderLine {
  payment_method_id: string;
  amount: number;
  tendered?: number;
}

interface Method { id: string; code: string; name: string; tender_type: string; allow_change: boolean; is_active: boolean }

interface Props {
  visible:   boolean;
  total:     number;
  onClose:   () => void;
  onConfirm: (tenders: TenderLine[], codes: string, facturaNumber?: string) => Promise<void>;
}

const ICON: Record<string, string> = { CASH: '💵', CARD: '💳', QR: '📱', TRANSFER: '🏦', VOUCHER: '🎟️' };
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

type Row = { methodId: string; amount: string; tendered: string; touched: boolean };

/**
 * Cash handed over: until the cashier keys a figure, it is the exact amount the
 * tender pays. It used to start at 0, which left CONFIRM disabled on every cash
 * sale until the cashier found the keypad — cash looked broken while card and QR
 * went straight through.
 */
const tenderedOf = (r: Row) => (r.touched ? r.tendered : r.amount);

/**
 * One-tap amounts above what the tender pays: the next round tens, fifties and
 * hundreds. Plain rounding, so it works for any currency's notes.
 */
function quickCash(amount: number): number[] {
  if (!(amount > 0)) return [];
  // A round amount rounds to itself, so it steps up instead: 100 offers 110, 150, 200.
  const ups = [10, 50, 100].map((step) => {
    const v = Math.ceil(amount / step) * step;
    return v > amount ? v : v + step;
  });
  return Array.from(new Set(ups)).sort((x, y) => x - y).slice(0, 3);
}

/**
 * Payment (WORK-047). The tenant's payment methods come from the server; a sale may
 * be split across several — e.g. part cash, part QR — as long as the parts add up to
 * the total. Only a method that gives change (cash) takes a received amount.
 */
export function PaymentModal({ visible, total, onClose, onConfirm }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [facturaNumber, setFacturaNumber] = useState('');
  const { money, code, status: currencyStatus } = useMoney();
  const currencyProblem = currencyBlockingReason(currencyStatus);

  const { data: methodsData, isLoading: methodsLoading } = useQuery({
    queryKey: ['sales-payment-methods'],
    queryFn: () => api.get('/sales/payment-methods').then((r) => r.data.data as Method[]),
    enabled: visible,
  });
  const methods = useMemo(
    () => (methodsData ?? []).filter((m) => m.is_active && m.tender_type !== 'CUSTOMER_ACCOUNT' && m.tender_type !== 'VOUCHER'),
    [methodsData],
  );
  const byId = useMemo(() => new Map(methods.map((m) => [m.id, m])), [methods]);

  // Open with one tender for the whole total, on cash when there is a cash method.
  useEffect(() => {
    if (!visible || methods.length === 0) return;
    const first = methods.find((m) => m.tender_type === 'CASH') ?? methods[0];
    setRows([{ methodId: first.id, amount: String(round2(total)), tendered: '0', touched: false }]);
    setActive(0);
    setError('');
  }, [visible, methods, total]);

  const sequence    = useFacturaSequence(visible);
  const numberError = sequence.manual === true ? manualFacturaNumberError(facturaNumber) : null;

  const paid = round2(rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0));
  const remaining = round2(total - paid);
  const rowProblem = rows.map((r) => {
    const m = byId.get(r.methodId);
    const amount = parseFloat(r.amount) || 0;
    if (!m) return 'Choose a method';
    if (amount <= 0) return 'Enter the amount';
    if (m.allow_change && (parseFloat(tenderedOf(r)) || 0) < amount) return `${m.code}: received is less than it pays`;
    return null;
  }).find(Boolean) ?? null;
  const blocked =
    methodsLoading ? 'Loading payment methods…'
    : methods.length === 0 ? 'No payment method is set up. Ask an administrator (Sales → Payment methods).'
    : remaining !== 0 ? `${remaining > 0 ? 'Still to pay' : 'Paid over the total by'} ${money(Math.abs(remaining))}`
    : rowProblem;
  const canConfirm = !blocked && sequence.status === 'ready' && numberError === null && !currencyProblem;

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function confirm() {
    if (!canConfirm) return;
    setLoading(true);
    setError('');
    try {
      const tenders: TenderLine[] = rows.map((r) => {
        const m = byId.get(r.methodId)!;
        return {
          payment_method_id: r.methodId,
          amount: round2(parseFloat(r.amount) || 0),
          ...(m.allow_change ? { tendered: round2(parseFloat(tenderedOf(r)) || 0) } : {}),
        };
      });
      await onConfirm(
        tenders,
        rows.map((r) => byId.get(r.methodId)?.code).join(' + '),
        // Omitted entirely on an automatic series — the backend rejects a
        // supplied number there rather than ignoring it.
        sequence.manual === true ? facturaNumber.trim() : undefined,
      );
      setFacturaNumber('');
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? e?.message ?? 'Payment failed');
    } finally {
      setLoading(false);
    }
  }

  if (!visible) return null;
  const activeRow = rows[active];
  const activeMethod = activeRow ? byId.get(activeRow.methodId) : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-[520px] p-6 shadow-2xl border border-slate-100 max-h-[95vh] overflow-y-auto">
        <p className="text-slate-900 font-bold text-xl mb-4">Payment</p>

        <div className="bg-indigo-600 rounded-xl p-4 text-center mb-4 shadow-lg shadow-indigo-200">
          <p className="text-indigo-200 text-xs mb-1">Total to Collect</p>
          <p className="text-white text-4xl font-black">{money(total)}</p>
        </div>

        {/* Tender rows */}
        <div className="space-y-2 mb-3">
          {rows.map((r, i) => {
            const m = byId.get(r.methodId);
            return (
              <div key={i} onClick={() => setActive(i)}
                className={`rounded-xl border p-2.5 ${i === active ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {methods.map((opt) => (
                    <button key={opt.id} type="button"
                      onClick={(e) => { e.stopPropagation(); setActive(i); setRow(i, { methodId: opt.id, tendered: '0', touched: false }); }}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
                        r.methodId === opt.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'
                      }`}>
                      {ICON[opt.tender_type] ?? '•'} {opt.code}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-16">Amount</span>
                  <input className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm" inputMode="decimal"
                    value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
                  {rows.length > 1 && (
                    <button type="button" className="text-xs text-red-500" onClick={(e) => {
                      e.stopPropagation(); setRows((rs) => rs.filter((_, j) => j !== i)); setActive(0);
                    }}>Remove</button>
                  )}
                </div>
                {m?.allow_change && (
                  <p className="text-xs text-slate-500 mt-1">
                    Received {money(parseFloat(tenderedOf(r)) || 0)} · Change{' '}
                    <strong className="text-emerald-600">{money(Math.max(0, (parseFloat(tenderedOf(r)) || 0) - (parseFloat(r.amount) || 0)))}</strong>
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {remaining > 0 && methods.length > 1 && (
          <button type="button" className="w-full mb-3 py-2 rounded-xl border border-dashed border-indigo-300 text-indigo-700 text-sm font-semibold"
            onClick={() => {
              const used = new Set(rows.map((r) => r.methodId));
              const next = methods.find((m) => !used.has(m.id)) ?? methods[0];
              setRows((rs) => [...rs, { methodId: next.id, amount: String(remaining), tendered: '0', touched: false }]);
              setActive(rows.length);
            }}>
            + Split: pay the remaining {money(remaining)} another way
          </button>
        )}

        {activeMethod?.allow_change && activeRow && (
          <div className="mb-3">
            <p className="text-slate-500 text-xs font-semibold mb-2">
              Cash received ({code}) <span className="font-normal text-slate-400">— exact amount unless you key another</span>
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button type="button"
                onClick={() => setRow(active, { tendered: '0', touched: false })}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                  !activeRow.touched ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-200'
                }`}>
                Exact {money(parseFloat(activeRow.amount) || 0)}
              </button>
              {quickCash(parseFloat(activeRow.amount) || 0).map((v) => (
                <button key={v} type="button"
                  onClick={() => setRow(active, { tendered: String(v), touched: true })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${
                    activeRow.touched && parseFloat(activeRow.tendered) === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200'
                  }`}>
                  {money(v)}
                </button>
              ))}
            </div>
            {/* An untouched field hands the keypad a 0, so the first key replaces
                the prefilled exact amount instead of appending to it. */}
            <NumPad
              value={activeRow.touched ? activeRow.tendered : '0'}
              onChange={(v) => setRow(active, { tendered: v, touched: true })}
              allowDecimal
            />
          </div>
        )}

        {sequence.manual === true && (
          <div className="mb-3">
            <p className="text-slate-500 text-xs font-semibold mb-2">
              Factura number <span className="text-red-500">*</span>
              <span className="ml-1.5 font-normal text-slate-400">from the pre-printed form</span>
            </p>
            <input
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-lg font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="A-04-0001918"
              maxLength={MANUAL_FACTURA_NUMBER_MAX}
              value={facturaNumber}
              onChange={(e) => setFacturaNumber(e.target.value)}
            />
            {facturaNumber.length > 0 && numberError && <p className="mt-1 text-red-500 text-xs">{numberError}</p>}
          </div>
        )}

        {sequence.blockingReason && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
            <p className="text-amber-800 text-sm">{sequence.blockingReason}</p>
            {sequence.status === 'error' && (
              <button onClick={() => sequence.refetch()} className="mt-1 text-xs font-semibold text-amber-900 underline">Try again</button>
            )}
          </div>
        )}
        {currencyProblem && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
            <p className="text-amber-800 text-sm">{currencyProblem}</p>
          </div>
        )}
        {blocked && <p className="text-amber-700 text-sm text-center mb-2">{blocked}</p>}
        {error && <p className="text-red-500 text-sm text-center mb-2">{error}</p>}

        <div className="flex gap-2.5 mt-2">
          <button onClick={onClose} disabled={loading}
            className="px-5 py-3.5 bg-white border border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 transition-colors">
            Cancel
          </button>
          <button onClick={confirm} disabled={!canConfirm || loading}
            className={`flex-1 py-3.5 rounded-xl font-black text-base transition-colors ${
              !canConfirm || loading ? 'bg-slate-100 text-slate-300 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200'
            }`}>
            {loading ? <span className="inline-block w-5 h-5 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" /> : 'CONFIRM SALE'}
          </button>
        </div>
      </div>
    </div>
  );
}
