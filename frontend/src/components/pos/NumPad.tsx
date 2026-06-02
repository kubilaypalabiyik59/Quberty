'use client';

interface Props {
  value: string;
  onChange: (v: string) => void;
  allowDecimal?: boolean;
}

const KEYS = ['7','8','9','4','5','6','1','2','3','','0','⌫'];

export function NumPad({ value, onChange, allowDecimal = false }: Props) {
  function press(key: string) {
    if (key === '⌫') {
      onChange(value.length <= 1 ? '0' : value.slice(0, -1));
      return;
    }
    if (key === '') return;
    if (key === '.' && !allowDecimal) return;
    if (key === '.' && value.includes('.')) return;
    const next = value === '0' && key !== '.' ? key : value + key;
    if (next.length > 10) return;
    onChange(next);
  }

  return (
    <div className="grid grid-cols-3 gap-2 mb-3">
      {KEYS.map((key, i) => (
        <button
          key={i}
          onClick={() => press(key)}
          disabled={key === ''}
          className={`py-3.5 rounded-xl text-xl font-semibold transition-colors ${
            key === '⌫'
              ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
              : key === ''
              ? 'bg-transparent cursor-default'
              : 'bg-white text-slate-900 border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 active:scale-95'
          }`}
        >
          {key}
        </button>
      ))}
      {allowDecimal && (
        <button
          onClick={() => press('.')}
          className="py-3.5 rounded-xl text-xl font-semibold bg-white text-slate-900 border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 active:scale-95"
        >
          .
        </button>
      )}
    </div>
  );
}
