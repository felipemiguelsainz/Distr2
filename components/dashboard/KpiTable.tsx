'use client';

import { KpiRubro } from '@/lib/types';
import {
  avanceColor, vsAaColor,
  formatKg, formatPct, formatPctPlain, formatCurrency,
} from '@/lib/calculations/dashboard';
import { esMondelez } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------
type ColDef = {
  key: keyof KpiRubro;
  label: string;
  type: 'kg' | 'pct' | 'pct_signed' | 'currency' | 'currency_signed' | 'dash';
  colorFn?: (val: number) => string;
  // Columnas menos críticas → ocultas en mobile (<640px) para que las prioritarias
  // (Rubro, Meta, Acum., Av%, vsAA) no se encimen. En ≥sm reaparecen.
  mobileHidden?: boolean;
};

// Mes corriente — KG. Prioritarias en mobile: Meta, Acum., Av%, vsAA.
const KG_CURRENT: ColDef[] = [
  { key: 'meta',              label: 'Meta',      type: 'kg' },
  { key: 'acumulado',         label: 'Acum.',     type: 'kg' },
  { key: 'tendencia',         label: 'Tend.',     type: 'kg',                             mobileHidden: true },
  { key: 'avance_pct',        label: 'Av%',       type: 'pct',        colorFn: avanceColor },
  { key: 'media_real',        label: 'Med.R',     type: 'kg',                             mobileHidden: true },
  { key: 'media_necesaria',   label: 'Med.N',     type: 'kg',                             mobileHidden: true },
  { key: 'mismo_dia_minus7',  label: 'D−7',       type: 'kg',                             mobileHidden: true },
  { key: 'mismo_dia_minus14', label: 'D−14',      type: 'kg',                             mobileHidden: true },
  { key: 'acumulado_aa',      label: 'AA',        type: 'kg',                             mobileHidden: true },
  { key: 'avance_vs_aa_pct',  label: 'vsAA',      type: 'pct_signed', colorFn: vsAaColor },
];

// Meses cerrados — KG. Incluye Meta y Cumpl. (cierre vs meta): sin esto, al pasar
// al mes siguiente no había forma de ver cómo cerró el mes contra su objetivo.
const KG_PAST: ColDef[] = [
  { key: 'meta',             label: 'Meta',   type: 'kg' },
  { key: 'acumulado',        label: 'Cierre', type: 'kg' },
  { key: 'avance_pct',       label: 'Cumpl.', type: 'pct',        colorFn: avanceColor },
  { key: 'media_real',       label: 'Med.R',  type: 'kg',                             mobileHidden: true },
  { key: 'acumulado_aa',     label: 'AA',     type: 'kg',                             mobileHidden: true },
  { key: 'avance_vs_aa_pct', label: 'vsAA',   type: 'pct_signed', colorFn: vsAaColor },
];

// Mes corriente — Neto. Prioritarias en mobile: Meta, Acum., Av%, vsAA.
const NETO_CURRENT: ColDef[] = [
  { key: 'neto_meta',              label: 'Meta',  type: 'currency' },
  { key: 'neto_acumulado',         label: 'Acum.', type: 'currency' },
  { key: 'neto_tendencia',         label: 'Tend.', type: 'currency',                       mobileHidden: true },
  { key: 'avance_pct',             label: 'Av%',   type: 'pct',        colorFn: avanceColor },
  { key: 'neto_media_real',        label: 'Med.R', type: 'currency',                       mobileHidden: true },
  { key: 'neto_media_necesaria',   label: 'Med.N', type: 'currency',                       mobileHidden: true },
  { key: 'neto_mismo_dia_minus7',  label: 'D−7',    type: 'currency',                      mobileHidden: true },
  { key: 'neto_mismo_dia_minus14', label: 'D−14',   type: 'currency',                      mobileHidden: true },
  { key: 'neto_acumulado_aa',      label: 'AA',    type: 'currency',                       mobileHidden: true },
  { key: 'neto_vs_aa_pct',         label: 'vsAA',  type: 'pct_signed', colorFn: vsAaColor },
];

// Meses cerrados — Neto
const NETO_PAST: ColDef[] = [
  { key: 'neto_meta',         label: 'Meta',   type: 'currency' },
  { key: 'neto_acumulado',    label: 'Cierre', type: 'currency' },
  { key: 'avance_pct',        label: 'Cumpl.', type: 'pct',        colorFn: avanceColor },
  { key: 'neto_media_real',   label: 'Med.R',  type: 'currency',                       mobileHidden: true },
  { key: 'neto_acumulado_aa', label: 'AA',     type: 'currency',                       mobileHidden: true },
  { key: 'neto_vs_aa_pct',    label: 'vsAA',   type: 'pct_signed', colorFn: vsAaColor },
];

// ---------------------------------------------------------------------------
// Total row builder
// ---------------------------------------------------------------------------
function buildTotal(data: KpiRubro[]): KpiRubro {
  const sum = (key: keyof KpiRubro) => data.reduce((acc, r) => {
    const v = r[key]; return acc + (typeof v === 'number' ? v : 0);
  }, 0);

  const hasMeta       = data.some(r => r.meta !== null);
  const hasTend       = data.some(r => r.tendencia !== null);
  const hasNetoTend   = data.some(r => r.neto_tendencia !== null);
  const hasMediaNec   = data.some(r => r.media_necesaria !== null);
  const hasNetoMediaNec = data.some(r => r.neto_media_necesaria !== null);

  const meta      = hasMeta ? sum('meta') : null;
  const acumulado = sum('acumulado');
  const acum_aa   = sum('acumulado_aa');
  const neto      = sum('neto_acumulado');
  const neto_aa   = sum('neto_acumulado_aa');

  return {
    rubro:                  'TOTAL',
    cerrado:                data.length > 0 && data.every(r => r.cerrado),
    meta,
    acumulado,
    avance_pct:             (() => {
                              if (!meta || meta <= 0) return 0;
                              const tend = hasTend ? sum('tendencia') : null;
                              return ((tend ?? acumulado) / meta) * 100;
                            })(),
    tendencia:              hasTend     ? sum('tendencia')      : null,
    media_real:             sum('media_real'),
    media_necesaria:        hasMediaNec ? sum('media_necesaria') : null,
    mismo_dia_minus7:       sum('mismo_dia_minus7'),
    mismo_dia_minus14:      sum('mismo_dia_minus14'),
    acumulado_aa:           acum_aa,
    avance_vs_aa_pct:       acum_aa > 0 ? ((acumulado - acum_aa) / acum_aa) * 100 : 0,
    neto_acumulado:         neto,
    neto_tendencia:         hasNetoTend ? sum('neto_tendencia') : null,
    neto_meta:              (() => {
                              // Sum stored neto_meta from rows (exact $ objectives)
                              const stored = data.reduce((s, r) => s + (r.neto_meta ?? 0), 0);
                              if (stored > 0) return stored;
                              // Fall back to ratio estimate if none stored yet
                              return acumulado > 0 && meta ? meta * (neto / acumulado) : null;
                            })(),
    neto_media_real:        sum('neto_media_real'),
    neto_media_necesaria:   hasNetoMediaNec ? sum('neto_media_necesaria') : null,
    neto_mismo_dia_minus7:  sum('neto_mismo_dia_minus7'),
    neto_mismo_dia_minus14: sum('neto_mismo_dia_minus14'),
    neto_acumulado_aa:      neto_aa,
    neto_vs_aa_pct:         neto_aa > 0 ? ((neto - neto_aa) / neto_aa) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// Cell renderer
// ---------------------------------------------------------------------------
function Cell({ col, row, isTotal, darkBg = false }: { col: ColDef; row: KpiRubro; isTotal: boolean; darkBg?: boolean }) {
  const raw = row[col.key];
  const hideCls = col.mobileHidden ? 'hidden sm:table-cell' : '';

  if (col.type === 'dash' || raw === null) {
    return <td className={`px-2 py-2 text-right text-xs select-none text-[#71717a]/50 ${hideCls}`}>—</td>;
  }

  const val        = Number(raw) || 0;
  const colorClass = col.colorFn ? col.colorFn(val) : '';

  let formatted: string;
  switch (col.type) {
    case 'pct':        formatted = formatPctPlain(val); break;
    case 'pct_signed': formatted = formatPct(val);      break;
    case 'currency':   formatted = formatCurrency(val); break;
    default:           formatted = formatKg(val);
  }

  const isColored = col.key === 'avance_pct' || col.key === 'avance_vs_aa_pct' || col.key === 'neto_vs_aa_pct';
  const baseText  = darkBg ? 'text-[#09090b]' : 'text-[#27272a]';

  return (
    <td className={`px-2 py-2 text-right whitespace-nowrap tabular-nums text-[12px] ${hideCls} ${
      isColored
        ? `${colorClass} ${isTotal ? 'font-bold' : 'font-semibold'}`
        : `${baseText} ${isTotal ? 'font-bold' : ''}`
    }`}>
      {formatted}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Generic table — auto-selects column set based on current vs past month
// ---------------------------------------------------------------------------
type RowKind = 'data' | 'subtotal' | 'total';

function DataTable({ data, label, isKg }: { data: KpiRubro[]; label: string; isKg: boolean }) {
  // Período cerrado → columnas de cierre (Meta / Cierre / Cumpl.), sin proyección.
  const isPast = data.length > 0 && data.every(r => r.cerrado);
  const cols   = isKg
    ? (isPast ? KG_PAST   : KG_CURRENT)
    : (isPast ? NETO_PAST : NETO_CURRENT);

  const sorted     = [...data].sort((a, b) => a.rubro.localeCompare(b.rubro));
  const mondelez   = sorted.filter(r => esMondelez(r.rubro));
  const noMondelez = sorted.filter(r => !esMondelez(r.rubro));

  const subtotalMondelez = { ...buildTotal(mondelez),   rubro: 'TOTAL MONDELEZ' };
  const totalGeneral     = { ...buildTotal(sorted),     rubro: 'TOTAL' };

  const rows: { row: KpiRubro; kind: RowKind }[] = [
    ...mondelez.map(r => ({ row: r, kind: 'data' as const })),
    ...(mondelez.length > 0 ? [{ row: subtotalMondelez, kind: 'subtotal' as const }] : []),
    ...noMondelez.map(r => ({ row: r, kind: 'data' as const })),
    { row: totalGeneral, kind: 'total' as const },
  ];

  // Min-width mantiene las columnas legibles; por debajo la tabla scrollea en vez
  // de encimar los números. En mobile se ocultan columnas (mobileHidden) → min-width
  // menor para que las prioritarias entren sin scroll; en ≥sm entran todas.
  const visibleMobile = cols.filter((c) => !c.mobileHidden).length;
  // Los 62px por columna alcanzan para kilos ("13.109") pero no para pesos:
  // formatCurrency llega a "$ 1.220.913.332", quince caracteres que en mono de
  // 12px son ~108px más el padding. Con el ancho de kilos las celdas de la
  // tabla de facturación se encimaban y los números quedaban ilegibles, que es
  // exactamente lo que este min-width existe para evitar.
  const anchoColMobile = isKg ? 62 : 124;
  const mwDesktop = 150 + cols.length * 58;
  const mwMobile  = 110 + visibleMobile * anchoColMobile;
  const cssVars = { ['--mw-m' as string]: `${mwMobile}px`, ['--mw-d' as string]: `${mwDesktop}px` } as React.CSSProperties;

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a] mb-2" style={{fontFamily: "'JetBrains Mono', monospace"}}>{label}</p>
      <div className="relative rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 overflow-hidden">
        <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">
        <table className="w-full table-fixed min-w-[var(--mw-m)] sm:min-w-[var(--mw-d)]" style={cssVars}>
          <thead>
            <tr className="bg-[#f4f4f5]/80 border-b border-[#e4e4e7]">
              <th className="sticky left-0 z-10 bg-[#f4f4f5] px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.1em] text-[#52525b] w-[110px] sm:w-[150px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>
                Rubro
              </th>
              {cols.map((c, i) => (
                <th key={`${c.key}-${i}`} className={`px-2 py-2.5 text-right text-[9px] font-semibold uppercase tracking-[0.1em] text-[#71717a] whitespace-nowrap ${c.mobileHidden ? 'hidden sm:table-cell' : ''}`} style={{fontFamily: "'JetBrains Mono', monospace"}}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-[#ffffff] divide-y divide-[#e4e4e7]">
            {rows.map(({ row, kind }, idx) => {
              const isHeavy = kind === 'subtotal' || kind === 'total';
              const trCls = kind === 'total'
                ? 'border-t-2 border-[#d4d4d8] bg-[#fafafa]'
                : kind === 'subtotal'
                  ? 'border-t border-[#d4d4d8] bg-[#f4f4f5]'
                  : 'hover:bg-[rgba(12,92,171,0.04)] transition-colors duration-100';
              const labelCls = kind === 'total'
                ? 'bg-[#fafafa] text-[#09090b] font-bold'
                : kind === 'subtotal'
                  ? 'bg-[#f4f4f5] text-[#0c5cab] font-bold tracking-wider text-[11px] uppercase'
                  : 'bg-[#ffffff] text-[#27272a] font-semibold';
              return (
                <tr key={`${kind}-${idx}-${row.rubro}`} className={trCls}>
                  <td className={`sticky left-0 z-10 px-3 py-2 truncate max-w-[110px] sm:max-w-[150px] text-[12px] ${labelCls}`}>
                    {row.rubro}
                  </td>
                  {cols.map((col, i) => (
                    <Cell key={`${col.key}-${i}`} col={col} row={row} isTotal={isHeavy} darkBg={isHeavy} />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        {/* Hint de scroll horizontal (solo mobile): degradé en el borde derecho. */}
        <div className="pointer-events-none absolute top-0 right-0 h-full w-8 bg-gradient-to-l from-white to-transparent sm:hidden" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------
interface KpiTableProps {
  data: KpiRubro[];
  title?: string;
  showNeto?: boolean;
}

export function KpiTable({ data, title, showNeto = true }: KpiTableProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#e4e4e7] py-14 text-center text-[14px] text-[#71717a]">
        Sin datos para el período seleccionado.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {title && <h3 className="text-[15px] font-semibold text-[#09090b]">{title}</h3>}
      <DataTable data={data} label="Kilogramos"     isKg={true}  />
      {showNeto && <DataTable data={data} label="Facturación ($)" isKg={false} />}
    </div>
  );
}
