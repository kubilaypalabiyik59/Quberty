'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

// ── Country → preset mapping ──────────────────────────────────────────────────

const COUNTRIES = [
  { code: 'BO', name: 'Bolivia',        flag: '🇧🇴', preset: 'bolivia-pcg'  },
  { code: 'TR', name: 'Turkey',         flag: '🇹🇷', preset: 'turkey-tdhp'  },
  { code: 'US', name: 'United States',  flag: '🇺🇸', preset: 'generic-ifrs' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', preset: 'generic-ifrs' },
  { code: 'DE', name: 'Germany',        flag: '🇩🇪', preset: 'generic-ifrs' },
  { code: 'FR', name: 'France',         flag: '🇫🇷', preset: 'generic-ifrs' },
  { code: 'ES', name: 'Spain',          flag: '🇪🇸', preset: 'generic-ifrs' },
  { code: 'MX', name: 'Mexico',         flag: '🇲🇽', preset: 'generic-ifrs' },
  { code: 'AR', name: 'Argentina',      flag: '🇦🇷', preset: 'generic-ifrs' },
  { code: 'BR', name: 'Brazil',         flag: '🇧🇷', preset: 'generic-ifrs' },
  { code: 'CO', name: 'Colombia',       flag: '🇨🇴', preset: 'generic-ifrs' },
  { code: 'PE', name: 'Peru',           flag: '🇵🇪', preset: 'generic-ifrs' },
  { code: 'NL', name: 'Netherlands',    flag: '🇳🇱', preset: 'generic-ifrs' },
  { code: 'OTHER', name: 'Other',       flag: '🌍', preset: 'generic-ifrs' },
];

const PRESETS: Record<string, {
  label: string; currency: string; vatRate: number; vatLabel: string;
  vatInclusive: boolean; secRate: number; secLabel: string; invLabel: string;
}> = {
  'bolivia-pcg': {
    label: 'Bolivia PCG', currency: 'BOB', vatRate: 13, vatLabel: 'IVA',
    vatInclusive: true, secRate: 3, secLabel: 'IT', invLabel: 'Factura',
  },
  'turkey-tdhp': {
    label: 'Turkey TDHP', currency: 'TRY', vatRate: 20, vatLabel: 'KDV',
    vatInclusive: false, secRate: 0, secLabel: '', invLabel: 'Fatura',
  },
  'generic-ifrs': {
    label: 'Generic / IFRS', currency: 'USD', vatRate: 0, vatLabel: 'VAT',
    vatInclusive: false, secRate: 0, secLabel: '', invLabel: 'Invoice',
  },
};

const WAREHOUSE_TYPES = [
  { value: 'standard', label: 'Standard',    icon: '🏭', desc: 'General-purpose storage & distribution' },
  { value: 'retail',   label: 'Retail Store', icon: '🏪', desc: 'Point-of-sale floor + back room'       },
  { value: 'cold',     label: 'Cold Storage', icon: '❄️',  desc: 'Temperature-controlled goods'         },
];

const STEPS = ['Business', 'Tax & Currency', 'Chart of Accounts', 'Warehouse', 'Finish'];

// ── Component ─────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep]   = useState(0);
  const [busy, setBusy]   = useState(false);
  const [msg,  setMsg]    = useState('');
  const [done, setDone]   = useState(false);

  // Step 0 — Business
  const [bizName,  setBizName]  = useState('');
  const [country,  setCountry]  = useState('');

  // Step 1 — Tax & Currency (auto-filled from preset)
  const [currency, setCurrency] = useState('USD');
  const [vatRate,  setVatRate]  = useState('0');
  const [vatLabel, setVatLabel] = useState('VAT');
  const [vatInc,   setVatInc]   = useState(false);
  const [secRate,  setSecRate]  = useState('0');
  const [secLabel, setSecLabel] = useState('');
  const [invLabel, setInvLabel] = useState('Invoice');

  // Step 2 — CoA template (auto-filled from preset)
  const [coaTemplate, setCoaTemplate] = useState('');

  // Step 3 — Warehouse
  const [whName,    setWhName]    = useState('');
  const [whCity,    setWhCity]    = useState('');
  const [whType,    setWhType]    = useState('standard');
  const [skipWh,    setSkipWh]    = useState(false);

  const tenantId = typeof window !== 'undefined' ? localStorage.getItem('tenant_id') : null;

  const applyPreset = (presetId: string) => {
    const p = PRESETS[presetId];
    if (!p) return;
    setCurrency(p.currency);
    setVatRate(String(p.vatRate));
    setVatLabel(p.vatLabel);
    setVatInc(p.vatInclusive);
    setSecRate(String(p.secRate));
    setSecLabel(p.secLabel);
    setInvLabel(p.invLabel);
    setCoaTemplate(presetId);
  };

  const selectCountry = (code: string) => {
    setCountry(code);
    const c = COUNTRIES.find(c => c.code === code);
    if (c) applyPreset(c.preset);
    // Pre-fill warehouse city with country name
    const cObj = COUNTRIES.find(ct => ct.code === code);
    if (cObj && !whCity) setWhCity(cObj.name);
  };

  const advance = () => {
    setMsg('');
    setStep(s => s + 1);
  };

  const finish = async () => {
    if (!tenantId) { setMsg('Tenant ID not found. Please log out and log in again.'); return; }
    setBusy(true);
    setMsg('');
    try {
      // 1. Save tax config + currency
      await api.put(`/tenants/${tenantId}/setup`, {
        currency_code: currency,
        tax_config: {
          vat_rate:           parseFloat(vatRate) / 100,
          vat_inclusive:      vatInc,
          vat_label:          vatLabel,
          secondary_tax_rate: parseFloat(secRate) / 100,
          secondary_tax_name: secLabel,
          invoice_label:      invLabel,
        },
      });

      // 2. Seed CoA if template selected
      if (coaTemplate) {
        await api.post('/finance/seed-coa', { template_id: coaTemplate });
      }

      // 3. Seed default UoMs
      await api.post('/uom/seed-defaults');

      // 4. Create warehouse structure (unless skipped)
      if (!skipWh && whName.trim()) {
        const countryObj = COUNTRIES.find(c => c.code === country);
        await api.post('/warehouse/setup', {
          name:    whName.trim(),
          city:    whCity.trim(),
          country: countryObj?.code ?? country,
          type:    whType,
        });
      }

      setDone(true);
    } catch (err: any) {
      setMsg(err?.response?.data?.error?.message ?? 'Setup failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // ── Done screen ─────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl shadow p-10 max-w-md w-full text-center space-y-4">
          <div className="text-5xl">🎉</div>
          <h2 className="text-xl font-semibold">Setup Complete!</h2>
          <p className="text-gray-500 text-sm">
            Your ERP is configured with {coaTemplate ? PRESETS[coaTemplate]?.label : 'manual'} accounts
            {!skipWh && whName ? `, and "${whName}" warehouse is ready.` : '.'}
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const selectedCountry = COUNTRIES.find(c => c.code === country);

  // ── Wizard ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow w-full max-w-lg">

        {/* Progress bar */}
        <div className="px-8 pt-8 pb-4">
          <div className="flex gap-2 mb-6">
            {STEPS.map((s, i) => (
              <div key={s} className="flex-1">
                <div className={`h-1.5 rounded-full transition-all ${i <= step ? 'bg-blue-600' : 'bg-gray-200'}`} />
                <p className={`text-xs mt-1 truncate ${i === step ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>{s}</p>
              </div>
            ))}
          </div>

          {/* ── Step 0: Business ─────────────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Tell us about your business</h2>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
                <input
                  value={bizName} onChange={e => setBizName(e.target.value)}
                  placeholder="Acme Retail"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                <div className="grid grid-cols-2 gap-2">
                  {COUNTRIES.map(c => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => selectCountry(c.code)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm transition text-left ${
                        country === c.code ? 'border-blue-600 bg-blue-50 font-medium' : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <span className="text-lg">{c.flag}</span>
                      <span className="truncate">{c.name}</span>
                      {country === c.code && <span className="ml-auto text-blue-600 text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              </div>
              {country && (
                <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm text-blue-700">
                  Auto-configured: <strong>{PRESETS[selectedCountry?.preset ?? 'generic-ifrs']?.label}</strong> template · {currency} · {vatRate}% {vatLabel}
                </div>
              )}
            </div>
          )}

          {/* ── Step 1: Tax & Currency ────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Tax & Currency</h2>
                {selectedCountry && (
                  <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                    {selectedCountry.flag} Pre-filled from {selectedCountry.name}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Currency Code</label>
                  <input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())}
                    placeholder="USD" maxLength={3} className="w-full border rounded-lg px-3 py-2 text-sm font-mono uppercase" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Label</label>
                  <input value={invLabel} onChange={e => setInvLabel(e.target.value)}
                    placeholder="Invoice" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">VAT Rate (%)</label>
                  <input value={vatRate} onChange={e => setVatRate(e.target.value)} type="number" min="0" max="100"
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">VAT Label</label>
                  <input value={vatLabel} onChange={e => setVatLabel(e.target.value)}
                    placeholder="VAT" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="checkbox" checked={vatInc} onChange={e => setVatInc(e.target.checked)} />
                VAT is price-inclusive (tax embedded in selling price)
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Secondary Tax (%)</label>
                  <input value={secRate} onChange={e => setSecRate(e.target.value)} type="number" min="0" max="100"
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Secondary Tax Label</label>
                  <input value={secLabel} onChange={e => setSecLabel(e.target.value)}
                    placeholder="e.g. IT, GST" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 2: CoA ──────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Chart of Accounts</h2>
                {coaTemplate && (
                  <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">Auto-selected ✓</span>
                )}
              </div>
              <p className="text-sm text-gray-500">Pre-loads a standard account structure. Fully customizable after setup.</p>
              <div className="space-y-2">
                {Object.entries(PRESETS).map(([id, p]) => (
                  <button key={id} type="button" onClick={() => setCoaTemplate(id)}
                    className={`w-full text-left px-4 py-3 rounded-lg border-2 transition ${
                      coaTemplate === id ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">
                        {id === 'bolivia-pcg' ? '🇧🇴' : id === 'turkey-tdhp' ? '🇹🇷' : '🌍'}
                      </span>
                      <div>
                        <p className="font-medium text-sm">{p.label}</p>
                        <p className="text-xs text-gray-400">{p.vatRate}% {p.vatLabel} · {p.currency}</p>
                      </div>
                      {coaTemplate === id && <span className="ml-auto text-blue-600 text-sm font-medium">✓</span>}
                    </div>
                  </button>
                ))}
                <button type="button" onClick={() => setCoaTemplate('')}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 transition ${
                    !coaTemplate ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}>
                  <p className="font-medium text-sm">⚙️ Skip — set up accounts manually</p>
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Warehouse ─────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Warehouse Setup</h2>
              <p className="text-sm text-gray-500">
                Creates your warehouse with 3 zones (Receiving · Storage · Shipping) and 15 locations automatically.
              </p>

              {!skipWh ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Warehouse Name</label>
                      <input value={whName} onChange={e => setWhName(e.target.value)}
                        placeholder="Main Warehouse"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                      <input value={whCity} onChange={e => setWhCity(e.target.value)}
                        placeholder="La Paz"
                        className="w-full border rounded-lg px-3 py-2 text-sm" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
                    <div className="space-y-2">
                      {WAREHOUSE_TYPES.map(t => (
                        <button key={t.value} type="button" onClick={() => setWhType(t.value)}
                          className={`w-full text-left px-4 py-3 rounded-lg border-2 transition ${
                            whType === t.value ? 'border-blue-600 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                          }`}>
                          <div className="flex items-center gap-3">
                            <span className="text-xl">{t.icon}</span>
                            <div>
                              <p className="font-medium text-sm">{t.label}</p>
                              <p className="text-xs text-gray-400">{t.desc}</p>
                            </div>
                            {whType === t.value && <span className="ml-auto text-blue-600 text-sm">✓</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg px-4 py-3 text-xs text-gray-500 space-y-1">
                    <p className="font-medium text-gray-700">Will create automatically:</p>
                    <p>📦 1 Site · 1 Warehouse · 3 Zones · 15 Locations</p>
                    <p className="text-gray-400">Zones: RCV (Receiving) · STG (Storage) · SHP (Shipping)</p>
                  </div>
                </>
              ) : (
                <div className="bg-gray-50 rounded-lg px-4 py-8 text-center text-gray-400 text-sm">
                  Warehouse setup skipped — you can create warehouses from the Warehouse menu later.
                </div>
              )}

              <button type="button" onClick={() => setSkipWh(v => !v)}
                className="text-sm text-gray-400 underline underline-offset-2 hover:text-gray-600">
                {skipWh ? 'Set up a warehouse now' : 'Skip warehouse setup'}
              </button>
            </div>
          )}

          {/* ── Step 4: Finish ────────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Ready to go!</h2>
              <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                {bizName && <p><span className="text-gray-500">Business:</span> <strong>{bizName}</strong></p>}
                {selectedCountry && <p><span className="text-gray-500">Country:</span> <strong>{selectedCountry.flag} {selectedCountry.name}</strong></p>}
                <p><span className="text-gray-500">Currency:</span> <strong>{currency}</strong></p>
                <p><span className="text-gray-500">VAT:</span> <strong>{vatRate}% {vatLabel}{vatInc ? ' (inclusive)' : ' (exclusive)'}</strong></p>
                {parseFloat(secRate) > 0 && <p><span className="text-gray-500">Secondary tax:</span> <strong>{secRate}% {secLabel}</strong></p>}
                <p><span className="text-gray-500">Invoice label:</span> <strong>{invLabel}</strong></p>
                <p><span className="text-gray-500">CoA template:</span> <strong>{coaTemplate ? PRESETS[coaTemplate]?.label : 'Manual'}</strong></p>
                <p><span className="text-gray-500">Warehouse:</span> <strong>{skipWh ? 'Skipped' : (whName || 'Main Warehouse') + ` (${whType})`}</strong></p>
                <p><span className="text-gray-500">Units of measure:</span> <strong>8 defaults (PCS · PAIR · KG · LTR…)</strong></p>
              </div>
              {msg && <p className="text-sm text-red-600">{msg}</p>}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="px-8 pb-8 flex justify-between">
          <button
            onClick={() => { setMsg(''); setStep(s => Math.max(0, s - 1)); }}
            disabled={step === 0}
            className="px-5 py-2 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-30"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={advance}
              disabled={step === 0 && !bizName.trim()}
              className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
            >
              Continue
            </button>
          ) : (
            <button
              onClick={finish}
              disabled={busy}
              className="px-6 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
            >
              {busy ? 'Setting up...' : 'Complete Setup'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
