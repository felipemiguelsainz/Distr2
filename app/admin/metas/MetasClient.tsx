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

export function MetasClient({ defaultAnio, defaultMes }: { defaultAnio: number; defaultMes: number }) {
  const [anio, setAnio] = useState(defaultAnio);
  const [mes,  setMes]  = useState(defaultMes);
  const [objetivos, setObjetivos] = useState<Record<string, string>>(
    Object.fromEntries(MONDELEZ_RUBROS.map(r => [r, '']))
  );

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
      body: JSON.stringify({ anio, mes, objetivosMondelez: parsed }),
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
              <span className="text-[13px] font-medium text-[#27272a]">{rubro}</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={objetivos[rubro] ?? ''}
                onChange={e => setObjetivos(prev => ({ ...prev, [rubro]: e.target.value }))}
                className={`${inputCls} placeholder:text-[#9f9fa9]`}
                placeholder="0"
              />
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleCalcular}
            disabled={loading}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_4px_16px_rgba(12,92,171,0.3)]"
            style={{background: 'linear-gradient(135deg, #0c5cab, #0c5cab)'}}
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
            <div className="rounded-lg border border-[#e4e4e7] overflow-hidden bg-[#ffffff]">
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
