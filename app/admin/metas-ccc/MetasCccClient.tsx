'use client';

import { useMemo, useState } from 'react';

export interface VendedorMetas {
  vendedor: string;
  total: number | null;          // meta total CCC (rubro NULL)
  totalPreset: boolean;          // true = preset automático, false = editada
  rubros: Record<string, number>; // meta por rubro
}

const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };

export function MetasCccClient({
  mes, anio, rubros, filas,
}: {
  mes: number;
  anio: number;
  rubros: string[];
  filas: VendedorMetas[];
}) {
  // Ratios de cascadeo por vendedor: rubroMeta / totalMeta (penetración embebida).
  const ratios = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const f of filas) {
      const r: Record<string, number> = {};
      const base = f.total && f.total > 0 ? f.total : 0;
      for (const rb of rubros) {
        r[rb] = base > 0 ? (f.rubros[rb] ?? 0) / base : 0;
      }
      m.set(f.vendedor, r);
    }
    return m;
  }, [filas, rubros]);

  const [totals, setTotals] = useState<Record<string, number>>(
    () => Object.fromEntries(filas.map((f) => [f.vendedor, f.total ?? 0])),
  );
  const [presetFlags, setPresetFlags] = useState<Record<string, boolean>>(
    () => Object.fromEntries(filas.map((f) => [f.vendedor, f.totalPreset])),
  );
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function derivedRubro(vendedor: string, rubro: string): number {
    const ratio = ratios.get(vendedor)?.[rubro] ?? 0;
    return Math.round((totals[vendedor] ?? 0) * ratio);
  }

  function onTotalChange(vendedor: string, raw: string) {
    const val = Math.max(0, Math.round(Number(raw) || 0));
    setTotals((prev) => ({ ...prev, [vendedor]: val }));
    setPresetFlags((prev) => ({ ...prev, [vendedor]: false }));
    setDirty((prev) => new Set(prev).add(vendedor));
    setMsg(null);
  }

  async function guardar() {
    if (dirty.size === 0) return;
    setSaving(true); setError(null); setMsg(null);

    const rows: { vendedor: string; rubro: string | null; meta_pdvs: number }[] = [];
    for (const v of dirty) {
      rows.push({ vendedor: v, rubro: null, meta_pdvs: totals[v] ?? 0 });
      for (const rb of rubros) {
        rows.push({ vendedor: v, rubro: rb, meta_pdvs: derivedRubro(v, rb) });
      }
    }

    const res = await fetch('/api/supervisor/metas-ccc/guardar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mes, anio, rows }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? 'No se pudieron guardar las metas.'); return; }
    setDirty(new Set());
    setMsg('Metas guardadas.');
  }

  const minWidth = 200 + rubros.length * 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-[13px] text-[#71717a]">
          Editá la <strong className="text-[#09090b]">meta total</strong> de cada vendedor. Las metas por rubro se recalculan por cascadeo (penetración histórica) y son de solo lectura.
        </p>
        <div className="flex items-center gap-3 ml-auto">
          {error && <span className="text-[12px] text-[#dc2626]">{error}</span>}
          {msg && <span className="text-[12px] text-[#16a34a] font-medium">{msg}</span>}
          <button
            onClick={guardar}
            disabled={saving || dirty.size === 0}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_4px_16px_rgba(12,92,171,0.3)]"
            style={{ background: '#0c5cab' }}
          >
            {saving ? 'Guardando...' : `Guardar cambios${dirty.size ? ` (${dirty.size})` : ''}`}
          </button>
        </div>
      </div>

      <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]" style={{ minWidth }}>
            <thead>
              <tr className="bg-[#f4f4f5]/80 border-b border-[#e4e4e7]">
                <th className="sticky left-0 z-10 bg-[#f4f4f5] px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.1em] text-[#71717a] w-[160px]" style={MONO}>
                  Vendedor
                </th>
                <th className="px-3 py-2.5 text-right text-[9px] font-semibold uppercase tracking-[0.1em] text-[#0c5cab] whitespace-nowrap w-[120px]" style={MONO}>
                  Meta total
                </th>
                {rubros.map((rb) => (
                  <th key={rb} className="px-3 py-2.5 text-right text-[9px] font-semibold uppercase tracking-[0.1em] text-[#71717a] whitespace-nowrap" style={MONO}>
                    {rb}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e4e7]">
              {filas.map((f) => {
                const preset = presetFlags[f.vendedor];
                return (
                  <tr key={f.vendedor} className="hover:bg-[rgba(12,92,171,0.04)]">
                    <td className="sticky left-0 z-10 bg-[#ffffff] px-3 py-2 truncate max-w-[160px] text-[12px] font-semibold text-[#09090b]" style={MONO}>
                      <span className="inline-flex items-center gap-1.5">
                        {f.vendedor}
                        <span
                          className={`text-[8px] font-semibold px-1 py-0.5 rounded-full ${
                            preset
                              ? 'text-[#71717a] bg-[#f4f4f5]'
                              : 'text-[#0c5cab] bg-[#0c5cab]/[0.1]'
                          }`}
                          title={preset ? 'Meta preseteada automática' : 'Editada por el supervisor'}
                        >
                          {preset ? 'auto' : 'editada'}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        value={totals[f.vendedor] ?? 0}
                        onChange={(e) => onTotalChange(f.vendedor, e.target.value)}
                        className="w-[88px] px-2 py-1 text-[12px] text-right tabular-nums bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[7px] text-[#09090b] caret-[#0c5cab] focus:outline-none focus:border-[rgba(12,92,171,0.4)] transition-all"
                        style={MONO}
                      />
                    </td>
                    {rubros.map((rb) => (
                      <td key={rb} className="px-3 py-2 text-right tabular-nums text-[#9f9fa9]" style={MONO}>
                        {derivedRubro(f.vendedor, rb)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
