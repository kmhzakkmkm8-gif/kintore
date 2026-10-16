import { useEffect, useState } from 'react';

export function Card({ title, right, children, className = '' }) {
  return (
    <section className={`rounded-2xl bg-slate-900 border border-slate-800 p-4 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-3 gap-2">
          {title && <h2 className="font-bold text-slate-200">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

const variants = {
  primary: 'bg-emerald-500 text-slate-950 active:bg-emerald-400 font-bold',
  secondary: 'bg-slate-800 text-slate-100 active:bg-slate-700',
  ghost: 'text-slate-300 active:bg-slate-800',
  danger: 'bg-rose-600/20 text-rose-300 active:bg-rose-600/40',
};

export function Button({ variant = 'secondary', className = '', ...props }) {
  return (
    <button
      type="button"
      className={`rounded-xl px-4 py-2.5 whitespace-nowrap shrink-0 disabled:opacity-40 select-none ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500';

// 数値入力。入力途中の "50." などを保持するため文字列で持ち、確定時に数値化
export function NumberInput({ value, onChange, step = 'any', className = '', ...props }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => {
    if (Number(text) !== value) setText(value ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      className={`${inputCls} ${className}`}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value === '' ? null : Number(e.target.value));
      }}
      {...props}
    />
  );
}

export function ProgressBar({ value, target, color = 'bg-emerald-500' }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
      <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-slate-900 border border-slate-800 w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">{title}</h2>
          <button type="button" className="text-slate-400 px-2 text-xl" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Chip({ active, children, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`rounded-full px-3 py-1 text-sm border ${
        active ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-400'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function useToast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2000);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-50 rounded-xl bg-slate-100 text-slate-900 px-4 py-2 text-sm shadow-lg">
      {msg}
    </div>
  ) : null;
  return [node, setMsg];
}
