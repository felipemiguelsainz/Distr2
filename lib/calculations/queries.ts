import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { buildKpi } from './dashboard';
import { KpiRubro, KpiVendedor, CccData, CoberturaItem, ClientesRubro } from '@/lib/types';

// ---------------------------------------------------------------------------
// RPC row shapes
// ---------------------------------------------------------------------------
type RpcKpiRow   = { rubro: string; kilos: number; neto: number };
type RpcTrendRow = { fecha: string; kilos: number };
type RpcVendRow  = { vendedor: string; rubro: string; kilos: number; neto: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function dateStr(d: Date) { return d.toISOString().slice(0, 10); }

function cutoffDate(offsetDays: number, today: Date): string {
  const d = new Date(today);
  d.setDate(d.getDate() - offsetDays);
  return dateStr(d);
}

function monthRange(year: number, month: number) {
  const mm   = String(month).padStart(2, '0');
  const last = new Date(year, month, 0).getDate();
  return {
    desde: `${year}-${mm}-01`,
    hasta: `${year}-${mm}-${String(last).padStart(2, '0')}`,
  };
}

function pad(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

// Para meses pasados compara el mes AA completo; para el mes corriente compara hasta el mismo día.
function aaCutoffDate(year: number, month: number, today: Date): string {
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const day = isCurrentMonth
    ? today.getDate()
    : new Date(year - 1, month, 0).getDate(); // último día del mes AA
  return `${pad(year - 1, month)}-${String(day).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Fetch días laborables de config_meses — cached 1h (changes at most once/month)
// ---------------------------------------------------------------------------
const fetchDiasLaborables = unstable_cache(
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
// Core builder
// ---------------------------------------------------------------------------
function buildKpisFromRpc(
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
// Get list of vendedor names for a given equipo — memoized per request
// ---------------------------------------------------------------------------
const vendedoresByEquipo = cache(async (equipo: string): Promise<string[]> => {
  const svc = createServiceClient();
  const { data } = await svc
    .from('vendedores')
    .select('nombre')
    .eq('equipo', equipo)
    .eq('activo', true);
  return (data ?? []).map(v => v.nombre);
});

// ---------------------------------------------------------------------------
// Total company KPIs (con filtros opcionales de equipo/vendedor)
// ---------------------------------------------------------------------------
export async function fetchTotalKpis(
  year:     number,
  month:    number,
  today:    Date,
  equipo?:  string,
  vendedor?: string,
): Promise<KpiRubro[]> {
  const supabase = await createClient();
  const start    = `${pad(year, month)}-01`;
  const todayStr = dateStr(today);
  const d7       = cutoffDate(7,  today);
  const d14      = cutoffDate(14, today);
  const aaStart  = `${pad(year - 1, month)}-01`;
  const aaCutoff = aaCutoffDate(year, month, today);

  const eq  = equipo   ?? null;
  const vnd = vendedor ?? null;

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
}

// ---------------------------------------------------------------------------
// Supervisor KPIs
// ---------------------------------------------------------------------------
export async function fetchSupervisorKpis(
  equipo: string,
  year:   number,
  month:  number,
  today:  Date
): Promise<{ totales: KpiRubro[]; porVendedor: KpiVendedor[] }> {
  const supabase = await createClient();
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
}

// ---------------------------------------------------------------------------
// Vendedor KPIs
// ---------------------------------------------------------------------------
export async function fetchVendedorKpis(
  vendedor: string,
  year:     number,
  month:    number,
  today:    Date
): Promise<KpiRubro[]> {
  const supabase = await createClient();
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
}

// ---------------------------------------------------------------------------
// Trend data: daily KG for charts
// ---------------------------------------------------------------------------
export async function fetchTrendData(
  filter: { vendedor?: string; equipo?: string },
  year:   number,
  month:  number
) {
  const supabase   = await createClient();
  const { desde: curDesde, hasta: curHasta } = monthRange(year, month);
  const prevMonth  = month === 1 ? 12 : month - 1;
  const prevYear   = month === 1 ? year - 1 : year;
  const { desde: prevDesde, hasta: prevHasta } = monthRange(prevYear, prevMonth);
  const { desde: aaDesde, hasta: aaHasta }     = monthRange(year - 1, month);

  const p_equipo   = filter.equipo   ?? null;
  const p_vendedor = filter.vendedor ?? null;

  const [{ data: cur }, { data: prev }, { data: aa }] = await Promise.all([
    supabase.rpc('kpi_tendencia', { p_desde: curDesde,  p_hasta: curHasta,  p_equipo, p_vendedor }),
    supabase.rpc('kpi_tendencia', { p_desde: prevDesde, p_hasta: prevHasta, p_equipo, p_vendedor }),
    supabase.rpc('kpi_tendencia', { p_desde: aaDesde,   p_hasta: aaHasta,   p_equipo, p_vendedor }),
  ]);

  const daysInMonth = new Date(year, month, 0).getDate();

  function toDayMap(rows: RpcTrendRow[]) {
    const m = new Map<number, number>();
    for (const r of rows) {
      const d = parseInt(r.fecha.split('-')[2], 10);
      m.set(d, (m.get(d) ?? 0) + Number(r.kilos));
    }
    return m;
  }

  const curMap  = toDayMap((cur  ?? []) as RpcTrendRow[]);
  const prevMap = toDayMap((prev ?? []) as RpcTrendRow[]);
  const aaMap   = toDayMap((aa   ?? []) as RpcTrendRow[]);

  let cumCur = 0, cumPrev = 0, cumAA = 0;
  return Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    cumCur  += curMap.get(d)  ?? 0;
    cumPrev += prevMap.get(d) ?? 0;
    cumAA   += aaMap.get(d)   ?? 0;
    return {
      dia:           d,
      mes_actual:    curMap.has(d)  ? cumCur  : null,
      mes_anterior:  prevMap.has(d) ? cumPrev : null,
      anio_anterior: aaMap.has(d)   ? cumAA   : null,
    };
  });
}

// ---------------------------------------------------------------------------
// CCC — Clientes que compraron
// ---------------------------------------------------------------------------
export async function fetchCCC(
  vendedor: string,
  year:     number,
  month:    number
): Promise<CccData> {
  const supabase  = await createClient();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;

  const [{ count: mesActual }, { count: mesAnterior }] = await Promise.all([
    supabase.from('ventas').select('pdv_id', { count: 'exact', head: true })
      .eq('vendedor', vendedor).eq('mes', month).eq('anio', year),
    supabase.from('ventas').select('pdv_id', { count: 'exact', head: true })
      .eq('vendedor', vendedor).eq('mes', prevMonth).eq('anio', prevYear),
  ]);

  const actual   = mesActual   ?? 0;
  const anterior = mesAnterior ?? 0;
  return {
    mes_actual:   actual,
    mes_anterior: anterior,
    variacion:    anterior > 0 ? ((actual - anterior) / anterior) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// Clientes con compra por rubro (mes, cartera activa 3m, vs prev, vs AA)
// ---------------------------------------------------------------------------
export async function fetchClientesData(
  year:    number,
  month:   number,
  today:   Date,
  equipo?: string,
  vnd?:    string,
): Promise<ClientesRubro[]> {
  const svc = createServiceClient();

  // Resolve vendedor list for filtering
  let vendedores: string[] | null = null;
  if (vnd) {
    vendedores = [vnd];
  } else if (equipo) {
    const names = await vendedoresByEquipo(equipo);
    vendedores = names.length > 0 ? names : ['__none__'];
  }

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const mm      = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();

  const mesDesde  = `${year}-${mm}-01`;
  const mesHasta  = isCurrentMonth
    ? dateStr(today)
    : `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  // 3-month cartera activa window: 3 months before mesHasta
  const ref3m = new Date(isCurrentMonth ? today : new Date(year, month - 1, lastDay));
  ref3m.setMonth(ref3m.getMonth() - 3);
  const desde3m = dateStr(ref3m);

  // Previous month
  const prevMes  = month === 1 ? 12 : month - 1;
  const prevAnio = month === 1 ? year - 1 : year;
  const { desde: prevDesde, hasta: prevHasta } = monthRange(prevAnio, prevMes);

  // Same month, previous year
  const aaDesde = `${year - 1}-${mm}-01`;
  const aaHasta = isCurrentMonth
    ? `${year - 1}-${mm}-${String(today.getDate()).padStart(2, '0')}`
    : `${year - 1}-${mm}-${String(lastDay).padStart(2, '0')}`;

  const call = (desde: string, hasta: string) =>
    svc.rpc('clientes_compra_rubro', { p_desde: desde, p_hasta: hasta, p_vendedores: vendedores });

  const [rMes, r3m, rPrev, rAa] = await Promise.all([
    call(mesDesde,  mesHasta),
    call(desde3m,   mesHasta),
    call(prevDesde, prevHasta),
    call(aaDesde,   aaHasta),
  ]);

  type RpcRow = { rubro: string; clientes: number };
  const toMap = (rows: RpcRow[]) =>
    new Map(rows.map(r => [r.rubro, Number(r.clientes)]));

  const mesMap  = toMap((rMes.data  ?? []) as RpcRow[]);
  const m3Map   = toMap((r3m.data   ?? []) as RpcRow[]);
  const prevMap = toMap((rPrev.data ?? []) as RpcRow[]);
  const aaMap   = toMap((rAa.data   ?? []) as RpcRow[]);

  const rubros = [...new Set([
    ...mesMap.keys(), ...m3Map.keys(), ...prevMap.keys(), ...aaMap.keys(),
  ])].sort();

  return rubros.map(rubro => {
    const mes_c  = mesMap.get(rubro)  ?? 0;
    const cart3m = m3Map.get(rubro)   ?? 0;
    const prev_c = prevMap.get(rubro) ?? 0;
    const aa_c   = aaMap.get(rubro)   ?? 0;
    return {
      rubro,
      clientes_mes:          mes_c,
      cartera_activa_3m:     cart3m,
      penetracion_pct:       cart3m > 0 ? (mes_c / cart3m) * 100 : 0,
      clientes_mes_anterior: prev_c,
      vs_mes_anterior_pct:   prev_c > 0 ? ((mes_c - prev_c) / prev_c) * 100 : 0,
      clientes_aa:           aa_c,
      vs_aa_pct:             aa_c > 0 ? ((mes_c - aa_c) / aa_c) * 100 : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Cobertura — key SKU penetration
// ---------------------------------------------------------------------------
const KEY_SKUS = [
  { sku: '2029491', articulo: 'Golden 118g',   objetivo_pct: 60 },
  { sku: '2029492', articulo: 'Golden Petite',  objetivo_pct: 45 },
  { sku: '548518',  articulo: 'Trishot',        objetivo_pct: 60 },
  { sku: 'MILKA',   articulo: 'Milka',          objetivo_pct: 60 },
];

export async function fetchCobertura(
  vendedor: string,
  cartera:  string | null,
  year:     number,
  month:    number
): Promise<CoberturaItem[]> {
  const supabase = await createClient();

  // All queries run concurrently: PDV count + all SKU counts
  const [{ count: pdvsTotal }, ...skuCounts] = await Promise.all([
    supabase.from('pdvs').select('id', { count: 'exact', head: true })
      .eq('cartera', cartera ?? '').eq('activo', true),
    ...KEY_SKUS.map(({ sku }) =>
      supabase.from('ventas').select('pdv_id', { count: 'exact', head: true })
        .eq('sku', sku).eq('vendedor', vendedor).eq('mes', month).eq('anio', year)
    ),
  ]);

  const total = pdvsTotal ?? 0;
  return KEY_SKUS.map(({ sku, articulo, objetivo_pct }, i) => {
    const compraron = skuCounts[i].count ?? 0;
    return {
      sku, articulo, objetivo_pct,
      pdvs_compraron: compraron,
      pdvs_totales:   total,
      cobertura_pct:  total > 0 ? (compraron / total) * 100 : 0,
    };
  });
}
