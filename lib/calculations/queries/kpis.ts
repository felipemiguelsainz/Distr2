import { unstable_cache } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { buildKpi, mergeKpis, mergeKpisVendedor } from '../dashboard';
import { KpiRubro, KpiVendedor } from '@/lib/types';
import { Periodo } from '@/lib/periodos';
import {
  dateStr, cutoffDate, pad, aaCutoffDate,
  fetchDiasLaborables, buildKpisFromRpc, vendedoresByEquipo,
  mapConLimite, PERIODOS_EN_PARALELO,
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
  ): Promise<{ kpis: KpiRubro[]; diasTrabajados: number }> => {
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

  const diasTrabajados = (diasTrabData as number) ?? 0;

  return {
    kpis: buildKpisFromRpc(
      (cur  ?? []) as RpcKpiRow[],
      (r7   ?? []) as RpcKpiRow[],
      (r14  ?? []) as RpcKpiRow[],
      (raa  ?? []) as RpcKpiRow[],
      metasMap, netoMetaMap, year, month, today,
      diasLab,
      diasTrabajados,
    ),
    diasTrabajados,
  };
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
  const { kpis } = await _fetchTotalKpisImpl(year, month, dateStr(today), equipo ?? null, vendedor ?? null);
  return kpis;
}

/** Igual que fetchTotalKpis pero sumando varios períodos (ver mergeKpis). */
export async function fetchTotalKpisMulti(
  periodos:  Periodo[],
  today:     Date,
  equipo?:   string,
  vendedor?: string,
): Promise<KpiRubro[]> {
  const partes = await mapConLimite(periodos, PERIODOS_EN_PARALELO, (p) =>
    _fetchTotalKpisImpl(p.anio, p.mes, dateStr(today), equipo ?? null, vendedor ?? null),
  );
  return mergeKpis(partes);
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
  ): Promise<{ totales: KpiRubro[]; porVendedor: KpiVendedor[]; diasTrabajados: number }> => {
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
  // Por vendedor guardamos kilos Y neto: el neto_meta cargado a mano (Configuración
  // → Metas) es el objetivo $ exacto. Si no se pasa, buildKpi lo ESTIMA como
  // kilos_meta × ($/kg realizado), y la meta de facturación del supervisor deja de
  // coincidir con la del dashboard individual (y con la matinal).
  const metasVd = new Map<string, Map<string, { kilos: number; neto: number | null }>>();
  for (const m of metas ?? []) {
    metasTotal.set(m.rubro, (metasTotal.get(m.rubro) ?? 0) + Number(m.kilos_meta));
    if (m.neto_meta != null) {
      netoMetaTotal.set(m.rubro, (netoMetaTotal.get(m.rubro) ?? 0) + Number(m.neto_meta));
    }
    const vm = metasVd.get(m.vendedor_nombre) ?? new Map<string, { kilos: number; neto: number | null }>();
    vm.set(m.rubro, { kilos: Number(m.kilos_meta), neto: m.neto_meta != null ? Number(m.neto_meta) : null });
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
    const vMetas = metasVd.get(v) ?? new Map<string, { kilos: number; neto: number | null }>();
    const vMap   = new Map(vRows.map(r => [r.rubro, { kilos: Number(r.kilos), neto: Number(r.neto) }]));
    const rubros = new Set([...vMetas.keys(), ...vRows.map(r => r.rubro)]);
    return [...rubros].map(rubro => ({
      ...buildKpi({
        acumulado:         vMap.get(rubro)?.kilos ?? 0,
        neto_acumulado:    vMap.get(rubro)?.neto  ?? 0,
        meta:              vMetas.get(rubro)?.kilos ?? 0,
        neto_meta_stored:  vMetas.get(rubro)?.neto ?? null,
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

  return { totales, porVendedor, diasTrabajados: diasTrab };
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
  const { totales, porVendedor } = await _fetchSupervisorKpisImpl(equipo, year, month, dateStr(today));
  return { totales, porVendedor };
}

/**
 * Igual que fetchSupervisorKpis pero sumando varios períodos.
 * `equipo` vacío = TODOS los equipos (vista Total Empresa del consolidado).
 */
export async function fetchSupervisorKpisMulti(
  equipo:   string,
  periodos: Periodo[],
  today:    Date,
): Promise<{ totales: KpiRubro[]; porVendedor: KpiVendedor[] }> {
  const partes = await mapConLimite(periodos, PERIODOS_EN_PARALELO, (p) =>
    _fetchSupervisorKpisImpl(equipo, p.anio, p.mes, dateStr(today)),
  );
  return {
    totales: mergeKpis(partes.map(p => ({ kpis: p.totales, diasTrabajados: p.diasTrabajados }))),
    porVendedor: mergeKpisVendedor(
      partes.map(p => ({ kpis: p.porVendedor, diasTrabajados: p.diasTrabajados })),
    ),
  };
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
  ): Promise<{ kpis: KpiRubro[]; diasTrabajados: number }> => {
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

  const diasTrabajados = (diasTrabData as number) ?? 0;

  return {
    kpis: buildKpisFromRpc(
      (cur  ?? []) as RpcKpiRow[],
      (r7   ?? []) as RpcKpiRow[],
      (r14  ?? []) as RpcKpiRow[],
      (raa  ?? []) as RpcKpiRow[],
      metasMap, netoMetaMap, year, month, today,
      diasLab,
      diasTrabajados,
    ),
    diasTrabajados,
  };
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
  const { kpis } = await _fetchVendedorKpisImpl(vendedor, year, month, dateStr(today));
  return kpis;
}

/** Igual que fetchVendedorKpis pero sumando varios períodos. */
export async function fetchVendedorKpisMulti(
  vendedor: string,
  periodos: Periodo[],
  today:    Date,
): Promise<KpiRubro[]> {
  const partes = await mapConLimite(periodos, PERIODOS_EN_PARALELO, (p) =>
    _fetchVendedorKpisImpl(vendedor, p.anio, p.mes, dateStr(today)),
  );
  return mergeKpis(partes);
}

// ---------------------------------------------------------------------------
// Ventas en un rango de fechas arbitrario (desde–hasta). SOLO lo vendido
// (kilos/$), sin metas ni proyección (que son mensuales). Es un agregado
// ADITIVO al filtro por mes: responde "cuánto se vendió del X al Y". Cacheado.
// ---------------------------------------------------------------------------
export interface VentasRango {
  porRubro: { rubro: string; kilos: number; neto: number }[];
  totalKilos: number;
  totalNeto: number;
}

const _fetchVentasRangoImpl = unstable_cache(
  async (desde: string, hasta: string, eq: string | null, vnd: string | null): Promise<VentasRango> => {
    const supabase = createServiceClient();
    const { data } = await supabase.rpc('kpi_resumen', { p_desde: desde, p_hasta: hasta, p_equipo: eq, p_vendedor: vnd });
    const porRubro = ((data ?? []) as RpcKpiRow[])
      .map((r) => ({ rubro: r.rubro, kilos: Number(r.kilos), neto: Number(r.neto) }))
      .sort((a, b) => a.rubro.localeCompare(b.rubro));
    return {
      porRubro,
      totalKilos: porRubro.reduce((s, r) => s + r.kilos, 0),
      totalNeto:  porRubro.reduce((s, r) => s + r.neto, 0),
    };
  },
  ['fetchVentasRango'],
  { revalidate: 300, tags: ['kpis'] },
);

export async function fetchVentasRango(
  desde: string, hasta: string, equipo?: string, vendedor?: string,
): Promise<VentasRango> {
  return _fetchVentasRangoImpl(desde, hasta, equipo ?? null, vendedor ?? null);
}
