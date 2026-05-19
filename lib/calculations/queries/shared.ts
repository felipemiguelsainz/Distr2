import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { buildKpi } from '../dashboard';
import { KpiRubro } from '@/lib/types';

// ---------------------------------------------------------------------------
// RPC row shapes
// ---------------------------------------------------------------------------
export type RpcKpiRow   = { rubro: string; kilos: number; neto: number };
export type RpcTrendRow = { fecha: string; kilos: number };
export type RpcVendRow  = { vendedor: string; rubro: string; kilos: number; neto: number };

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
export function dateStr(d: Date) { return d.toISOString().slice(0, 10); }

export function cutoffDate(offsetDays: number, today: Date): string {
  const d = new Date(today);
  d.setDate(d.getDate() - offsetDays);
  return dateStr(d);
}

export function monthRange(year: number, month: number) {
  const mm   = String(month).padStart(2, '0');
  const last = new Date(year, month, 0).getDate();
  return {
    desde: `${year}-${mm}-01`,
    hasta: `${year}-${mm}-${String(last).padStart(2, '0')}`,
  };
}

export function pad(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Para meses pasados compara el mes AA completo; para el mes corriente compara hasta el mismo día.
export function aaCutoffDate(year: number, month: number, today: Date): string {
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const day = isCurrentMonth
    ? today.getDate()
    : new Date(year - 1, month, 0).getDate(); // último día del mes AA
  return `${pad(year - 1, month)}-${String(day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Fetch días laborables de config_meses — cached 1h (changes at most once/month)
// ---------------------------------------------------------------------------
export const fetchDiasLaborables = unstable_cache(
  async (year: number, month: number): Promise<number> => {
    const svc = createServiceClient();
    const { data } = await svc
      .from('config_meses')
      .select('dias_laborables')
      .eq('anio', year)
      .eq('mes', month)
      .single();
    return data?.dias_laborables ?? 0;
  },
  ['dias-laborables'],
  { revalidate: 3600 },
);

// ---------------------------------------------------------------------------
// Core builder: arma KpiRubro[] a partir de las filas crudas de los RPCs
// ---------------------------------------------------------------------------
export function buildKpisFromRpc(
  cur:  RpcKpiRow[],
  r7:   RpcKpiRow[],
  r14:  RpcKpiRow[],
  raa:  RpcKpiRow[],
  metasMap:       Map<string, number>,
  netoMetaMap:    Map<string, number>,
  year:           number,
  month:          number,
  today:          Date,
  dias_laborables: number,
  dias_trabajados: number,
): KpiRubro[] {
  const toFull = (rows: RpcKpiRow[]) =>
    new Map(rows.map(r => [r.rubro, { kilos: Number(r.kilos), neto: Number(r.neto) }]));

  const curMap = toFull(cur);
  const r7Map  = toFull(r7);
  const r14Map = toFull(r14);
  const raaMap = toFull(raa);

  const rubros = new Set([...metasMap.keys(), ...cur.map(r => r.rubro)]);

  return [...rubros].map(rubro =>
    buildKpi({
      acumulado:         curMap.get(rubro)?.kilos ?? 0,
      neto_acumulado:    curMap.get(rubro)?.neto  ?? 0,
      meta:              metasMap.get(rubro) ?? 0,
      neto_meta_stored:  netoMetaMap.size > 0 ? (netoMetaMap.get(rubro) ?? null) : null,
      acumulado_minus7:  r7Map.get(rubro)?.kilos  ?? 0,
      acumulado_minus14: r14Map.get(rubro)?.kilos ?? 0,
      acumulado_aa:      raaMap.get(rubro)?.kilos ?? 0,
      neto_minus7:       r7Map.get(rubro)?.neto   ?? 0,
      neto_minus14:      r14Map.get(rubro)?.neto  ?? 0,
      neto_acumulado_aa: raaMap.get(rubro)?.neto  ?? 0,
      rubro, year, month, today,
      dias_laborables,
      dias_trabajados,
    })
  ).sort((a, b) => a.rubro.localeCompare(b.rubro));
}

// ---------------------------------------------------------------------------
// Lista de nombres de vendedor de un equipo — memoizada por request
// ---------------------------------------------------------------------------
export const vendedoresByEquipo = cache(async (equipo: string): Promise<string[]> => {
  const svc = createServiceClient();
  const { data } = await svc
    .from('vendedores')
    .select('nombre')
    .eq('equipo', equipo)
    .eq('activo', true);
  return (data ?? []).map(v => v.nombre);
});
