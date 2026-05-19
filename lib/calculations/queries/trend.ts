import { createClient } from '@/lib/supabase/server';
import { monthRange, RpcTrendRow } from './shared';

// ---------------------------------------------------------------------------
// Trend data: KG acumulado diario para los gráficos de tendencia
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
