'use client';

import { useState } from 'react';
import { NumPad } from './NumPad';
import {
  useFacturaSequence,
  manualFacturaNumberError,
  MANUAL_FACTURA_NUMBER_MAX,
} from '@/lib/facturaNumbering';

type Method = 'CASH' | 'CARD' | 'TRANSFER';

interface Props {
  visible:   boolean;
  total:     number;
  onClose:   () => void;
  onConfirm: (method: Method, cashTendered?: number, facturaNumber?: string) => Promise<void>;
}

export function PaymentModal({ visible, total, onClose, onConfirm }: Props) {
  const [method,   setMethod]   = useState<Method>('CASH');
  const [tendered, setTendered] = useState('0');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [facturaNumber, setFacturaNumber] = useState('');

  // Asked only while the modal is open. Fail closed: CONFIRM SALE stays disabled
  // until the tenant's numbering mode is actually known, because discovering it
  // after the customer has paid is the failure this prevents.
  const sequence    = useFacturaSequence(visible);
  const numberError = sequence.manual === true ? manualFacturaNumberError(facturaNumber) : null;

  const tenderedNum = parseFloat(tendered) || 0;
  const change      = Math.max(0, tenderedNum - total);
  const cashValid   = method !== 'CASH' || tenderedNum >= total;
  const canConfirm  = cashValid && sequence.status === 'ready' && numberError === null;

  async function confirm() {
    if (!cashValid) { setError('Cash tendered must be ≥ total'); return; }
    if (numberError) { setError(numberError); return; }
    setLoading(true);
    setError('');
    try {
      await onConfirm(
        method,
        method === 'CASH' ? tenderedNum : undefined,
        // Omitted entirely on an automatic series — the backend rejects a
        // supplied number there rather than ignoring it.
        sequence.manual === true ? facturaNumber.trim() : undefined,
      );
      setTendered('0');
      setMethod('CASH');
      setFacturaNumber('');
    } catch (e: any) {
      setError(e.message ?? 'Payment failed');
    } finally {
      setLoading(false);
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-[480px] p-6 shadow-2xl border border-slate-100">
        <p className="text-slate-900 font-bold text-xl mb-4">Payment</p>

        {/* Total */}
        <div className="bg-indigo-600 rounded-xl p-4 text-center mb-4 shadow-lg shadow-indigo-200">
          <p className="text-indigo-200 text-xs mb-1">Total to Collect</p>
          <p className="text-white text-4xl font-black">Bs. {total.toFixed(2)}</p>
        </div>

        {/* Method selector */}
        <div className="flex gap-2.5 mb-4">
          {(['CASH', 'CARD', 'TRANSFER'] as Method[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMethod(m); setTendered('0'); setError(''); }}
              className={`flex-1 py-3 rounded-xl border flex flex-col items-center gap-1 transition-colors ${
                method === m
                  ? 'bg-indigo-600 border-indigo-600 shadow-md shadow-indigo-200'
                  : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
              }`}
            >
              <span className="text-2xl">{m === 'CASH' ? '💵' : m === 'CARD' ? '💳' : '🏦'}</span>
              <span className={`text-xs font-semibold ${method === m ? 'text-white' : 'text-slate-500'}`}>
                {m}
              </span>
            </button>
          ))}
        </div>

        {/* Cash numpad */}
        {method === 'CASH' && (
          <div className="mb-3">
            <p className="text-slate-500 text-xs font-semibold mb-2">Cash Received (Bs.)</p>
            <div className="bg-slate-50 border border-slate-200 rounded-xl py-3.5 text-center mb-2">
              <p className="text-slate-900 text-2xl font-bold">Bs. {tendered}</p>
            </div>
            <NumPad value={tendered} onChange={setTendered} allowDecimal />
            <div className="flex justify-between items-center px-1">
              <p className="text-slate-500 text-sm">Change Due</p>
              <p className={`text-lg font-bold ${change > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                Bs. {change.toFixed(2)}
              </p>
            </div>
          </div>
        )}

        {method !== 'CASH' && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-center mb-3">
            <p className="text-indigo-700 text-sm leading-relaxed">
              {method === 'CARD'
                ? `Confirm card/POS terminal payment of Bs. ${total.toFixed(2)}`
                : `Confirm bank transfer of Bs. ${total.toFixed(2)}`}
            </p>
          </div>
        )}

        {/* The legal number, when a person supplies it from pre-printed stock. */}
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
            {facturaNumber.length > 0 && numberError && (
              <p className="mt-1 text-red-500 text-xs">{numberError}</p>
            )}
          </div>
        )}

        {/* Fail closed: the till must not guess the numbering mode. */}
        {sequence.blockingReason && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
            <p className="text-amber-800 text-sm">{sequence.blockingReason}</p>
            {sequence.status === 'error' && (
              <button
                onClick={() => sequence.refetch()}
                className="mt-1 text-xs font-semibold text-amber-900 underline"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {error && <p className="text-red-500 text-sm text-center mb-2">{error}</p>}

        <div className="flex gap-2.5 mt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-5 py-3.5 bg-white border border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!canConfirm || loading}
            className={`flex-1 py-3.5 rounded-xl font-black text-base transition-colors ${
              !canConfirm || loading
                ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200'
            }`}
          >
            {loading ? (
              <span className="inline-block w-5 h-5 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
            ) : (
              'CONFIRM SALE'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
