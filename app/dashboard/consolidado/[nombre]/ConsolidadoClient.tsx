'use client';

import { useMemo, useState } from 'react';
import { KpiVendedor } from '@/lib/types';
import { avanceColor, formatKg, formatPctPlain, formatCurrency, formatPct } from '@/lib/calculations/dashboard';

const MONO = { fontFamily: "'JetBrains Mono', monospace" };

type CccRow = { vendedor: string; mes_actual: number; mes_anterior: number; variacion_pct: number };

interface VendedorAgg {
  vendedor: string;
  // KG
  meta: number;
  acumulado: number;
  tendencia: number | null;
  avance_pct: number;
  media_real: number;
  media_necesaria: number | null;
  // $
  neto_meta: number;
  neto_acumulado: number;
  neto_tendencia: number | null;
  neto_avance_pct: number;
  neto_media_real: number;
  neto_media_necesaria: number | null;
}

function aggregateByVendedor(rows: KpiVendedor[]): VendedorAgg[] {
  const map = new Map<string, VendedorAgg>();
  for (const r of rows) {
    const a = map.get(r.vendedor) ?? {
      vendedor: r.vendedor,
      meta: 0, acumulado: 0, tendencia: null, avance_pct: 0, media_real: 0, media_necesaria: null,
      neto_meta: 0, neto_acumulado: 0, neto_tendencia: null, neto_avance_pct: 0, neto_media_real: 0, neto_media_necesaria: null,
    };
    a.meta            += r.meta ?? 0;
    a.acumulado       += r.acumulado;
    if (r.tendencia       != null) a.tendencia       = (a.tendencia       ?? 0) + r.tendencia;
    a.media_real      += r.media_real;
    if (r.media_necesaria != null) a.media_necesaria = (a.media_necesaria ?? 0) + r.media_necesaria;
    a.neto_meta            += r.neto_meta ?? 0;
    a.neto_acumulado       += r.neto_acumulado;
    if (r.neto_tendencia       != null) a.neto_tendencia       = (a.neto_tendencia       ?? 0) + r.neto_tendencia;
    a.neto_media_real      += r.neto_media_real;
    if (r.neto_media_necesaria != null) a.neto_media_necesaria = (a.neto_media_necesaria ?? 0) + r.neto_media_necesaria;
    map.set(r.vendedor, a);
  }
  for (const a of map.values()) {
    a.avance_pct      = a.meta      > 0 ? ((a.tendencia      ?? a.acumulado)      / a.meta)      * 100 : 0;
    a.neto_avance_pct = a.neto_meta > 0 ? ((a.neto_tendencia ?? a.neto_acumulado) / a.neto_meta) * 100 : 0;
  }
  return [...map.values()].sort((a, b) => a.vendedor.localeCompare(b.vendedor));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function TH({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 py-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8] whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={MONO}
    >
      {children}
    </th>
  );
}

function SectionHeader({
  title,
  open,
  onToggle,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 border-b border-[#1a2d4a] hover:bg-[rgba(59,130,246,0.04)] transition-colors lg:cursor-default"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={MONO}>
        {title}
      </p>
      <svg
        className={`w-4 h-4 text-[#6b85a8] transition-transform lg:hidden ${open ? 'rotate-180' : ''}`}
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// KG por vendedor
// ---------------------------------------------------------------------------
function KgVendedorTable({ data }: { data: VendedorAgg[] }) {
  const tot = data.reduce(
    (s, r) => ({
      meta:            s.meta            + r.meta,
      acumulado:       s.acumulado       + r.acumulado,
      tendencia:       r.tendencia       != null ? (s.tendencia       ?? 0) + r.tendencia       : s.tendencia,
      media_real:      s.media_real      + r.media_real,
      media_necesaria: r.media_necesaria != null ? (s.media_necesaria ?? 0) + r.media_necesaria : s.media_necesaria,
    }),
    { meta: 0, acumulado: 0, tendencia: null as number | null, media_real: 0, media_necesaria: null as number | null },
  );
  const totAvance = tot.meta > 0 ? ((tot.tendencia ?? tot.acumulado) / tot.meta) * 100 : 0;

  return (
    <div className="overflow-x-auto">
      <table className="table-fixed w-full text-[11px]">
        <thead>
          <tr className="border-b border-[#1a2d4a] bg-[#0f1e38]/60">
            <TH>Vendedor</TH>
            <TH right>Meta KG</TH>
            <TH right>Acum.</TH>
            <TH right>Tend.</TH>
            <TH right>Av%</TH>
            <TH right>M.Real</TH>
            <TH right>M.Nec.</TH>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1a2d4a]">
          {data.map((r) => (
            <tr key={r.vendedor} className="hover:bg-[rgba(59,130,246,0.04)]">
              <td className="px-3 py-2 text-[10px] truncate text-[#c8d8f0]" style={MONO}>{r.vendedor}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{formatKg(r.meta)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#f0f4ff]" style={MONO}>{formatKg(r.acumulado)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{r.tendencia != null ? formatKg(r.tendencia) : '—'}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-semibold text-[11px] rounded-md ${avanceColor(r.avance_pct)}`} style={MONO}>{formatPctPlain(r.avance_pct)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{formatKg(r.media_real)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{r.media_necesaria != null ? formatKg(r.media_necesaria) : '—'}</td>
            </tr>
          ))}
          <tr className="bg-[#0f1e38]/70 border-t-2 border-t-[#1a2d4a]">
            <td className="px-3 py-2 text-[10px] text-[#f0f4ff] font-bold" style={MONO}>TOTAL</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{formatKg(tot.meta)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#f0f4ff] font-bold" style={MONO}>{formatKg(tot.acumulado)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{tot.tendencia != null ? formatKg(tot.tendencia) : '—'}</td>
            <td className={`px-3 py-2 text-right tabular-nums font-bold text-[11px] rounded-md ${avanceColor(totAvance)}`} style={MONO}>{formatPctPlain(totAvance)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{formatKg(tot.media_real)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{tot.media_necesaria != null ? formatKg(tot.media_necesaria) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// $ Neto por vendedor
// ---------------------------------------------------------------------------
function NetoVendedorTable({ data }: { data: VendedorAgg[] }) {
  const tot = data.reduce(
    (s, r) => ({
      meta:            s.meta            + r.neto_meta,
      acumulado:       s.acumulado       + r.neto_acumulado,
      tendencia:       r.neto_tendencia       != null ? (s.tendencia       ?? 0) + r.neto_tendencia       : s.tendencia,
      media_real:      s.media_real      + r.neto_media_real,
      media_necesaria: r.neto_media_necesaria != null ? (s.media_necesaria ?? 0) + r.neto_media_necesaria : s.media_necesaria,
    }),
    { meta: 0, acumulado: 0, tendencia: null as number | null, media_real: 0, media_necesaria: null as number | null },
  );
  const totAvance = tot.meta > 0 ? ((tot.tendencia ?? tot.acumulado) / tot.meta) * 100 : 0;

  return (
    <div className="overflow-x-auto">
      <table className="table-fixed w-full text-[11px]">
        <thead>
          <tr className="border-b border-[#1a2d4a] bg-[#0f1e38]/60">
            <TH>Vendedor</TH>
            <TH right>Meta $</TH>
            <TH right>Acum.</TH>
            <TH right>Tend.</TH>
            <TH right>Av%</TH>
            <TH right>M.Real</TH>
            <TH right>M.Nec.</TH>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1a2d4a]">
          {data.map((r) => (
            <tr key={r.vendedor} className="hover:bg-[rgba(59,130,246,0.04)]">
              <td className="px-3 py-2 text-[10px] truncate text-[#c8d8f0]" style={MONO}>{r.vendedor}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{formatCurrency(r.neto_meta)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#f0f4ff]" style={MONO}>{formatCurrency(r.neto_acumulado)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{r.neto_tendencia != null ? formatCurrency(r.neto_tendencia) : '—'}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-semibold text-[11px] rounded-md ${avanceColor(r.neto_avance_pct)}`} style={MONO}>{formatPctPlain(r.neto_avance_pct)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{formatCurrency(r.neto_media_real)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{r.neto_media_necesaria != null ? formatCurrency(r.neto_media_necesaria) : '—'}</td>
            </tr>
          ))}
          <tr className="bg-[#0f1e38]/70 border-t-2 border-t-[#1a2d4a]">
            <td className="px-3 py-2 text-[10px] text-[#f0f4ff] font-bold" style={MONO}>TOTAL</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{formatCurrency(tot.meta)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#f0f4ff] font-bold" style={MONO}>{formatCurrency(tot.acumulado)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{tot.tendencia != null ? formatCurrency(tot.tendencia) : '—'}</td>
            <td className={`px-3 py-2 text-right tabular-nums font-bold text-[11px] rounded-md ${avanceColor(totAvance)}`} style={MONO}>{formatPctPlain(totAvance)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{formatCurrency(tot.media_real)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{tot.media_necesaria != null ? formatCurrency(tot.media_necesaria) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CCC por vendedor — sin META (no modelada todavía)
// ---------------------------------------------------------------------------
function CccVendedorTable({ data }: { data: CccRow[] }) {
  const sorted = [...data].sort((a, b) => a.vendedor.localeCompare(b.vendedor));
  const totAct = sorted.reduce((s, r) => s + r.mes_actual, 0);
  const totAnt = sorted.reduce((s, r) => s + r.mes_anterior, 0);
  const totVar = totAnt > 0 ? ((totAct - totAnt) / totAnt) * 100 : 0;
  const totColor = totVar > 0 ? 'text-[#14b8a6]' : totVar < 0 ? 'text-[#f87171]' : 'text-[#6b85a8]';

  return (
    <div className="overflow-x-auto">
      <table className="table-fixed w-full text-[11px]">
        <thead>
          <tr className="border-b border-[#1a2d4a] bg-[#0f1e38]/60">
            <TH>Vendedor</TH>
            <TH right>Acum.</TH>
            <TH right>Mes Ant.</TH>
            <TH right>Var%</TH>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1a2d4a]">
          {sorted.map((r) => {
            const color = r.variacion_pct > 0 ? 'text-[#14b8a6]' : r.variacion_pct < 0 ? 'text-[#f87171]' : 'text-[#6b85a8]';
            return (
              <tr key={r.vendedor} className="hover:bg-[rgba(59,130,246,0.04)]">
                <td className="px-3 py-2 text-[10px] truncate text-[#c8d8f0]" style={MONO}>{r.vendedor}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#f0f4ff] font-semibold" style={MONO}>{r.mes_actual}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{r.mes_anterior}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold ${color}`} style={MONO}>
                  {r.mes_anterior > 0 ? formatPct(r.variacion_pct) : '—'}
                </td>
              </tr>
            );
          })}
          {sorted.length > 0 && (
            <tr className="bg-[#0f1e38]/70 border-t-2 border-t-[#1a2d4a]">
              <td className="px-3 py-2 text-[10px] text-[#f0f4ff] font-bold" style={MONO}>TOTAL</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#f0f4ff] font-bold" style={MONO}>{totAct}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#6b85a8]" style={MONO}>{totAnt}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-bold ${totColor}`} style={MONO}>
                {totAnt > 0 ? formatPct(totVar) : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function ConsolidadoClient({
  porVendedor,
  ccc,
}: {
  porVendedor: KpiVendedor[];
  ccc:         CccRow[];
}) {
  const [openKg,   setOpenKg]   = useState(true);
  const [openNeto, setOpenNeto] = useState(true);
  const [openCcc,  setOpenCcc]  = useState(true);

  const aggregated = useMemo(() => aggregateByVendedor(porVendedor), [porVendedor]);

  const card = 'bg-[#0b1528] rounded-2xl border border-[#1a2d4a] hover:border-[#213654] transition-all duration-200 shadow-xl shadow-black/30 overflow-hidden';

  return (
    <div className="space-y-4">
      {/* KG */}
      <div className={card}>
        <SectionHeader title="Volumen (KG)" open={openKg} onToggle={() => setOpenKg(v => !v)} />
        <div className={openKg ? '' : 'hidden lg:block'}>
          <KgVendedorTable data={aggregated} />
        </div>
      </div>

      {/* Neto $ */}
      <div className={card}>
        <SectionHeader title="Volumen ($)" open={openNeto} onToggle={() => setOpenNeto(v => !v)} />
        <div className={openNeto ? '' : 'hidden lg:block'}>
          <NetoVendedorTable data={aggregated} />
        </div>
      </div>

      {/* CCC */}
      <div className={card}>
        <SectionHeader title="CCC — Clientes con Compra" open={openCcc} onToggle={() => setOpenCcc(v => !v)} />
        <div className={openCcc ? '' : 'hidden lg:block'}>
          <CccVendedorTable data={ccc} />
        </div>
      </div>
    </div>
  );
}
