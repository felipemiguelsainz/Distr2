import { unstable_cache } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { CccData, CoberturaItem, ClientesRubro } from '@/lib/types';
import { dateStr, monthRange, vendedoresByEquipo } from './shared';

// ---------------------------------------------------------------------------
// CCC — Clientes que compraron (un vendedor, mes vs mes anterior)
// ---------------------------------------------------------------------------
export async function fetchCCC(
  vendedor: string,
  year:     number,
  month:    number
): Promise<CccData> {
  const supabase  = await createClient();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;

  const monthBounds = (y: number, m: number) => {
    const mm   = String(m).padStart(2, '0');
    const last = new Date(y, m, 0).getDate();
    return { desde: `${y}-${mm}-01`, hasta: `${y}-${mm}-${String(last).padStart(2, '0')}` };
  };
  const cur  = monthBounds(year, month);
  const prev = monthBounds(prevYear, prevMonth);

  const [{ data: mesActualData }, { data: mesAnteriorData }] = await Promise.all([
    supabase.rpc('clientes_activos_total', { p_desde: cur.desde,  p_hasta: cur.hasta,  p_vendedores: [vendedor] }),
    supabase.rpc('clientes_activos_total', { p_desde: prev.desde, p_hasta: prev.hasta, p_vendedores: [vendedor] }),
  ]);

  const actual   = Number(mesActualData   ?? 0);
  const anterior = Number(mesAnteriorData ?? 0);
  return {
    mes_actual:   actual,
    mes_anterior: anterior,
    variacion:    anterior > 0 ? ((actual - anterior) / anterior) * 100 : 0,
  };
}

// ---------------------------------------------------------------------------
// CCC por vendedor para un equipo completo
// ---------------------------------------------------------------------------
export async function fetchCCCByEquipo(
  equipo: string,
  year:   number,
  month:  number,
): Promise<{ vendedor: string; mes_actual: number; mes_anterior: number; variacion_pct: number }[]> {
  const svc      = createServiceClient();
  const vendedores = await vendedoresByEquipo(equipo);
  if (vendedores.length === 0) return [];

  const mm      = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const mesDesde = `${year}-${mm}-01`;
  const mesHasta = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  const prevMonth   = month === 1 ? 12 : month - 1;
  const prevYear    = month === 1 ? year - 1 : year;
  const prevMm      = String(prevMonth).padStart(2, '0');
  const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
  const prevDesde   = `${prevYear}-${prevMm}-01`;
  const prevHasta   = `${prevYear}-${prevMm}-${String(prevLastDay).padStart(2, '0')}`;

  const [{ data: mesData, error: mesErr }, { data: prevData, error: prevErr }] = await Promise.all([
    svc.rpc('ccc_por_vendedor', { p_desde: mesDesde, p_hasta: mesHasta, p_equipo: equipo }),
    svc.rpc('ccc_por_vendedor', { p_desde: prevDesde, p_hasta: prevHasta, p_equipo: equipo }),
  ]);
  if (mesErr)  console.error('[fetchCCCByEquipo] mes error:',  mesErr.message);
  if (prevErr) console.error('[fetchCCCByEquipo] prev error:', prevErr.message);

  type CccRow = { vendedor: string; clientes: number };
  const mesMap  = new Map(((mesData  ?? []) as CccRow[]).map(r => [r.vendedor, Number(r.clientes)]));
  const prevMap = new Map(((prevData ?? []) as CccRow[]).map(r => [r.vendedor, Number(r.clientes)]));

  return vendedores.map(v => {
    const actual   = mesMap.get(v)  ?? 0;
    const anterior = prevMap.get(v) ?? 0;
    return {
      vendedor:      v,
      mes_actual:    actual,
      mes_anterior:  anterior,
      variacion_pct: anterior > 0 ? ((actual - anterior) / anterior) * 100 : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Metas CCC (clientes con compra objetivo) por rubro + total — cacheado
// Agrega meta_pdvs de metas_ccc para el scope pedido (vendedor / equipo / todos).
// rubro NULL = meta total del vendedor.
// ---------------------------------------------------------------------------
const _fetchMetasCccImpl = unstable_cache(
  async (
    year:   number,
    month:  number,
    equipo: string | null,
    vnd:    string | null,
  ): Promise<{ porRubro: Record<string, number>; total: number }> => {
  const svc = createServiceClient();

  let vendedores: string[] | null = null;
  if (vnd) {
    vendedores = [vnd];
  } else if (equipo) {
    const names = await vendedoresByEquipo(equipo);
    vendedores = names.length > 0 ? names : ['__none__'];
  }

  let q = svc
    .from('metas_ccc')
    .select('rubro, meta_pdvs')
    .eq('mes', month)
    .eq('anio', year);
  if (vendedores) q = q.in('vendedor', vendedores);
  const { data } = await q;

  const porRubro: Record<string, number> = {};
  let total = 0;
  for (const m of (data ?? []) as { rubro: string | null; meta_pdvs: number }[]) {
    if (m.rubro === null) total += Number(m.meta_pdvs);
    else porRubro[m.rubro] = (porRubro[m.rubro] ?? 0) + Number(m.meta_pdvs);
  }
  return { porRubro, total };
  },
  ['fetchMetasCcc'],
  { revalidate: 300, tags: ['kpis'] },
);

export async function fetchMetasCcc(
  year:    number,
  month:   number,
  equipo?: string,
  vnd?:    string,
): Promise<{ porRubro: Record<string, number>; total: number }> {
  return _fetchMetasCccImpl(year, month, equipo ?? null, vnd ?? null);
}

// ---------------------------------------------------------------------------
// Clientes con compra por rubro (mes, cartera activa 3m, vs prev, vs AA) — cacheado
// ---------------------------------------------------------------------------
const _fetchClientesDataImpl = unstable_cache(
  async (
    year:     number,
    month:    number,
    todayIso: string,
    equipo:   string | null,
    vnd:      string | null,
  ): Promise<{ rows: ClientesRubro[]; cartera3mTotal: number; cccMesTotal: number; cccPrevTotal: number; cccAaTotal: number }> => {
  const today = new Date(todayIso);
  const svc   = createServiceClient();

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

  const callTotal = (desde: string, hasta: string) =>
    svc.rpc('clientes_activos_total', { p_desde: desde, p_hasta: hasta, p_vendedores: vendedores });

  const [rMes, r3m, rPrev, rAa, rTotal3m, rTotalMes, rTotalPrev, rTotalAa] = await Promise.all([
    call(mesDesde,  mesHasta),
    call(desde3m,   mesHasta),
    call(prevDesde, prevHasta),
    call(aaDesde,   aaHasta),
    callTotal(desde3m,   mesHasta),
    callTotal(mesDesde,  mesHasta),
    callTotal(prevDesde, prevHasta),
    callTotal(aaDesde,   aaHasta),
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

  return {
    rows: rubros.map(rubro => {
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
    }),
    cartera3mTotal: Number(rTotal3m.data ?? 0),
    cccMesTotal:    Number(rTotalMes.data  ?? 0),
    cccPrevTotal:   Number(rTotalPrev.data ?? 0),
    cccAaTotal:     Number(rTotalAa.data   ?? 0),
  };
  },
  ['fetchClientesData'],
  { revalidate: 300, tags: ['kpis'] },
);

export async function fetchClientesData(
  year:    number,
  month:   number,
  today:   Date,
  equipo?: string,
  vnd?:    string,
): Promise<{ rows: ClientesRubro[]; cartera3mTotal: number; cccMesTotal: number; cccPrevTotal: number; cccAaTotal: number }> {
  return _fetchClientesDataImpl(year, month, dateStr(today), equipo ?? null, vnd ?? null);
}

// ---------------------------------------------------------------------------
// Cobertura — penetración de SKUs clave — cacheado
// ---------------------------------------------------------------------------
const KEY_SKUS = [
  { sku: '2029491', articulo: 'Golden 118g',   objetivo_pct: 60 },
  { sku: '2029492', articulo: 'Golden Petite',  objetivo_pct: 45 },
  { sku: '548518',  articulo: 'Trishot',        objetivo_pct: 60 },
  { sku: 'MILKA',   articulo: 'Milka',          objetivo_pct: 60 },
];

const _fetchCoberturaImpl = unstable_cache(
  async (
    vendedor: string,
    cartera:  string | null,
    year:    number,
    month:   number,
  ): Promise<CoberturaItem[]> => {
  const supabase = createServiceClient();

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
  },
  ['fetchCobertura'],
  { revalidate: 300, tags: ['kpis'] },
);

export async function fetchCobertura(
  vendedor: string,
  cartera:  string | null,
  year:     number,
  month:    number,
): Promise<CoberturaItem[]> {
  return _fetchCoberturaImpl(vendedor, cartera, year, month);
}
