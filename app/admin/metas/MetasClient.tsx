'use client';

import { useState } from 'react';
import { MONDELEZ_RUBROS } from '@/lib/constants';
import { MetaPreviewRubro } from '@/lib/types';
import { formatKg, formatCurrency, formatPctPlain } from '@/lib/calculations/dashboard';
import { Select } from '@/components/ui/Select';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const inputCls = [
  'w-32 px-3 py-[7px] text-[13px] font-semibold tabular-nums',
  'bg-[rgba(255,255,255,0.02)] border border-[#1a2d4a] rounded-[8px]',
  'focus:outline-none focus:border-[rgba(99,102,241,0.4)] caret-[#3b82f6]',
  'transition-all text-right text-[#f0f4ff]',
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
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#f0f4ff]">Metas del mes</h1>
          <p className="text-[13px] text-[#6b85a8] mt-0.5">Cargá los objetivos de Mondelez en $ y el sistema calcula y distribuye los kg por vendedor.</p>
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

      <section className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-xl shadow-black/30 p-6">
        <h2 className="text-[15px] font-semibold text-[#f0f4ff] mb-1">Objetivos Mondelez ($)</h2>
        <p className="text-[12px] text-[#6b85a8] mb-4">Pegá el objetivo en pesos que pasó Mondelez para cada categoría.</p>
        <div className="flex flex-col gap-2">
          {MONDELEZ_RUBROS.map(rubro => (
            <div key={rubro} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-[#1a2d4a]">
              <span className="text-[13px] font-medium text-[#c8d8f0]">{rubro}</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={objetivos[rubro] ?? ''}
                onChange={e => setObjetivos(prev => ({ ...prev, [rubro]: e.target.value }))}
                className={`${inputCls} placeholder:text-[#3a4a66]`}
                placeholder="0"
              />
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleCalcular}
            disabled={loading}
            className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_4px_16px_rgba(99,102,241,0.3)]"
            style={{background: 'linear-gradient(135deg, #3b82f6, #6366f1)'}}
          >
            {loading ? 'Calculando...' : 'Calcular preview'}
          </button>
          {error && <span className="text-[12px] text-[#f87171]">{error}</span>}
        </div>
      </section>

      {preview && (
        <section className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] shadow-xl shadow-black/30 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-[#f0f4ff]">Distribución calculada</h2>
            <div className="flex gap-4 text-[12px]">
              <span className="text-[#6b85a8]">Mondelez: <strong className="text-[#f0f4ff]">{formatKg(totalMondelez)} kg</strong></span>
              <span className="text-[#6b85a8]">Total: <strong className="text-[#f0f4ff]">{formatKg(totalGeneral)} kg</strong></span>
            </div>
          </div>

          <div className="space-y-4">
            {preview.map(p => (
              <RubroCard key={p.rubro} preview={p} />
            ))}
          </div>

          <div className="flex items-center gap-3 pt-3 border-t border-[#1a2d4a]">
            <button
              onClick={handleGuardar}
              disabled={saving}
              className="px-4 py-[9px] text-[13px] font-bold text-white rounded-[9px] hover:-translate-y-px hover:brightness-110 disabled:opacity-50 transition-all shadow-[0_4px_16px_rgba(20,184,166,0.3)]"
              style={{background: 'linear-gradient(135deg, #14b8a6, #3b82f6)'}}
            >
              {saving ? 'Guardando...' : 'Guardar metas'}
            </button>
            {savedMsg && <span className="text-[12px] text-[#14b8a6] font-medium">{savedMsg}</span>}
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
    ? 'bg-[rgba(59,130,246,0.1)] text-[#3b82f6] border border-[rgba(59,130,246,0.2)]'
    : 'bg-[rgba(245,158,11,0.1)] text-[#f59e0b] border border-[rgba(245,158,11,0.2)]';

  return (
    <div className="rounded-xl border border-[#1a2d4a] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[rgba(59,130,246,0.04)] transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${badgeCls}`} style={{fontFamily: "'JetBrains Mono', monospace"}}>
            {preview.origen}
          </span>
          <span className="text-[14px] font-semibold text-[#f0f4ff]">{preview.rubro}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-bold text-[#f0f4ff] tabular-nums">{formatKg(preview.kg_meta_total)} kg</span>
          <span className={`text-[#6b85a8] transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </div>
      </button>

      {open && (
        <div className="px-4 py-3 bg-[#0f1e38]/50 border-t border-[#1a2d4a] space-y-3">
          {/* Cálculo */}
          <div className="text-[12px] text-[#6b85a8] space-y-0.5">
            {isMondelez ? (
              <>
                <p>Objetivo: <strong className="text-[#c8d8f0]">{formatCurrency(preview.objetivo_neto ?? 0)}</strong></p>
                <p>$/kg último mes: <strong className="text-[#c8d8f0]">{formatCurrency(preview.dolar_por_kilo ?? 0)}</strong></p>
                <p>kg meta = objetivo / $/kg = <strong className="text-[#c8d8f0]">{formatKg(preview.kg_meta_total)} kg</strong></p>
              </>
            ) : (
              <>
                <p>Ventas mes anterior: <strong className="text-[#c8d8f0]">{formatKg(preview.ventas_mes_anterior ?? 0)} kg</strong></p>
                {preview.peso_mes_ant_aa_pct != null && preview.peso_mes_target_aa_pct != null && (
                  <p>
                    Peso año pasado: mes anterior <strong className="text-[#c8d8f0]">{preview.peso_mes_ant_aa_pct.toFixed(2)}%</strong>
                    {' '}vs mes target <strong className="text-[#c8d8f0]">{preview.peso_mes_target_aa_pct.toFixed(2)}%</strong>
                  </p>
                )}
                <p>Factor estacional = target% / anterior% = <strong className="text-[#c8d8f0]">{(preview.factor_estacional ?? 1).toFixed(3)}</strong></p>
                <p>kg meta = mes ant × factor = <strong className="text-[#c8d8f0]">{formatKg(preview.kg_meta_total)} kg</strong></p>
                {preview.neto_meta_total != null && preview.dolar_por_kilo != null && (
                  <p>$ meta ≈ kg meta × {formatCurrency(preview.dolar_por_kilo)}/kg = <strong className="text-[#c8d8f0]">{formatCurrency(preview.neto_meta_total)}</strong></p>
                )}
              </>
            )}
          </div>

          {/* Distribución por vendedor */}
          {preview.vendedores.length > 0 ? (
            <div className="rounded-lg border border-[#1a2d4a] overflow-hidden bg-[#0b1528]">
              <table className="min-w-full text-[12px]">
                <thead>
                  <tr className="bg-[#0f1e38]/80 border-b border-[#1a2d4a]">
                    <th className="px-3 py-2 text-left font-semibold text-[#6b85a8] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Vendedor</th>
                    <th className="px-3 py-2 text-right font-semibold text-[#6b85a8] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Peso</th>
                    <th className="px-3 py-2 text-right font-semibold text-[#6b85a8] uppercase tracking-[0.08em] text-[10px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Meta kg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a2d4a]">
                  {preview.vendedores.map(v => (
                    <tr key={v.vendedor}>
                      <td className="px-3 py-1.5 text-[#c8d8f0]">{v.vendedor}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#6b85a8]">{formatPctPlain(v.peso_pct)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium text-[#f0f4ff]">{formatKg(v.kg_meta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[12px] text-[#6b85a8] italic">Sin historial de vendedores para distribuir.</p>
          )}
        </div>
      )}
    </div>
  );
}
