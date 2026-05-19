import { createServiceClient } from '@/lib/supabase/server';
import { MONDELEZ_RUBROS, esMondelez } from '@/lib/constants';
import { MetaPreviewRubro, MetaPreviewVendedor } from '@/lib/types';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function monthRange(anio: number, mes: number) {
  const mm   = String(mes).padStart(2, '0');
  const last = new Date(anio, mes, 0).getDate();
  return {
    desde: `${anio}-${mm}-01`,
    hasta: `${anio}-${mm}-${String(last).padStart(2, '0')}`,
  };
}

function prevMonth(anio: number, mes: number) {
  if (mes === 1) return { anio: anio - 1, mes: 12 };
  return { anio, mes: mes - 1 };
}

// ---------------------------------------------------------------------------
// Aggregation helpers — fetch from resumen_diario
// ---------------------------------------------------------------------------
type Aggregate = { kilos: number; neto: number };

async function totalesPorRubro(anio: number, mes: number): Promise<Map<string, Aggregate>> {
  const svc = createServiceClient();
  const { desde, hasta } = monthRange(anio, mes);
  const { data } = await svc.rpc('resumen_totales_por_rubro', { p_desde: desde, p_hasta: hasta });

  const map = new Map<string, Aggregate>();
  for (const r of data ?? []) {
    map.set(r.rubro, { kilos: Number(r.kilos), neto: Number(r.neto) });
  }
  return map;
}

/** Sum kg/$ por (rubro, vendedor) sobre un rango de meses */
async function totalesPorVendedorRubro(
  anioDesde: number, mesDesde: number,
  anioHasta: number, mesHasta: number,
): Promise<Map<string, Map<string, Aggregate>>> {
  const svc = createServiceClient();
  const { desde } = monthRange(anioDesde, mesDesde);
  const { hasta } = monthRange(anioHasta, mesHasta);
  const { data } = await svc.rpc('resumen_totales_por_vendedor_rubro', { p_desde: desde, p_hasta: hasta });

  const map = new Map<string, Map<string, Aggregate>>();
  for (const r of data ?? []) {
    const byVend = map.get(r.rubro) ?? new Map<string, Aggregate>();
    const cur    = byVend.get(r.vendedor) ?? { kilos: 0, neto: 0 };
    cur.kilos += Number(r.kilos);
    cur.neto  += Number(r.neto);
    byVend.set(r.vendedor, cur);
    map.set(r.rubro, byVend);
  }
  return map;
}

// ---------------------------------------------------------------------------
// $/kg del mes anterior (para conversión Mondelez)
// ---------------------------------------------------------------------------
function dolarPorKilo(totMesAnt: Map<string, Aggregate>, rubro: string): number {
  const t = totMesAnt.get(rubro);
  if (!t || t.kilos <= 0) return 0;
  return t.neto / t.kilos;
}

// ---------------------------------------------------------------------------
// Factor estacional: ventas_mes_target_AA / ventas_mes_anterior_AA
// (matemáticamente equivalente a peso_target_AA / peso_ant_AA sobre todo el año)
// ---------------------------------------------------------------------------
function factorEstacional(
  totMesTargetAA: Map<string, Aggregate>,
  totMesAntAA:    Map<string, Aggregate>,
  rubro: string,
): number {
  const target = totMesTargetAA.get(rubro)?.kilos ?? 0;
  const ant    = totMesAntAA.get(rubro)?.kilos ?? 0;
  if (ant <= 0) return 1; // sin info, factor neutro
  return target / ant;
}

// ---------------------------------------------------------------------------
// % del año pasado que pesó un mes — para mostrar al usuario
// ---------------------------------------------------------------------------
function pesoMesEnAnio(
  totMes:  Map<string, Aggregate>,
  totAnio: Map<string, Aggregate>,
  rubro:   string,
): number {
  const mes  = totMes.get(rubro)?.kilos  ?? 0;
  const anio = totAnio.get(rubro)?.kilos ?? 0;
  if (anio <= 0) return 0;
  return (mes / anio) * 100;
}

/** Totales por rubro sobre TODO un año */
async function totalesAnualesPorRubro(anio: number): Promise<Map<string, Aggregate>> {
  const svc = createServiceClient();
  const { desde } = monthRange(anio, 1);
  const { hasta } = monthRange(anio, 12);
  const { data } = await svc.rpc('resumen_totales_por_rubro', { p_desde: desde, p_hasta: hasta });
  const map = new Map<string, Aggregate>();
  for (const r of data ?? []) {
    map.set(r.rubro, { kilos: Number(r.kilos), neto: Number(r.neto) });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Peso de cada vendedor por rubro sobre N meses
// ---------------------------------------------------------------------------
function pesoVendedoresPorRubro(
  porVendRubro: Map<string, Map<string, Aggregate>>,
  rubro: string,
): Map<string, number> {
  const byVend = porVendRubro.get(rubro);
  if (!byVend) return new Map();
  const total = [...byVend.values()].reduce((s, v) => s + v.kilos, 0);
  if (total <= 0) return new Map();
  const out = new Map<string, number>();
  for (const [v, agg] of byVend) {
    if (agg.kilos > 0) out.set(v, agg.kilos / total);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cálculo principal: preview de metas para un mes target
// ---------------------------------------------------------------------------
export async function calcularMetasPreview(
  anio: number,
  mes:  number,
  objetivosMondelez: Record<string, number>, // { rubro: monto_pesos }
): Promise<MetaPreviewRubro[]> {
  const ant   = prevMonth(anio, mes);
  const aaTar = { anio: anio - 1, mes };
  const aaAnt = prevMonth(aaTar.anio, aaTar.mes);

  // 4 meses anteriores al mes target para peso de vendedores
  const pesoDesde = (() => {
    const d = new Date(anio, mes - 1, 1);
    d.setMonth(d.getMonth() - 4);
    return { anio: d.getFullYear(), mes: d.getMonth() + 1 };
  })();

  const [totAnt, totAATar, totAAAnt, porVendRubro, totAnioAA] = await Promise.all([
    totalesPorRubro(ant.anio, ant.mes),
    totalesPorRubro(aaTar.anio, aaTar.mes),
    totalesPorRubro(aaAnt.anio, aaAnt.mes),
    totalesPorVendedorRubro(pesoDesde.anio, pesoDesde.mes, ant.anio, ant.mes),
    totalesAnualesPorRubro(anio - 1),
  ]);

  const allRubros = new Set<string>([
    ...MONDELEZ_RUBROS,
    ...totAnt.keys(),
    ...porVendRubro.keys(),
  ]);

  const results: MetaPreviewRubro[] = [];

  for (const rubro of allRubros) {
    const isMondelez = esMondelez(rubro);

    let kg_meta_total = 0;
    let neto_meta_total: number | undefined;
    let objetivo_neto: number | undefined;
    let dolar_kg: number | undefined;
    let ventas_mes_anterior: number | undefined;
    let factor: number | undefined;
    let peso_target_aa: number | undefined;
    let peso_ant_aa: number | undefined;

    if (isMondelez) {
      const obj = objetivosMondelez[rubro] ?? 0;
      const dpk = dolarPorKilo(totAnt, rubro);
      objetivo_neto    = obj;
      dolar_kg         = dpk;
      kg_meta_total    = dpk > 0 ? obj / dpk : 0;
      neto_meta_total  = obj;
    } else {
      const ventasAnt   = totAnt.get(rubro)?.kilos ?? 0;
      const f           = factorEstacional(totAATar, totAAAnt, rubro);
      const dpk         = dolarPorKilo(totAnt, rubro);
      ventas_mes_anterior = ventasAnt;
      factor              = f;
      peso_target_aa      = pesoMesEnAnio(totAATar, totAnioAA, rubro);
      peso_ant_aa         = pesoMesEnAnio(totAAAnt, totAnioAA, rubro);
      kg_meta_total       = ventasAnt * f;
      // $ meta = kg meta × $/kg del mes anterior (mismo conversor que Mondelez)
      neto_meta_total     = dpk > 0 ? kg_meta_total * dpk : undefined;
      dolar_kg            = dpk > 0 ? dpk : undefined;
    }

    const pesos = pesoVendedoresPorRubro(porVendRubro, rubro);
    const vendedores: MetaPreviewVendedor[] = [...pesos.entries()]
      .map(([vendedor, peso]) => ({
        vendedor,
        peso_pct: peso * 100,
        kg_meta:  kg_meta_total * peso,
        neto_meta: neto_meta_total != null ? neto_meta_total * peso : null,
      }))
      .sort((a, b) => b.peso_pct - a.peso_pct);

    results.push({
      rubro,
      origen: isMondelez ? 'mondelez' : 'estacional',
      objetivo_neto,
      dolar_por_kilo: dolar_kg,
      ventas_mes_anterior,
      peso_mes_target_aa_pct: peso_target_aa,
      peso_mes_ant_aa_pct:    peso_ant_aa,
      factor_estacional: factor,
      kg_meta_total,
      neto_meta_total,
      vendedores,
    });
  }

  return results.sort((a, b) => {
    const ma = esMondelez(a.rubro) ? 0 : 1;
    const mb = esMondelez(b.rubro) ? 0 : 1;
    if (ma !== mb) return ma - mb;
    return a.rubro.localeCompare(b.rubro);
  });
}
