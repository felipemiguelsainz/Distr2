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
};

// Mes corriente — KG
const KG_CURRENT: ColDef[] = [
  { key: 'meta',              label: 'Meta',      type: 'kg' },
  { key: 'acumulado',         label: 'Acum.',     type: 'kg' },
  { key: 'tendencia',         label: 'Tend.',     type: 'kg' },
  { key: 'avance_pct',        label: 'Av%',       type: 'pct',        colorFn: avanceColor },
  { key: 'media_real',        label: 'Med.R',     type: 'kg' },
  { key: 'media_necesaria',   label: 'Med.N',     type: 'kg' },
  { key: 'mismo_dia_minus7',  label: 'D−7',       type: 'kg' },
  { key: 'mismo_dia_minus14', label: 'D−14',      type: 'kg' },
  { key: 'acumulado_aa',      label: 'AA',        type: 'kg' },
  { key: 'avance_vs_aa_pct',  label: 'vsAA',      type: 'pct_signed', colorFn: vsAaColor },
];

// Meses pasados — KG
const KG_PAST: ColDef[] = [
  { key: 'acumulado',        label: 'Acum.',  type: 'kg' },
  { key: 'acumulado_aa',     label: 'AA',     type: 'kg' },
  { key: 'avance_vs_aa_pct', label: 'vsAA',  type: 'pct_signed', colorFn: vsAaColor },
];

// Mes corriente — Neto
const NETO_CURRENT: ColDef[] = [
  { key: 'neto_meta',              label: 'Meta',  type: 'currency' },
  { key: 'neto_acumulado',         label: 'Acum.', type: 'currency' },
  { key: 'neto_tendencia',         label: 'Tend.', type: 'currency' },
  { key: 'avance_pct',             label: 'Av%',   type: 'pct',        colorFn: avanceColor },
  { key: 'neto_media_real',        label: 'Med.R', type: 'currency' },
  { key: 'neto_media_necesaria',   label: 'Med.N', type: 'currency' },
  { key: 'neto_mismo_dia_minus7',  label: 'D−7',    type: 'currency' },
  { key: 'neto_mismo_dia_minus14', label: 'D−14',   type: 'currency' },
  { key: 'neto_acumulado_aa',      label: 'AA',    type: 'currency' },
  { key: 'neto_vs_aa_pct',         label: 'vsAA',  type: 'pct_signed', colorFn: vsAaColor },
];

// Meses pasados — Neto
const NETO_PAST: ColDef[] = [
  { key: 'neto_acumulado',    label: 'Acum.', type: 'currency' },
  { key: 'neto_acumulado_aa', label: 'AA',    type: 'currency' },
  { key: 'neto_vs_aa_pct',    label: 'vsAA',  type: 'pct_signed', colorFn: vsAaColor },
];

// ---------------------------------------------------------------------------
// Total row builder
// ---------------------------------------------------------------------------
function buildTotal(data: KpiRubro[]): KpiRubro {
  const sum = (key: keyof KpiRubro) => data.reduce((acc, r) => {
    const v = r[key]; return acc + (typeof v === 'number' ? v : 0);
  }, 0);

  const isPast        = data.every(r => r.meta === null);
  const hasTend       = data.some(r => r.tendencia !== null);
  const hasNetoTend   = data.some(r => r.neto_tendencia !== null);
  const hasMediaNec   = data.some(r => r.media_necesaria !== null);
  const hasNetoMediaNec = data.some(r => r.neto_media_necesaria !== null);

  const meta      = isPast ? null : sum('meta');
  const acumulado = sum('acumulado');
  const acum_aa   = sum('acumulado_aa');
  const neto      = sum('neto_acumulado');
  const neto_aa   = sum('neto_acumulado_aa');

  return {
    rubro:                  'TOTAL',
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
    neto_meta:              isPast ? null : (() => {
                              // Sum stored neto_meta from rows (exact $ objectives)
                              const stored = data.reduce((s, r) => s + (r.neto_meta ?? 0), 0);
                              if (stored > 0) return stored;
                              // Fall back to ratio estimate if none stored yet
                              return acumulado > 0 ? sum('meta') * (neto / acumulado) : null;
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

  if (col.type === 'dash') {
    return <td className="px-2 py-2 text-right text-xs select-none text-[#6b85a8]/50">—</td>;
  }
  if (raw === null) {
    return <td className="px-2 py-2 text-right text-xs select-none text-[#6b85a8]/50">—</td>;
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
  const baseText  = darkBg ? 'text-[#f0f4ff]' : 'text-[#c8d8f0]';

  return (
    <td className={`px-2 py-2 text-right whitespace-nowrap tabular-nums text-[12px] ${
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
  const isPast = data.length > 0 && data[0].meta === null;
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

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8] mb-2" style={{fontFamily: "'JetBrains Mono', monospace"}}>{label}</p>
      <div className="rounded-2xl border border-[#1a2d4a] shadow-xl shadow-black/30 overflow-hidden">
        <table className="w-full table-fixed">
          <thead>
            <tr className="bg-[#0f1e38]/80 border-b border-[#1a2d4a]">
              <th className="sticky left-0 z-10 bg-[#0f1e38] px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.1em] text-[#6b85a8] w-[110px]" style={{fontFamily: "'JetBrains Mono', monospace"}}>
                Rubro
              </th>
              {cols.map((c, i) => (
                <th key={`${c.key}-${i}`} className="px-2 py-2.5 text-right text-[9px] font-semibold uppercase tracking-[0.1em] text-[#6b85a8] whitespace-nowrap" style={{fontFamily: "'JetBrains Mono', monospace"}}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-[#0b1528] divide-y divide-[#1a2d4a]">
            {rows.map(({ row, kind }, idx) => {
              const isHeavy = kind === 'subtotal' || kind === 'total';
              const trCls = kind === 'total'
                ? 'border-t-2 border-[#213654] bg-[#060c1a]'
                : kind === 'subtotal'
                  ? 'border-t border-[#213654] bg-[#0f1e38]'
                  : 'hover:bg-[rgba(59,130,246,0.04)] transition-colors duration-100';
              const labelCls = kind === 'total'
                ? 'bg-[#060c1a] text-[#f0f4ff] font-bold'
                : kind === 'subtotal'
                  ? 'bg-[#0f1e38] text-[#3b82f6] font-bold tracking-wider text-[11px] uppercase'
                  : 'bg-[#0b1528] text-[#c8d8f0] font-semibold';
              return (
                <tr key={`${kind}-${idx}-${row.rubro}`} className={trCls}>
                  <td className={`sticky left-0 z-10 px-3 py-2 whitespace-nowrap text-[12px] ${labelCls}`}>
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
      <div className="rounded-2xl border border-dashed border-[#1a2d4a] py-14 text-center text-[14px] text-[#6b85a8]">
        Sin datos para el período seleccionado.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {title && <h3 className="text-[15px] font-semibold text-[#f0f4ff]">{title}</h3>}
      <DataTable data={data} label="Kilogramos"     isKg={true}  />
      {showNeto && <DataTable data={data} label="Facturación ($)" isKg={false} />}
    </div>
  );
}
