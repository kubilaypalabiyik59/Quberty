'use client';

import { useState, useEffect } from 'react';
import { X, SlidersHorizontal, RotateCcw } from 'lucide-react';

export type FilterOperator = 'begins with' | 'contains' | 'equals' | 'not equals' | '=' | '>' | '>=' | '<' | '<=';

export interface FilterFieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'select';
  operators?: FilterOperator[];
  options?: { label: string; value: string }[];
}

export interface ActiveFilter {
  op: FilterOperator;
  value: string;
}

export type FilterState = Record<string, ActiveFilter>;

interface FilterPanelProps {
  open: boolean;
  onClose: () => void;
  fields: FilterFieldDef[];
  onApply: (filters: FilterState) => void;
  /** Number of active filters — shown as a badge on the trigger button */
  activeCount?: number;
}

const TEXT_OPS: FilterOperator[]   = ['begins with', 'contains', 'equals', 'not equals'];
const NUM_OPS:  FilterOperator[]   = ['=', '>=', '<=', '>', '<'] as FilterOperator[];

function defaultOp(field: FilterFieldDef): FilterOperator {
  if (field.operators?.length) return field.operators[0];
  return field.type === 'number' ? ('=' as FilterOperator) : 'begins with';
}

function emptyState(fields: FilterFieldDef[]): FilterState {
  const s: FilterState = {};
  fields.forEach(f => { s[f.key] = { op: defaultOp(f), value: '' }; });
  return s;
}

/** Apply filters to an array client-side */
export function applyFilters<T extends Record<string, any>>(
  rows: T[],
  filters: FilterState,
  fields: FilterFieldDef[],
): T[] {
  const active = fields.filter(f => filters[f.key]?.value !== '' && filters[f.key] != null);
  if (!active.length) return rows;

  return rows.filter(row => active.every(field => {
    const entry = filters[field.key];
    if (!entry) return true;
    const { op, value } = entry;
    const raw = field.key.split('.').reduce((o, k) => o?.[k], row as any);
    const cell = String(raw ?? '').toLowerCase();
    const v = value.toLowerCase();

    if (field.type === 'number') {
      const num  = Number(raw ?? 0);
      const num2 = Number(value);
      if (op === '=')  return num === num2;
      if (op === '>')  return num >  num2;
      if (op === '>=') return num >= num2;
      if (op === '<')  return num <  num2;
      if (op === '<=') return num <= num2;
    }

    if (op === 'begins with') return cell.startsWith(v);
    if (op === 'contains')    return cell.includes(v);
    if (op === 'equals')      return cell === v;
    if (op === 'not equals')  return cell !== v;
    return true;
  }));
}

export function FilterPanel({ open, onClose, fields, onApply, activeCount = 0 }: FilterPanelProps) {
  const [draft, setDraft] = useState<FilterState>(() => emptyState(fields));

  // Reset draft whenever panel opens
  useEffect(() => {
    if (open) setDraft(emptyState(fields));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOp = (key: string, op: FilterOperator) =>
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], op } }));

  const setValue = (key: string, value: string) =>
    setDraft(prev => ({ ...prev, [key]: { ...prev[key], value } }));

  const clearField = (key: string) =>
    setDraft(prev => ({ ...prev, [key]: { op: prev[key].op, value: '' } }));

  const handleApply = () => { onApply(draft); onClose(); };
  const handleReset = () => { const empty = emptyState(fields); setDraft(empty); onApply(empty); onClose(); };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 z-40"
          onClick={onClose}
        />
      )}

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-80 bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col
          transition-transform duration-200 ease-in-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-gray-500" />
            <span className="font-semibold text-gray-800 text-sm">Filters</span>
            {activeCount > 0 && (
              <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
                {activeCount}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 rounded p-1 hover:bg-gray-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filter fields */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {fields.map(field => {
            const ops = field.operators ?? (field.type === 'number' ? NUM_OPS : field.type === 'select' ? ['equals'] as FilterOperator[] : TEXT_OPS);
            const current = draft[field.key] ?? { op: defaultOp(field), value: '' };

            return (
              <div key={field.key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{field.label}</span>
                  {current.value && (
                    <button onClick={() => clearField(field.key)} className="text-gray-300 hover:text-gray-500 transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Operator selector */}
                <select
                  value={current.op}
                  onChange={e => setOp(field.key, e.target.value as FilterOperator)}
                  className="w-full text-xs text-blue-600 font-medium bg-transparent border-0 p-0 mb-1 focus:outline-none cursor-pointer"
                >
                  {ops.map(op => <option key={op} value={op}>{op}</option>)}
                </select>

                {/* Value input */}
                {field.type === 'select' ? (
                  <select
                    value={current.value}
                    onChange={e => setValue(field.key, e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— All —</option>
                    {field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={current.value}
                    onChange={e => setValue(field.key, e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleApply()}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={`Filter by ${field.label.toLowerCase()}...`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 flex gap-2">
          <button
            onClick={handleReset}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
          <button
            onClick={handleApply}
            className="flex-1 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );
}

/** Trigger button — shows active filter count badge */
export function FilterPanelTrigger({ onClick, activeCount }: { onClick: () => void; activeCount: number }) {
  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors
        ${activeCount > 0
          ? 'border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100'
          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
    >
      <SlidersHorizontal className="h-4 w-4" />
      Filters
      {activeCount > 0 && (
        <span className="bg-blue-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
          {activeCount}
        </span>
      )}
    </button>
  );
}
