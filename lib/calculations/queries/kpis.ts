import { unstable_cache } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { buildKpi } from '../dashboard';
import { KpiRubro, KpiVendedor } from '@/lib/types';
import {
  dateStr, cutoffDate, pad, aaCutoffDate,
  fetchDiasLaborables, buildKpisFromRpc, vendedoresByEquipo,
  RpcKpiRow, RpcVendRow,
} from './shared';

// ---------------------------------------------------------------------------
// Días laborables + días trabajados del mes corriente (global)
// ---------------------------------------------------------------------------
export async function fetchMonthInfo(
  year:  number,
  month: number,
  today: Date,
): Promise<{ diasLaborables: number; diasTrabajados: number }> {
  const supabase = await createClient();
  const start    = `${pad(year, month)}-01`;
  const hasta    = dateStr(today);

  const [diasLab, { data: diasTrabData }] = await Promise.all([
    fetchDiasLaborables(year, month),
    supabase.rpc('kpi_dias_trabajados', { p_desde: start, p_hasta: hasta }),
  ]);

  return {
    diasLaborables: diasLab,
    diasTrabajados: (diasTrabData as number) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Total company KPIs (con filtros opcionales de equipo/vendedor) — cacheado
// ---------------------------------------------------------------------------
const _fetchTotalKpisImpl = unstable_cache(
  async (
    year:    number,
    month:   number,
    todayIso: string,
    eq:      string | null,
    vnd:     string | null,
  ): Promise<KpiRubro[]> => {
  const today    = new Date(todayIso);
  const supabase = createServiceClient();
  const start    = `${pad(year, month)}-01`;
  const todayStr = dateStr(today);
  const d7       = cutoffDate(7,  today);
  const d14      = cutoffDate(14, today);
  const aaStart  = `${pad(year - 1, month)}-01`;
  const aaCutoff = aaCutoffDate(year, month, today);

  // Wave 1: all RPCs + optional vendor list — fully concurrent
  const [
    { data: cur },
    { data: r7 },
    { data: r14 },
    { data: raa },
    { data: diasTrabData },
    diasLab,
    names,
  ] = await Promise.all([
    supabase.rpc('kpi_resumen', { p_desde: start,   p_hasta: todayStr, p_equipo: eq, p_vendedor: vnd }),
    supabase.rpc('kpi_resumen', { p_desde: d7,       p_hasta: d7,       p_equipo: eq, p_vendedor: vnd }),
    supabase.rpc('kpi_resumen', { p_desde: d14,      p_hasta: d14,      p_equipo: eq, p_vendedor: vnd }),
    supabase.rpc('kpi_resumen', { p_desde: aaStart, p_hasta: aaCutoff, p_equipo: eq, p_vendedor: vnd }),
    supabase.rpc('kpi_dias_trabajados', { p_desde: start, p_hasta: todayStr, p_equipo: eq, p_vendedor: vnd }),
    fetchDiasLaborables(year, month),
    eq && !vnd ? vendedoresByEquipo(eq) : Promise.resolve<string[]>([]),
  ]);

  // Wave 2: metas (needs vendor names, but RPCs are already done/running)
  let metasQuery = supabase
    .from('metas')
    .select('rubro, kilos_meta, neto_meta')
    .eq('anio', year)
    .eq('mes', month);
  if (vnd) metasQuery = metasQuery.eq('vendedor_nombre', vnd);
  else if (eq && names.length > 0) metasQuery = metasQuery.in('vendedor_nombre', names);
  else if (eq) metasQuery = metasQuery.eq('vendedor_nombre', '__none__');
  const { data: metas } = await metasQuery;

  const metasMap    = new Map<string, number>();
  const netoMetaMap = new Map<string, number>();
  for (const m of metas ?? []) {
    metasMap.set(m.rubro, (metasMap.get(m.rubro) ?? 0) + Number(m.kilos_meta));
    if (m.neto_meta != null) {
      netoMetaMap.set(m.rubro, (netoMetaMap.get(m.rubro) ?? 0) + Number(m.neto_meta));
    }
  }

  return buildKpisFromRpc(
    (cur  ?? []) as RpcKpiRow[],
    (r7   ?? []) as RpcKpiRow[],
    (r14  ?? []) as RpcKpiRow[],
    (raa  ?? []) as RpcKpiRow[],
    metasMap, netoMetaMap, year, month, today,
    diasLab,
    (diasTrabData as number) ?? 0,
  );
  },
  ['fetchTotalKpis'],
  { revalidate: 300, tags: ['kpis'] },
);

export async function fetchTotalKpis(
  year:     number,
  month:    number,
  today:    Date,
  equipo?:  string,
  vendedor?: string,
): Promise<KpiRubro[]> {
  return _fetchTotalKpisImpl(year, month, dateStr(today), equipo ?? null, vendedor ?? null);
}

// ---------------------------------------------------------------------------
// Supervisor KPIs — cacheado
// ---------------------------------------------------------------------------
const _fetchSupervisorKpisImpl = unstable_cache(
  async (
    equipo:   string,
    year:     number,
    month:    number,
    todayIso: string,
  ): Promise<{ totales: KpiRubro[]; porVendedor: KpiVendedor[] }> => {
  const today    = new Date(todayIso);
  const supabase = createServiceClient();
  const start    = `${pad(year, month)}-01`;
  const todayStr = dateStr(today);
  const d7       = cutoffDate(7,  today);
  const d14      = cutoffDate(14, today);
  const aaStart  = `${pad(year - 1, month)}-01`;
  const aaCutoff = aaCutoffDate(year, month, today);
  const eq       = equipo || null;

  // Wave 1: all RPCs + vendor list — fully concurrent
  const [
    { data: cur },
    { data: r7 },
    { data: r14 },
    { data: raa },
    { data: porVdRaw },
    { data: diasTrabData },
    diasLab,
    equipoNames,
  ] = await Promise.all([
    supabase.rpc('kpi_resumen',      { p_desde: start,   p_hasta: todayStr,  p_equipo: eq }),
    supabase.rpc('kpi_resumen',      { p_desde: d7,       p_hasta: d7,        p_equipo: eq }),
    supabase.rpc('kpi_resumen',      { p_desde: d14,      p_hasta: d14,       p_equipo: eq }),
    supabase.rpc('kpi_resumen',      { p_desde: aaStart, p_hasta: aaCutoff,  p_equipo: eq }),
    supabase.rpc('kpi_por_vendedor', { p_desde: start,   p_hasta: todayStr,  p_equipo: eq }),
    supabase.rpc('kpi_dias_trabajados', { p_desde: start, p_hasta: todayStr, p_equipo: eq }),
    fetchDiasLaborables(year, month),
    equipo ? vendedoresByEquipo(equipo) : Promise.resolve<string[]>([]),
  ]);

  // Wave 2: metas (needs vendor names)
  let metasQuery = supabase
    .from('metas')
    .select('vendedor_nombre, rubro, kilos_meta, neto_meta')
    .eq('anio', year)
    .eq('mes', month);
  if (equipoNames.length > 0) metasQuery = metasQuery.in('vendedor_nombre', equipoNames);
  else if (equipo) metasQuery = metasQuery.eq('vendedor_nombre', '__none__');
  const { data: metas } = await metasQuery;

  const diasTrab = (diasTrabData as number) ?? 0;

  const metasTotal    = new Map<string, number>();
  const netoMetaTotal = new Map<string, number>();
  const metasVd       = new Map<string, Map<string, number>>();
  for (const m of metas ?? []) {
    metasTotal.set(m.rubro, (metasTotal.get(m.rubro) ?? 0) + Number(m.kilos_meta));
    if (m.neto_meta != null) {
      netoMetaTotal.set(m.rubro, (netoMetaTotal.get(m.rubro) ?? 0) + Number(m.neto_meta));
    }
    const vm = metasVd.get(m.vendedor_nombre) ?? new Map<string, number>();
    vm.set(m.rubro, Number(m.kilos_meta));
    metasVd.set(m.vendedor_nombre, vm);
  }

  const totales = buildKpisFromRpc(
    (cur  ?? []) as RpcKpiRow[],
    (r7   ?? []) as RpcKpiRow[],
    (r14  ?? []) as RpcKpiRow[],
    (raa  ?? []) as RpcKpiRow[],
    metasTotal, netoMetaTotal, year, month, today,
    diasLab, diasTrab,
  );

  const vdRows     = (porVdRaw ?? []) as RpcVendRow[];
  const vendedores = [...new Set(vdRows.map(r => r.vendedor))];

  const porVendedor: KpiVendedor[] = vendedores.flatMap((v) => {
    const vRows  = vdRows.filter(r => r.vendedor === v);
    const vMetas = metasVd.get(v) ?? new Map<string, number>();
    const vMap   = new Map(vRows.map(r => [r.rubro, { kilos: Number(r.kilos), neto: Number(r.neto) }]));
    const rubros = new Set([...vMetas.keys(), ...vRows.map(r => r.rubro)]);
    return [...rubros].map(rubro => ({
      ...buildKpi({
        acumulado:         vMap.get(rubro)?.kilos ?? 0,
        neto_acumulado:    vMap.get(rubro)?.neto  ?? 0,
        meta:              vMetas.get(rubro) ?? 0,
        acumulado_minus7:  0,
        acumulado_minus14: 0,
        acumulado_aa:      0,
        neto_minus7:       0,
        neto_minus14:      0,
        neto_acumulado_aa: 0,
        rubro, year, month, today,
        dias_laborables: diasLab,
        dias_trabajados: diasTrab,
      }),
      vendedor: v,
    }));
  });

  return { totales, porVendedor };
  },
  ['fetchSupervisorKpis'],
  { revalidate: 300, tags: ['kpis'] },
);

export async function fetchSupervisorKpis(
  equipo: string,
  year:   number,
  month:  number,
  today:  Date,
): Promise<{ totales: KpiRubro[]; porVendedor: KpiVendedor[] }> {
  return _fetchSupervisorKpisImpl(equipo, year, month, dateStr(today));
}

// ---------------------------------------------------------------------------
// Vendedor KPIs — cacheado
// ---------------------------------------------------------------------------
const _fetchVendedorKpisImpl = unstable_cache(
  async (
    vendedor: string,
    year:     number,
    month:    number,
    todayIso: string,
  ): Promise<KpiRubro[]> => {
  const today    = new Date(todayIso);
  const supabase = createServiceClient();
  const start    = `${pad(year, month)}-01`;
  const todayStr = dateStr(today);
  const d7       = cutoffDate(7,  today);
  const d14      = cutoffDate(14, today);
  const aaStart  = `${pad(year - 1, month)}-01`;
  const aaCutoff = aaCutoffDate(year, month, today);

  const [
    { data: cur },
    { data: r7 },
    { data: r14 },
    { data: raa },
    { data: metas },
    { data: diasTrabData },
    diasLab,
  ] = await Promise.all([
    supabase.rpc('kpi_resumen', { p_desde: start,   p_hasta: todayStr,  p_vendedor: vendedor }),
    supabase.rpc('kpi_resumen', { p_desde: d7,       p_hasta: d7,        p_vendedor: vendedor }),
    supabase.rpc('kpi_resumen', { p_desde: d14,      p_hasta: d14,       p_vendedor: vendedor }),
    supabase.rpc('kpi_resumen', { p_desde: aaStart, p_hasta: aaCutoff,  p_vendedor: vendedor }),
    supabase.from('metas').select('rubro, kilos_meta, neto_meta').eq('vendedor_nombre', vendedor).eq('anio', year).eq('mes', month),
    supabase.rpc('kpi_dias_trabajados', { p_desde: start, p_hasta: todayStr, p_vendedor: vendedor }),
    fetchDiasLaborables(year, month),
  ]);

  const metasMap    = new Map<string, number>();
  const netoMetaMap = new Map<string, number>();
  for (const m of metas ?? []) {
    metasMap.set(m.rubro, Number(m.kilos_meta));
    if (m.neto_meta != null) netoMetaMap.set(m.rubro, Number(m.neto_meta));
  }

  return buildKpisFromRpc(
    (cur  ?? []) as RpcKpiRow[],
    (r7   ?? []) as RpcKpiRow[],
    (r14  ?? []) as RpcKpiRow[],
    (raa  ?? []) as RpcKpiRow[],
    metasMap, netoMetaMap, year, month, today,
    diasLab,
    (diasTrabData as number) ?? 0,
  );
  },
  ['fetchVendedorKpis'],
  { revalidate: 300, tags: ['kpis'] },
);

export async function fetchVendedorKpis(
  vendedor: string,
  year:     number,
  month:    number,
  today:    Date,
): Promise<KpiRubro[]> {
  return _fetchVendedorKpisImpl(vendedor, year, month, dateStr(today));
}
