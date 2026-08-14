'use client';

import { useState } from 'react';
import { MONDELEZ_RUBROS } from '@/lib/constants';
import { MetaPreviewRubro } from '@/lib/types';
import { formatKg, formatCurrency, formatPctPlain } from '@/lib/calculations/dashboard';
import { Select } from '@/components/ui/Select';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const inputCls = [
  'w-32 px-3 py-[7px] text-[13px] font-semibold tabular-nums',
  'bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[8px]',
  'focus:outline-none focus:border-[rgba(12,92,171,0.4)] caret-[#0c5cab]',
  'transition-all text-right text-[#09090b]',
].join(' ');

export type VendedorOpcion = { nombre: string; sinSupervisor: boolean; enMaestro: boolean };

export function MetasClient({ defaultAnio, defaultMes, vendedores = [] }: { defaultAnio: number; defaultMes: number; vendedores?: VendedorOpcion[] }) {
  const [anio, setAnio] = useState(defaultAnio);
  const [mes,  setMes]  = useState(defaultMes);
  const [objetivos, setObjetivos] = useState<Record<string, string>>(
    Object.fromEntries(MONDELEZ_RUBROS.map(r => [r, '']))
  );
  // Los que no dependen de un supervisor arrancan excluidos: su venta no se mueve
  // con la gestión comercial, así que la meta se reparte entre los que sí tienen.
  const [excluidos, setExcluidos] = useState<Set<string>>(
    () => new Set(vendedores.filter(v => v.sinSupervisor).map(v => v.nombre)),
  );
  const [excluidosOpen, setExcluidosOpen] = useState(false);

  function toggleExcluido(v: string) {
    setExcluidos(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  }

  const [preview, setPreview]   = useState<MetaPreviewRubro[] | null>(null);
  const [loading, setLoading]   = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  async function handleCalcular() {
    setLoading(true); setError(''); setSavedMsg('');
    const parsed = Object.fromEntries(
      Object.entries(objetivos).map(([k, v]) => [k, v === '' ? 0 : parseFloat(v) || 0]),
    );
    const res = await fetch('/api/admin/metas/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anio, mes, objetivosMondelez: parsed, vendedoresExcluidos: [...excluidos] }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error ?? 'Error al calcular preview.'); return; }
    setPreview(data.preview);
  }

  async function handleGuardar() {
    if (!preview) return;
    setSaving(true); setError(''); setSavedMsg('');
    const res = await fetch('/api/admin/metas/guardar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anio, mes, preview }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? 'Error al guardar metas.'); return; }
    setSavedMsg(`✓ ${data.total} metas guardadas para ${MESES[mes - 1]} ${anio}.`);
  }

  const currentYear = new Date().getFullYear();
  const totalGeneral = preview?.reduce((s, p) => s + p.kg_meta_total, 0) ?? 0;
  const totalMondelez = preview?.filter(p => p.origen === 'mondelez').reduce((s, p) => s + p.kg_meta_total, 0) ?? 0;

  return (
    <div className="max-w-5xl mx-auto space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b]">Metas del mes</h1>
          <p className="text-[13px] text-[#71717a] mt-0.5">Cargá los objetivos de Mondelez en $ y el sistema calcula y distribuye los kg por vendedor.</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={mes} onChange={e => setMes(Number(e.target.value))}>
            {MESES.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </Select>
          <Select value={anio} onChange={e => setAnio(Number(e.target.value))}>
            {[currentYear - 1, currentYear, currentYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </div>
      </div>

      <section className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 p-6">
        <h2 className="text-[15px] font-semibold text-[#09090b] mb-1">Objetivos Mondelez ($)</h2>
        <p className="text-[12px] text-[#71717a] mb-4">Pegá el objetivo en pesos que pasó Mondelez para cada categoría.</p>
        <div className="flex flex-col gap-2">
          {MONDELEZ_RUBROS.map(rubro => (
            <div key={rubro} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[#e4e4e7]">
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-2 h-2 rounded-full bg-[#0c5cab] shrink-0" />
                <span className="text-[13px] font-medium text-[#27272a] truncate">{rubro}</span>
              </span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={objetivos[rubro] ?? ''}
                onChange={e => setObjetivos(prev => ({ ...prev, [rubro]: e.target.value }))}
                className={`${inputCls} placeholder:text-[#71717a]`}
                placeholder="0"
              />
            </div>
          ))}
        </div>

        {/* Vendedores excluidos del cálculo */}
        <div className="mt-5 pt-5 border-t border-[#e4e4e7]">
          <button
            type="button"
            onClick={() => setExcluidosOpen(o => !o)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="text-[13px] font-semibold text-[#09090b]">
              Vendedores excluidos del cálculo
              {excluidos.size > 0 && (
                <span className="ml-2 text-[12px] font-medium text-[#0c5cab]">
                  ({excluidos.size} excluido{excluidos.size > 1 ? 's' : ''})
                </span>
              )}
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`text-[#71717a] transition-transform ${excluidosOpen ? 'rotate-180' : ''}`}>
              <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <p className="text-[12px] text-[#71717a] mt-0.5">
            No reciben meta; su parte se redistribuye entre los demás, así que a ellos les sube la meta.
            Los que no tienen supervisor vienen excluidos por defecto (su venta no depende de la gestión comercial).
          </p>
          {excluidosOpen && (
            vendedores.length === 0
              ? <p className="mt-3 text-[12px] text-[#71717a]">No hay vendedores activos.</p>
              : (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {vendedores.map(v => (
                    <label key={v.nombre} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={excluidos.has(v.nombre)}
                        onChange={() => toggleExcluido(v.nombre)}
                        className="accent-[#0c5cab] shrink-0"
                      />
                      <span className="text-[12px] text-[#27272a] truncate" title={v.nombre}>{v.nombre}</span>
                      {v.sinSupervisor && (
                        <span className="text-[9px] font-semibold uppercase px-1.5 py-px rounded-full shrink-0 bg-[rgba(217,119,6,0.1)] text-[#d97706] border border-[rgba(217,119,6,0.2)]" style={{fontFamily: "'JetBrains Mono', monospace"}}>
                          sin sup.
                        </span>
                      )}
                      {!v.enMaestro && (
                        <span
                          title="Vende, pero no figura en el maestro de vendedores: no sabemos si tiene supervisor."
                          className="text-[9px] font-semibold uppercase px-1.5 py-px rounded-full shrink-0 bg-[rgba(220,38,38,0.1)] text-[#dc2626] border border-[rgba(220,38,38,0.2)]"
                          style={{fontFamily: "'JetBrains Mono', monospace"}}
                        >
                          s/maestro
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )
          )}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleCalcular}
            disabled={loading}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_4px_16px_rgba(12,92,171,0.3)]"
            style={{ background: '#0c5cab' }}
          >
            {loading ? 'Calculando...' : 'Calcular preview'}
          </button>
          {error && <span className="text-[12px] text-[#dc2626]">{error}</span>}
        </div>
      </section>

      {preview && (
        <section className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[#09090b]">Distribución calculada</h2>
            <div className="flex gap-4 text-[12px]">
              <span className="text-[#71717a]">Mondelez: <strong className="text-[#09090b]">{formatKg(totalMondelez)} kg</strong></span>
              <span className="text-[#71717a]">Total: <strong className="text-[#09090b]">{formatKg(totalGeneral)} kg</strong></span>
            </div>
          </div>

          <div className="space-y-4">
            {preview.map(p => (
              <RubroCard key={p.rubro} preview={p} />
            ))}
          </div>

          {/* Total general destacado */}
          <div className="rounded-xl border-2 border-[#0c5cab]/20 bg-[#0c5cab]/5 px-4 py-3 flex items-center justify-between flex-wrap gap-2">
            <span className="text-[13px] font-bold text-[#0c5cab]">Total general</span>
            <div className="flex items-center gap-5 text-[13px]">
              <span className="text-[#71717a]">Mondelez <strong className="text-[#09090b] tabular-nums">{formatKg(totalMondelez)} kg</strong></span>
              <span className="text-[#0c5cab] font-bold tabular-nums text-[15px]">{formatKg(totalGeneral)} kg</span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-[#e4e4e7]">
            <button
              onClick={handleGuardar}
              disabled={saving}
              className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_4px_16px_rgba(22,163,74,0.3)]"
              style={{background: 'linear-gradient(135deg, #16a34a, #0c5cab)'}}
            >
              {saving ? 'Guardando...' : 'Guardar metas'}
            </button>
            {savedMsg && <span className="text-[12px] text-[#16a34a] font-medium">{savedMsg}</span>}
          </div>
        </section>
      )}
    </div>
  );
}

function RubroCard({ preview }: { preview: MetaPreviewRubro }) {
  const [open, setOpen] = useState(false);
  const isMondelez = preview.origen === 'mondelez';
  const badgeCls = isMondelez
    ? 'bg-[rgba(12,92,171,0.1)] text-[#0c5cab] border border-[rgba(12,92,171,0.2)]'
    : 'bg-[rgba(217,119,6,0.1)] text-[#d97706] border border-[rgba(217,119,6,0.2)]';

  return (
    <div className="rounded-xl border border-[#e4e4e7] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[rgba(12,92,171,0.04)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${badgeCls}`} style={{fontFamily: "'JetBrains Mono', monospace"}}>
            {preview.origen}
          </span>
          <span className="text-[14px] font-semibold text-[#09090b]">{preview.rubro}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-bold text-[#09090b] tabular-nums">{formatKg(preview.kg_meta_total)} kg</span>
          <span className={`text-[#71717a] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </div>
      </button>

      {open && (
        <div className="px-4 py-3 bg-[#f4f4f5]/50 border-t border-[#e4e4e7] space-y-3">
          {/* Cálculo */}
          <div className="text-[12px] text-[#71717a] space-y-0.5">
            {isMondelez ? (
              <>
                <p>Objetivo: <strong className="text-[#27272a]">{formatCurrency(preview.objetivo_neto ?? 0)}</strong></p>
                <p>$/kg último mes: <strong className="text-[#27272a]">{formatCurrency(preview.dolar_por_kilo ?? 0)}</strong></p>
                <p>kg meta = objetivo / $/kg = <strong className="text-[#27272a]">{formatKg(preview.kg_meta_total)} kg</strong></p>
              </>
            ) : (
              <>
                <p>Ventas mes anterior: <strong className="text-[#27272a]">{formatKg(preview.ventas_mes_anterior ?? 0)} kg</strong></p>
                {preview.peso_mes_ant_aa_pct != null && preview.peso_mes_target_aa_pct != null && (
                  <p>
                    Peso año pasado: mes anterior <strong className="text-[#27272a]">{preview.peso_mes_ant_aa_pct.toFixed(2)}%</strong>
                    {' '}vs mes target <strong className="text-[#27272a]">{preview.peso_mes_target_aa_pct.toFixed(2)}%</strong>
                  </p>
                )}
                <p>Factor estacional = target% / anterior% = <strong className="text-[#27272a]">{(preview.factor_estacional ?? 1).toFixed(3)}</strong></p>
                <p>kg meta = mes ant × factor = <strong className="text-[#27272a]">{formatKg(preview.kg_meta_total)} kg</strong></p>
                {preview.neto_meta_total != null && preview.dolar_por_kilo != null && (
                  <p>$ meta ≈ kg meta × {formatCurrency(preview.dolar_por_kilo)}/kg = <strong className="text-[#27272a]">{formatCurrency(preview.neto_meta_total)}</strong></p>
                )}
              </>
            )}
          </div>

          {/* Distribución por vendedor */}
          {preview.vendedores.length > 0 ? (
            <div className="rounded-lg border border-[#e4e4e7] overflow-x-auto bg-[#ffffff]">
              <table className="min-w-full text-[12px]">
                <thead>
                  <tr className="bg-[#f4f4f5]/80 border-b border-[#e4e4e7]">
                    <th className="px-3 py-2 text-left font-semibold text-[#71717a] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Vendedor</th>
                    <th className="px-3 py-2 text-right font-semibold text-[#71717a] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Peso</th>
                    <th className="px-3 py-2 text-right font-semibold text-[#71717a] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Meta kg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e4e4e7]">
                  {preview.vendedores.map(v => (
                    <tr key={v.vendedor}>
                      <td className="px-3 py-1.5 text-[#27272a]">{v.vendedor}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#71717a]">{formatPctPlain(v.peso_pct)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[#09090b]">{formatKg(v.kg_meta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[12px] text-[#71717a] italic">Sin historial de vendedores para distribuir.</p>
          )}
        </div>
      )}
    </div>
  );
}
