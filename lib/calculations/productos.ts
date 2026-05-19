import { cache } from 'react';
import { createClient, createServiceClient } from '@/lib/supabase/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CatalogoItem { rubro: string; articulo: string }

export interface ConsolidadoProductoRow {
  vendedor:  string;
  kilos:     number;
  neto:      number;
  ccc:       number;
  tendencia:        number | null; // proyección a fin de mes (kg)
  media_real:       number;        // kg / día trabajado
  neto_tendencia:   number | null; // proyección a fin de mes ($)
  neto_media_real:  number;        // $ / día trabajado
}

// ---------------------------------------------------------------------------
// Catálogo de productos (rubro → artículos) — cacheado
// ---------------------------------------------------------------------------
export const fetchCatalogoProductos = cache(async (): Promise<CatalogoItem[]> => {
  const supabase = await createClient();
  const { data } = await supabase.rpc('productos_catalogo');
  return (data ?? []).map((r: { rubro: string; articulo: string }) => ({
    rubro: r.rubro, articulo: r.articulo,
  }));
});

// ---------------------------------------------------------------------------
// Consolidado por vendedor filtrado por artículos.
// articulos vacío/null → todos.
// ---------------------------------------------------------------------------
export async function fetchConsolidadoPorProducto(
  equipo:    string,
  year:      number,
  month:     number,
  articulos: string[] | null,
  today:     Date,
): Promise<ConsolidadoProductoRow[]> {
  const svc = createServiceClient();

  const mm      = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const desde   = `${year}-${mm}-01`;
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const hasta   = isCurrentMonth
    ? today.toISOString().slice(0, 10)
    : `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;

  const [{ data: rows }, { data: diasTrabData }, { data: cfg }] = await Promise.all([
    svc.rpc('consolidado_por_producto', {
      p_desde: desde, p_hasta: hasta, p_equipo: equipo,
      p_articulos: articulos && articulos.length > 0 ? articulos : null,
    }),
    svc.rpc('kpi_dias_trabajados', { p_desde: desde, p_hasta: hasta, p_equipo: equipo }),
    svc.from('config_meses').select('dias_laborables').eq('anio', year).eq('mes', month).maybeSingle(),
  ]);

  const diasTrab = (diasTrabData as number) ?? 0;
  const diasLab  = cfg?.dias_laborables ?? 0;

  const proyectable = isCurrentMonth && diasTrab > 0 && diasLab > 0;

  return ((rows ?? []) as { vendedor: string; kilos: number; neto: number; ccc: number }[])
    .map((r) => {
      const kilos = Number(r.kilos);
      const neto  = Number(r.neto);
      const mediaReal     = diasTrab > 0 ? kilos / diasTrab : 0;
      const netoMediaReal = diasTrab > 0 ? neto  / diasTrab : 0;
      return {
        vendedor:   r.vendedor,
        kilos,
        neto,
        ccc:        Number(r.ccc),
        tendencia:       proyectable ? mediaReal * diasLab     : null,
        media_real:      mediaReal,
        neto_tendencia:  proyectable ? netoMediaReal * diasLab : null,
        neto_media_real: netoMediaReal,
      };
    });
}
