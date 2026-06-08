'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from 'recharts';
import type { KpiRubro } from '@/lib/types';

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────
function fmtKg(v: number) {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (v >= 1_000) return (v / 1_000).toFixed(0) + 'k';
  return v.toFixed(0);
}

function fmtKgFull(v: number) {
  return v.toLocaleString('es-AR', { maximumFractionDigits: 0 }) + ' kg';
}

const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };
const CARD = 'bg-[#ffffff] rounded-2xl border border-[#e4e4e7] hover:border-[#d4d4d8] transition-all duration-200 shadow-xl shadow-black/5 p-5';
const SECTION_TITLE = 'text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a] mb-4';

const TOOLTIP_STYLE = {
  backgroundColor: '#f4f4f5',
  border: '1px solid #e4e4e7',
  borderRadius: 10,
  fontSize: 12,
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  color: '#09090b',
};

// ─────────────────────────────────────────────
// 1. Cumulative trend line chart
// ─────────────────────────────────────────────
interface TrendPoint {
  dia: number;
  mes_actual: number | null;
  mes_anterior: number | null;
  anio_anterior: number | null;
}

interface TrendChartProps {
  data: TrendPoint[];
  title?: string;
  meta?: number; // optional horizontal reference line (total KG meta)
}

export function TrendChart({ data, title, meta }: TrendChartProps) {
  const tooltipStyle = TOOLTIP_STYLE;

  return (
    <div className={CARD}>
      {title && <p className={SECTION_TITLE} style={MONO}>{title}</p>}

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(228,228,231,0.8)" vertical={false} />
          <XAxis
            dataKey="dia"
            tick={{ fontSize: 10, fill: '#71717a' }}
            axisLine={false}
            tickLine={false}
            interval={4}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#71717a' }}
            width={44}
            axisLine={false}
            tickLine={false}
            tickFormatter={fmtKg}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(val, name) => [fmtKgFull(Number(val)), String(name)]}
            labelFormatter={(d) => `Día ${d}`}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 14, color: '#71717a' }}
            iconType="plainline"
            iconSize={16}
          />

          {/* Optional meta reference line */}
          {meta != null && meta > 0 && (
            <ReferenceLine
              y={meta}
              stroke="#0c5cab"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: 'Meta', position: 'right', fontSize: 10, fill: '#0c5cab' }}
            />
          )}

          <Line
            type="monotone"
            dataKey="mes_actual"
            name="Mes actual"
            stroke="#0c5cab"
            strokeWidth={2.5}
            dot={false}
            connectNulls
            activeDot={{ r: 4, fill: '#0c5cab', stroke: '#ffffff', strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="anio_anterior"
            name="Año anterior"
            stroke="#d97706"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="mes_anterior"
            name="Mes anterior"
            stroke="#71717a"
            strokeWidth={1.5}
            strokeDasharray="3 2"
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────────────────────────
// 2. Proyección vs Meta — custom CSS bullet chart
// ─────────────────────────────────────────────
interface AvanceBarChartProps {
  data: KpiRubro[];
  title?: string;
}

function trackColor(pct: number) {
  if (pct >= 95) return { bar: '#16a34a', ghost: '#16a34a20', text: 'text-[#16a34a]' };
  if (pct >= 75) return { bar: '#d97706', ghost: '#d9770620', text: 'text-[#d97706]' };
  return        { bar: '#dc2626',  ghost: '#dc262620', text: 'text-[#dc2626]' };
}

export function AvanceBarChart({ data, title }: AvanceBarChartProps) {
  // Only show rows with a meta defined
  const rows = data.filter(d => d.meta !== null && d.meta > 0);

  if (rows.length === 0) {
    return (
      <div className={CARD}>
        {title && <p className={SECTION_TITLE} style={MONO}>{title}</p>}
        <p className="text-[#71717a] text-sm">Sin metas cargadas.</p>
      </div>
    );
  }

  return (
    <div className={CARD}>
      {title && <p className={SECTION_TITLE} style={MONO}>{title}</p>}

      {/* Legend */}
      <div className="flex gap-4 mb-5 flex-wrap">
        <span className="flex items-center gap-1.5 text-[10px] text-[#71717a]">
          <span className="w-3 h-2 rounded-sm inline-block bg-[#0c5cab]" />
          Acumulado
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-[#71717a]">
          <span className="w-3 h-2 rounded-sm inline-block opacity-40 bg-[#0c5cab]" />
          Tendencia
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-[#71717a]">
          <span className="w-0.5 h-3 inline-block bg-white/50" />
          Meta (100%)
        </span>
      </div>

      <div className="space-y-3.5">
        {rows.map(d => {
          const meta = d.meta!;
          const tend = d.tendencia ?? d.acumulado;
          const acumPct  = Math.min((d.acumulado / meta) * 100, 140);
          const tendPct  = Math.min((tend / meta) * 100, 140);
          const avPct    = d.avance_pct;
          const { bar, ghost, text } = trackColor(avPct);

          // vs AA delta
          const vsAa = d.avance_vs_aa_pct;
          const vsAaLabel = vsAa !== null
            ? (vsAa >= 0 ? `+${vsAa.toFixed(0)}%` : `${vsAa.toFixed(0)}%`)
            : null;
          const vsAaColor = vsAa !== null && vsAa >= 0 ? 'text-[#16a34a]' : 'text-[#dc2626]';

          return (
            <div key={d.rubro}>
              {/* Header row */}
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-[11px] font-semibold text-[#27272a]" style={MONO}>
                  {d.rubro}
                </span>
                <div className="flex items-baseline gap-3">
                  {vsAaLabel && (
                    <span className={`text-[10px] ${vsAaColor}`} style={MONO}>
                      vs AA {vsAaLabel}
                    </span>
                  )}
                  <span className={`text-[12px] font-bold tabular-nums ${text}`} style={MONO}>
                    {avPct.toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Bar track */}
              <div className="relative h-5 rounded-full overflow-hidden" style={{ background: '#f4f4f5' }}>
                {/* Tendencia ghost bar */}
                {tend > d.acumulado && (
                  <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                    style={{ width: `${tendPct / 140 * 100}%`, background: ghost, borderRight: `1px solid ${bar}40` }}
                  />
                )}
                {/* Acumulado solid bar */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                  style={{ width: `${acumPct / 140 * 100}%`, background: bar }}
                />
                {/* Meta line at 100% = 71.4% of track */}
                <div
                  className="absolute inset-y-0 w-px bg-white/50"
                  style={{ left: `${100 / 140 * 100}%` }}
                />
              </div>

              {/* Sub-labels */}
              <div className="flex justify-between mt-0.5">
                <span className="text-[9px] text-[#71717a]" style={MONO}>
                  {fmtKg(d.acumulado)} kg
                </span>
                {tend !== d.acumulado && (
                  <span className="text-[9px] text-[#71717a]" style={MONO}>
                    Tend: {fmtKg(tend)} kg
                  </span>
                )}
                <span className="text-[9px] text-[#71717a]" style={MONO}>
                  Meta: {fmtKg(meta)} kg
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 3. Radar — Cumplimiento vs Meta · Por Rubro
// ─────────────────────────────────────────────
interface RadarMetaChartProps {
  data: KpiRubro[];
  title?: string;
}

function radarColor(pct: number) {
  if (pct >= 100) return '#16a34a';
  if (pct >= 75)  return '#d97706';
  return '#dc2626';
}

export function RadarMetaChart({ data, title }: RadarMetaChartProps) {
  const rows = data.filter(d => d.meta !== null && d.meta > 0);
  if (rows.length === 0) return null;

  const radarData = rows.map(d => ({
    label: d.rubro.length > 9 ? d.rubro.slice(0, 9) : d.rubro,
    rubro: d.rubro,
    value: Math.min(d.avance_pct, 150),
    meta:  100,
    pct:   d.avance_pct,
  }));

  return (
    <div className={CARD}>
      {title && <p className={SECTION_TITLE} style={MONO}>{title}</p>}

      <div className="flex items-center gap-2">
        {/* ── Radar ── */}
        <div className="flex-1 min-w-0">
          <ResponsiveContainer width="100%" height={200}>
            <RadarChart data={radarData} margin={{ top: 4, right: 20, bottom: 4, left: 20 }}>
              <PolarGrid stroke="rgba(228,228,231,1)" />
              <PolarAngleAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: '#71717a', fontFamily: "'JetBrains Mono', monospace" }}
              />
              <PolarRadiusAxis
                angle={90}
                domain={[0, 150]}
                tickCount={4}
                tick={{ fontSize: 8, fill: '#71717a' }}
                tickFormatter={(v: number) => v === 100 ? 'META' : `${v}%`}
              />
              {/* 100% reference shape */}
              <Radar
                name="Meta"
                dataKey="meta"
                stroke="#0c5cab"
                fill="#0c5cab"
                fillOpacity={0.06}
                strokeDasharray="4 2"
                strokeWidth={1.5}
              />
              {/* Actual avance */}
              <Radar
                name="Avance"
                dataKey="value"
                stroke="#0c5cab"
                fill="#0c5cab"
                fillOpacity={0.18}
                strokeWidth={2}
                dot={{ fill: '#0c5cab', r: 3 }}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, name) =>
                  name === 'Meta'
                    ? ['100% (objetivo)', 'Meta']
                    : [`${Number(v).toFixed(1)}%`, 'Avance']
                }
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* ── List ── */}
        <div className="w-32 shrink-0 space-y-[7px]">
          {rows.map(d => {
            const pct      = d.avance_pct;
            const color    = radarColor(pct);
            const barWidth = Math.min(pct, 150) / 150 * 100;
            return (
              <div key={d.rubro}>
                <div className="flex items-baseline justify-between mb-[3px]">
                  <span
                    className="text-[9px] text-[#71717a] truncate max-w-[72px]"
                    style={MONO}
                  >
                    {d.rubro}
                  </span>
                  <span
                    className="text-[10px] font-bold tabular-nums ml-1 shrink-0"
                    style={{ color, fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    {pct.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#f4f4f5' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${barWidth}%`,
                      background: color,
                      transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
