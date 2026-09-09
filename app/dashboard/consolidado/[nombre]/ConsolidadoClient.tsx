'use client';

import { useMemo, useState } from 'react';
import { KpiVendedor } from '@/lib/types';
import { avanceColor, formatKg, formatPctPlain, formatCurrency, formatPct } from '@/lib/calculations/dashboard';
import { BotonExcel } from '@/components/ui/BotonExcel';
import type { ColExcel } from '@/lib/excel/exportar';

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
// `sticky` es para la columna que identifica la fila (Vendedor): con
// table-fixed las 7 columnas se repartían el ancho en partes iguales, así que
// el nombre quedaba con ~56px útiles —ocho caracteres— y "ANALIA C…" y
// "ANALIA T…" eran indistinguibles. Ahora tiene ancho propio y queda fija al
// scrollear a lo ancho, que es lo único que hace legible una tabla de 7
// columnas en un teléfono. El fondo tiene que ser opaco: el de la fila es
// translúcido y dejaría pasar las celdas que scrollean por debajo.
function TH({ children, right, sticky }: { children: React.ReactNode; right?: boolean; sticky?: boolean }) {
  return (
    <th
      className={`px-3 py-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#71717a] whitespace-nowrap ${right ? 'text-right' : 'text-left'} ${sticky ? 'sticky left-0 z-20 bg-[#f8f8f9] w-[150px]' : ''}`}
      style={MONO}
    >
      {children}
    </th>
  );
}

// Contenedor con scroll horizontal + hint de fade (solo mobile) en el borde derecho,
// para indicar que hay más columnas cuando la tabla no entra en pantalla.
function ScrollTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
        {children}
      </div>
      <div className="pointer-events-none absolute top-0 right-0 h-full w-8 bg-gradient-to-l from-white to-transparent sm:hidden" />
    </div>
  );
}

function SectionHeader({
  title,
  open,
  onToggle,
  accion,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Botón de exportar. Va afuera del toggle: un <button> no anida a otro. */
  accion?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[#e4e4e7] pr-3">
      <button
        onClick={onToggle}
        className="flex-1 flex items-center justify-between px-4 py-3 hover:bg-[rgba(12,92,171,0.04)] transition-colors lg:cursor-default"
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={MONO}>
          {title}
        </p>
        <svg
          className={`w-4 h-4 text-[#71717a] transition-transform lg:hidden ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {accion}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KG / $ por vendedor — la misma tabla; cambian el formateador y los campos
// ---------------------------------------------------------------------------
/** Las seis cifras de una fila, con un solo juego de nombres para KG y para $. */
function cifras(r: VendedorAgg, neto: boolean) {
  return neto
    ? {
        meta: r.neto_meta, acumulado: r.neto_acumulado, tendencia: r.neto_tendencia,
        avance_pct: r.neto_avance_pct, media_real: r.neto_media_real,
        media_necesaria: r.neto_media_necesaria,
      }
    : {
        meta: r.meta, acumulado: r.acumulado, tendencia: r.tendencia,
        avance_pct: r.avance_pct, media_real: r.media_real,
        media_necesaria: r.media_necesaria,
      };
}

function totales(data: VendedorAgg[], neto: boolean) {
  const t = data.map((r) => cifras(r, neto)).reduce(
    (s, r) => ({
      meta:            s.meta       + r.meta,
      acumulado:       s.acumulado  + r.acumulado,
      tendencia:       r.tendencia       != null ? (s.tendencia       ?? 0) + r.tendencia       : s.tendencia,
      media_real:      s.media_real + r.media_real,
      media_necesaria: r.media_necesaria != null ? (s.media_necesaria ?? 0) + r.media_necesaria : s.media_necesaria,
    }),
    { meta: 0, acumulado: 0, tendencia: null as number | null, media_real: 0, media_necesaria: null as number | null },
  );
  return { ...t, avance_pct: t.meta > 0 ? ((t.tendencia ?? t.acumulado) / t.meta) * 100 : 0 };
}

/** Filas del Excel: los mismos vendedores que la tabla, más el TOTAL. */
function filasVendedor(data: VendedorAgg[], neto: boolean) {
  return [
    ...data.map((r) => ({ vendedor: r.vendedor, ...cifras(r, neto) })),
    { vendedor: 'TOTAL', ...totales(data, neto) },
  ];
}

function colsVendedor(neto: boolean): ColExcel[] {
  const fmt = neto ? ('money' as const) : ('kg' as const);
  const w   = neto ? 16 : 12;
  return [
    { key: 'vendedor',        label: 'Vendedor',                  w: 26 },
    { key: 'meta',            label: neto ? 'Meta $' : 'Meta KG', fmt, w },
    { key: 'acumulado',       label: 'Acumulado',                 fmt, w },
    { key: 'tendencia',       label: 'Tendencia',                 fmt, w },
    { key: 'avance_pct',      label: 'Avance %',                  fmt: 'pct' },
    { key: 'media_real',      label: 'Media real',                fmt, w },
    { key: 'media_necesaria', label: 'Media necesaria',           fmt, w: w + 4 },
  ];
}

function VendedorKpiTable({ data, neto }: { data: VendedorAgg[]; neto: boolean }) {
  const fmt = neto ? formatCurrency : formatKg;
  const tot = totales(data, neto);

  return (
    <ScrollTable>
      <table className="table-fixed w-full text-[11px] min-w-[560px]">
        <thead>
          <tr className="border-b border-[#e4e4e7] bg-[#f4f4f5]/60">
            <TH sticky>Vendedor</TH>
            <TH right>{neto ? 'Meta $' : 'Meta KG'}</TH>
            <TH right>Acum.</TH>
            <TH right>Tend.</TH>
            <TH right>Av%</TH>
            <TH right>M.Real</TH>
            <TH right>M.Nec.</TH>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e4e4e7]">
          {data.map((row) => {
            const r = cifras(row, neto);
            return (
              <tr key={row.vendedor} className="hover:bg-[rgba(12,92,171,0.04)]">
                <td className="sticky left-0 z-10 bg-[#ffffff] px-3 py-2 text-[10px] truncate text-[#27272a]" style={MONO}>{row.vendedor}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{fmt(r.meta)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#09090b]" style={MONO}>{fmt(r.acumulado)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{r.tendencia != null ? fmt(r.tendencia) : '—'}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold text-[11px] rounded-md ${avanceColor(r.avance_pct)}`} style={MONO}>{formatPctPlain(r.avance_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{fmt(r.media_real)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{r.media_necesaria != null ? fmt(r.media_necesaria) : '—'}</td>
              </tr>
            );
          })}
          <tr className="bg-[#f4f4f5]/70 border-t-2 border-t-[#e4e4e7]">
            <td className="sticky left-0 z-10 bg-[#f7f7f8] px-3 py-2 text-[10px] text-[#09090b] font-bold" style={MONO}>TOTAL</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{fmt(tot.meta)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#09090b] font-bold" style={MONO}>{fmt(tot.acumulado)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{tot.tendencia != null ? fmt(tot.tendencia) : '—'}</td>
            <td className={`px-3 py-2 text-right tabular-nums font-bold text-[11px] rounded-md ${avanceColor(tot.avance_pct)}`} style={MONO}>{formatPctPlain(tot.avance_pct)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{fmt(tot.media_real)}</td>
            <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{tot.media_necesaria != null ? fmt(tot.media_necesaria) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </ScrollTable>
  );
}

// ---------------------------------------------------------------------------
// CCC por vendedor — con META (meta_pdvs total) y cumplimiento
// ---------------------------------------------------------------------------
const COLS_CCC: ColExcel[] = [
  { key: 'vendedor',       label: 'Vendedor',      w: 26 },
  { key: 'meta',           label: 'Meta',          fmt: 'int' },
  { key: 'mes_actual',     label: 'Acumulado',     fmt: 'int' },
  { key: 'cumplimiento',   label: 'Cumpl. %',      fmt: 'pct' },
  { key: 'mes_anterior',   label: 'Mes anterior',  fmt: 'int', w: 14 },
  { key: 'variacion_pct',  label: 'Variacion %',   fmt: 'pct', w: 14 },
];

/** Filas de la tabla de CCC, ya ordenadas y con el TOTAL al final. */
function filasCcc(data: CccRow[], metaByVendedor: Record<string, number>) {
  const filas = [...data]
    .sort((a, b) => a.vendedor.localeCompare(b.vendedor))
    .map((r) => {
      const meta = metaByVendedor[r.vendedor] ?? 0;
      return {
        ...r,
        meta:         meta > 0 ? meta : null,
        cumplimiento: meta > 0 ? (r.mes_actual / meta) * 100 : null,
      };
    });

  const mes_actual   = filas.reduce((s, r) => s + r.mes_actual, 0);
  const mes_anterior = filas.reduce((s, r) => s + r.mes_anterior, 0);
  const metaTotal    = filas.reduce((s, r) => s + (r.meta ?? 0), 0);

  const total = {
    vendedor: 'TOTAL',
    mes_actual,
    mes_anterior,
    meta:          metaTotal > 0 ? metaTotal : null,
    cumplimiento:  metaTotal > 0 ? (mes_actual / metaTotal) * 100 : null,
    variacion_pct: mes_anterior > 0 ? ((mes_actual - mes_anterior) / mes_anterior) * 100 : 0,
  };

  return { filas, total };
}

function CccVendedorTable({ data, metaByVendedor }: { data: CccRow[]; metaByVendedor: Record<string, number> }) {
  const { filas, total } = filasCcc(data, metaByVendedor);
  const totColor = total.variacion_pct > 0 ? 'text-[#15803d]' : total.variacion_pct < 0 ? 'text-[#dc2626]' : 'text-[#71717a]';

  return (
    <ScrollTable>
      <table className="table-fixed w-full text-[11px] min-w-[480px]">
        <thead>
          <tr className="border-b border-[#e4e4e7] bg-[#f4f4f5]/60">
            <TH sticky>Vendedor</TH>
            <TH right>Meta</TH>
            <TH right>Acum.</TH>
            <TH right>Cumpl.</TH>
            <TH right>Mes Ant.</TH>
            <TH right>Var%</TH>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e4e4e7]">
          {filas.map((r) => {
            const color = r.variacion_pct > 0 ? 'text-[#15803d]' : r.variacion_pct < 0 ? 'text-[#dc2626]' : 'text-[#71717a]';
            return (
              <tr key={r.vendedor} className="hover:bg-[rgba(12,92,171,0.04)]">
                <td className="sticky left-0 z-10 bg-[#ffffff] px-3 py-2 text-[10px] truncate text-[#27272a]" style={MONO}>{r.vendedor}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{r.meta ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[#09090b] font-semibold" style={MONO}>{r.mes_actual}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold text-[11px] rounded-md ${r.cumplimiento !== null ? avanceColor(r.cumplimiento) : 'text-[#71717a]'}`} style={MONO}>
                  {r.cumplimiento !== null ? formatPctPlain(r.cumplimiento) : '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{r.mes_anterior}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold ${color}`} style={MONO}>
                  {r.mes_anterior > 0 ? formatPct(r.variacion_pct) : '—'}
                </td>
              </tr>
            );
          })}
          {filas.length > 0 && (
            <tr className="bg-[#f4f4f5]/70 border-t-2 border-t-[#e4e4e7]">
              <td className="sticky left-0 z-10 bg-[#f7f7f8] px-3 py-2 text-[10px] text-[#09090b] font-bold" style={MONO}>TOTAL</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{total.meta ?? '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums text-[#09090b] font-bold" style={MONO}>{total.mes_actual}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-bold text-[11px] rounded-md ${total.cumplimiento !== null ? avanceColor(total.cumplimiento) : 'text-[#71717a]'}`} style={MONO}>
                {total.cumplimiento !== null ? formatPctPlain(total.cumplimiento) : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-[#71717a]" style={MONO}>{total.mes_anterior}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-bold ${totColor}`} style={MONO}>
                {total.mes_anterior > 0 ? formatPct(total.variacion_pct) : '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </ScrollTable>
  );
}

// ---------------------------------------------------------------------------
// Filtro de rubros — multi-select (ninguno / algunos / todos)
// ---------------------------------------------------------------------------
function RubroFilter({
  rubros,
  seleccionados,
  onToggle,
  onAll,
  onNone,
}: {
  rubros:        string[];
  seleccionados: Set<string>;
  onToggle:      (rubro: string) => void;
  onAll:         () => void;
  onNone:        () => void;
}) {
  const [open, setOpen] = useState(false);
  const todos = seleccionados.size === rubros.length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-2 text-[12px] bg-[#ffffff] border border-[#e4e4e7] rounded-[8px] text-[#27272a] hover:border-[#d4d4d8] transition-all"
      >
        <span className="text-[10px] uppercase tracking-[0.08em] text-[#71717a]" style={MONO}>Rubros</span>
        <span className="font-semibold tabular-nums" style={MONO}>
          {todos ? 'Todos' : `${seleccionados.size}/${rubros.length}`}
        </span>
        <svg className={`w-3.5 h-3.5 text-[#71717a] transition-transform ${open ? 'rotate-180' : ''}`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <>
          {/* click afuera para cerrar */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-56 bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/10 overflow-hidden">
            <div className="px-3 py-2 border-b border-[#e4e4e7] flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={MONO}>
                {seleccionados.size} de {rubros.length}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={onAll}  className="text-[11px] text-[#0c5cab] hover:underline">Todos</button>
                <span className="text-[#e4e4e7]">·</span>
                <button onClick={onNone} className="text-[11px] text-[#71717a] hover:underline">Ninguno</button>
              </div>
            </div>
            <div className="max-h-[260px] overflow-y-auto p-2 space-y-0.5">
              {rubros.map((r) => (
                <label key={r} className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-[rgba(12,92,171,0.04)]">
                  <input
                    type="checkbox"
                    checked={seleccionados.has(r)}
                    onChange={() => onToggle(r)}
                    className="accent-[#0c5cab]"
                  />
                  <span className="text-[12px] text-[#27272a]">{r}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function ConsolidadoClient({
  porVendedor,
  ccc,
  metaCccByVendedor,
  cccCaption,
}: {
  porVendedor:       KpiVendedor[];
  ccc:               CccRow[];
  metaCccByVendedor: Record<string, number>;
  /** Aclaración de período para el CCC (no se suma entre meses). */
  cccCaption?:       string;
}) {
  const [openKg,   setOpenKg]   = useState(true);
  const [openNeto, setOpenNeto] = useState(true);
  const [openCcc,  setOpenCcc]  = useState(true);

  const todosLosRubros = useMemo(
    () => [...new Set(porVendedor.map((r) => r.rubro))].filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [porVendedor],
  );

  const [rubrosSel, setRubrosSel] = useState<Set<string>>(() => new Set(todosLosRubros));
  // Al cambiar de mes/equipo llegan otros rubros y el componente NO se remonta:
  // re-seleccionamos todos para no dejar la tabla filtrada por rubros que ya no existen.
  const firma = todosLosRubros.join('|');
  const [firmaPrev, setFirmaPrev] = useState(firma);
  if (firma !== firmaPrev) {
    setFirmaPrev(firma);
    setRubrosSel(new Set(todosLosRubros));
  }

  // Filtrar ANTES de agregar: así los totales por vendedor y el TOTAL de la
  // tabla se recalculan sobre los rubros elegidos.
  const filasFiltradas = useMemo(
    () => porVendedor.filter((r) => !r.rubro || rubrosSel.has(r.rubro)),
    [porVendedor, rubrosSel],
  );
  const aggregated = useMemo(() => aggregateByVendedor(filasFiltradas), [filasFiltradas]);

  const toggleRubro = (rubro: string) => setRubrosSel((prev) => {
    const n = new Set(prev);
    if (n.has(rubro)) n.delete(rubro); else n.add(rubro);
    return n;
  });

  const filtroActivo = rubrosSel.size !== todosLosRubros.length;
  const card = 'bg-[#ffffff] rounded-2xl border border-[#e4e4e7] hover:border-[#d4d4d8] transition-all duration-200 shadow-xl shadow-black/5 overflow-hidden';

  return (
    <div className="space-y-4">
      {todosLosRubros.length > 0 && (
        <div className="flex items-center justify-end gap-3 flex-wrap">
          {filtroActivo && (
            <p className="text-[11px] text-[#71717a]">
              KG y $ filtrados por rubro. CCC no se filtra (es por cliente, no por rubro).
            </p>
          )}
          <RubroFilter
            rubros={todosLosRubros}
            seleccionados={rubrosSel}
            onToggle={toggleRubro}
            onAll={() => setRubrosSel(new Set(todosLosRubros))}
            onNone={() => setRubrosSel(new Set())}
          />
        </div>
      )}

      {/* KG */}
      <div className={card}>
        <SectionHeader
          title="Volumen (KG)" open={openKg} onToggle={() => setOpenKg(v => !v)}
          accion={<BotonExcel archivo="consolidado-kg" hoja="Volumen KG"
                              cols={colsVendedor(false)} filas={filasVendedor(aggregated, false)} />}
        />
        <div className={openKg ? '' : 'hidden lg:block'}>
          <VendedorKpiTable data={aggregated} neto={false} />
        </div>
      </div>

      {/* Neto $ */}
      <div className={card}>
        <SectionHeader
          title="Volumen ($)" open={openNeto} onToggle={() => setOpenNeto(v => !v)}
          accion={<BotonExcel archivo="consolidado-pesos" hoja="Volumen $"
                              cols={colsVendedor(true)} filas={filasVendedor(aggregated, true)} />}
        />
        <div className={openNeto ? '' : 'hidden lg:block'}>
          <VendedorKpiTable data={aggregated} neto />
        </div>
      </div>

      {/* CCC */}
      <div className={card}>
        <SectionHeader
          title={cccCaption ? `CCC — Clientes con Compra · ${cccCaption}` : 'CCC — Clientes con Compra'}
          open={openCcc}
          onToggle={() => setOpenCcc(v => !v)}
          accion={(() => {
            const { filas, total } = filasCcc(ccc, metaCccByVendedor);
            return <BotonExcel archivo="consolidado-ccc" hoja="CCC" cols={COLS_CCC} filas={[...filas, total]} />;
          })()}
        />
        <div className={openCcc ? '' : 'hidden lg:block'}>
          <CccVendedorTable data={ccc} metaByVendedor={metaCccByVendedor} />
        </div>
      </div>
    </div>
  );
}
