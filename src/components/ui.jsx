/*!
 * NOC Control Center — © 2026 felixrohman31-a11y (MIT License)
 * https://github.com/felixrohman31-a11y/noc-webui
 * Bebas diunduh, digunakan, dan dimodifikasi — sertakan notice ini pada salinan.
 */

import React, { createContext, useContext, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';

export function Card({ title, right, children, className = '' }) {
  return (
    <div className={`bg-[#111a2c] border border-[#1e2a44] rounded-xl ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2a44]">
          <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

const btnVariants = {
  primary: 'bg-cyan-600 hover:bg-cyan-500 text-white',
  ghost: 'bg-transparent hover:bg-slate-700/50 text-slate-300 border border-[#1e2a44]',
  danger: 'bg-red-600/90 hover:bg-red-500 text-white',
  subtle: 'bg-slate-700/60 hover:bg-slate-600 text-slate-100'
};

export function Button({ variant = 'primary', className = '', loading, children, ...props }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${btnVariants[variant]} ${className}`}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Badge({ children, color = 'slate' }) {
  const map = {
    green: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    red: 'bg-red-500/15 text-red-400 border-red-500/30',
    yellow: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    slate: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
    cyan: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[color]}`}>{children}</span>;
}

export function StatusDot({ status }) {
  if (status === true) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />;
  if (status === false) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]" />;
  return <span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-500" />;
}

export function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm py-10" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`bg-[#111a2c] border border-[#1e2a44] rounded-xl shadow-2xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} mx-4`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2a44]">
          <h3 className="font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint, mb = true }) {
  return (
    <label className={`block ${mb ? 'mb-3' : ''}`}>
      <span className="block text-xs font-medium text-slate-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full bg-[#0b1220] border border-[#1e2a44] rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 placeholder-slate-600';

export function Spinner({ label }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-slate-400 text-sm">
      <Loader2 size={16} className="animate-spin" /> {label || 'Memuat...'}
    </div>
  );
}

export function ChartArea({ points, width = 640, height = 110 }) {
  const pts = (points || []).filter(p => Array.isArray(p));
  if (pts.length < 2) return <div className="text-xs text-slate-600 py-4">Belum cukup data — grafik terisi otomatis oleh polling</div>;
  const tMin = pts[0][0], tMax = pts[pts.length - 1][0] || tMin + 1;
  const lats = pts.filter(p => p[1] != null).map(p => p[1]);
  const min = Math.min(...lats, 0), max = Math.max(...lats, 1);
  const x = t => ((t - tMin) / Math.max(1, tMax - tMin)) * width;
  const y = v => height - 8 - ((v - min) / Math.max(1, max - min)) * (height - 20);
  const downs = [];
  const segments = [];
  let cur = [];
  for (const p of pts) {
    if (p[1] != null) cur.push(`${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`);
    else { downs.push(x(p[0])); if (cur.length) { segments.push(cur); cur = []; } }
  }
  if (cur.length) segments.push(cur);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: height }}>
      <line x1="0" y1={height - 6} x2={width} y2={height - 6} stroke="#1e2a44" />
      {segments.map((s, i) => <polyline key={i} points={s.join(' ')} fill="none" stroke="#22d3ee" strokeWidth="1.5" />)}
      {downs.map((dx, i) => <rect key={'d' + i} x={(dx - 1).toFixed(1)} y={height - 10} width="2" height="7" fill="#ef4444" />)}
      <text x="4" y="12" fontSize="10" fill="#64748b">{max.toFixed(0)} ms</text>
    </svg>
  );
}

export function Empty({ children }) {
  return <div className="text-center text-slate-500 text-sm py-8">{children}</div>;
}

/** Checkbox custom bergaya NOC: kotak rounded, glow cyan saat aktif */
export function Checkbox({ checked, onChange, size = 16, title }) {
  return (
    <button type="button" role="checkbox" aria-checked={!!checked} title={title}
      onClick={e => { e.stopPropagation(); onChange && onChange(!checked); }}
      className={`relative inline-flex items-center justify-center shrink-0 rounded-[5px] border transition-all duration-150
        ${checked
          ? 'bg-gradient-to-br from-cyan-400 to-cyan-600 border-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.5)]'
          : 'bg-[#0b1220] border-slate-600 hover:border-cyan-400/70 hover:shadow-[0_0_6px_rgba(34,211,238,0.25)]'}`}
      style={{ width: size, height: size }}>
      <svg viewBox="0 0 12 10" className={`w-2.5 transition-all duration-150 ${checked ? 'opacity-100 scale-100 text-slate-950' : 'opacity-0 scale-50'}`} fill="none"
        style={{ width: size * 0.7, height: size * 0.6 }}>
        <path d="M1 5.5 L4.5 9 L11 1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** Chip indikator jumlah baris terpilih + tombol bersihkan */
export function SelectedChip({ count, onClear, label = 'dipilih' }) {
  if (!count) return null;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500/15 border border-cyan-500/40 text-xs font-medium text-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.15)]">
      <svg viewBox="0 0 12 10" className="w-2.5 h-2.5" fill="none">
        <path d="M1 5.5 L4.5 9 L11 1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {count} {label}
      {onClear && (
        <button onClick={onClear} title="Kosongkan pilihan"
          className="ml-0.5 -mr-0.5 w-4 h-4 rounded-full flex items-center justify-center text-cyan-400/70 hover:text-white hover:bg-cyan-500/30 transition-colors leading-none">×</button>
      )}
    </span>
  );
}

export function Sparkline({ points, width = 90, height = 22 }) {
  const data = (points || []).filter(p => p && p[1] != null);
  if (!data.length) return <span className="text-slate-600 text-[10px]">no data</span>;
  const lats = data.map(p => p[1]);
  const min = Math.min(...lats), max = Math.max(...lats);
  const span = max - min || 1;
  const step = width / Math.max(1, data.length - 1);
  const poly = data.map((p, i) => `${(i * step).toFixed(1)},${(height - 2 - ((p[1] - min) / span) * (height - 4)).toFixed(1)}`).join(' ');
  const last = data[data.length - 1];
  return (
    <svg width={width} height={height} className="inline-block align-middle">
      <polyline points={poly} fill="none" stroke="#22d3ee" strokeWidth="1.5" />
      <circle cx={((data.length - 1) * step).toFixed(1)} cy={(height - 2 - ((last[1] - min) / span) * (height - 4)).toFixed(1)} r="2" fill="#22d3ee" />
    </svg>
  );
}

// ---------- Toasts ----------
const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  function push(type, msg) {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, type, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }
  const icons = {
    ok: <CheckCircle2 size={16} className="text-emerald-400" />,
    err: <AlertTriangle size={16} className="text-red-400" />,
    info: <Info size={16} className="text-cyan-400" />
  };
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] space-y-2 max-w-md">
        {toasts.map(t => (
          <div key={t.id} className="flex items-start gap-2 bg-[#111a2c] border border-[#1e2a44] rounded-lg px-4 py-3 shadow-xl text-sm">
            {icons[t.type]}
            <span className="text-slate-200 break-all">{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
