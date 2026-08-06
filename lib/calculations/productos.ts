import { cache } from 'react';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { Periodo } from '@/lib/periodos';
import { mapConLimite, PERIODOS_EN_PARALELO } from './queries/shared';

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
// El catálogo NO depende del período elegido: sale de `catalogo_productos`, la
// tabla materializada con TODOS los artículos que alguna vez se vendieron. Si
// está vacía (la migración 020 la creó vacía y sólo se llena al recargar ventas),
// el buscador mostraba "0 de 0": la repoblamos al vuelo con la service key —
// `recalcular_catalogo_productos` está revocada para authenticated y tarda ~2s.
export const fetchCatalogoProductos = cache(async (): Promise<CatalogoItem[]> => {
  const supabase = await createClient();
  const map = (data: unknown) =>
    ((data ?? []) as { rubro: string; articulo: string }[])
      .map((r) => ({ rubro: r.rubro, articulo: r.articulo }));

  const { data } = await supabase.rpc('productos_catalogo');
  const items = map(data);
  if (items.length > 0) return items;

  const svc = createServiceClient();
  const { error } = await svc.rpc('recalcular_catalogo_productos');
  if (error) {
    console.error('[catalogo-productos] no se pudo repoblar el catálogo:', error.message);
    return items;
  }
  const { data: retry } = await supabase.rpc('productos_catalogo');
  return map(retry);
});

// ---------------------------------------------------------------------------
// Consolidado por vendedor filtrado por artículos, para UN período.
// articulos vacío/null → todos. equipo vacío → todos los equipos (Total Empresa).
// ---------------------------------------------------------------------------
async function fetchConsolidadoUnPeriodo(
  equipo:    string,
  year:      number,
  month:     number,
  articulos: string[] | null,
  today:     Date,
): Promise<{ filas: ConsolidadoProductoRow[]; diasTrabajados: number }> {
  const svc = createServiceClient();

  const mm      = String(month).padStart(2, '0');
  const lastDay = new Date(year, month, 0).getDate();
  const desde   = `${year}-${mm}-01`;
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;
  const hasta   = isCurrentMonth
    ? today.toISOString().slice(0, 10)
    : `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
  const p_equipo = equipo || null;

  const [{ data: rows }, { data: diasTrabData }, { data: cfg }] = await Promise.all([
    svc.rpc('consolidado_por_producto', {
      p_desde: desde, p_hasta: hasta, p_equipo,
      p_articulos: articulos && articulos.length > 0 ? articulos : null,
    }),
    svc.rpc('kpi_dias_trabajados', { p_desde: desde, p_hasta: hasta, p_equipo }),
    svc.from('config_meses').select('dias_laborables').eq('anio', year).eq('mes', month).maybeSingle(),
  ]);

  const diasTrab = (diasTrabData as number) ?? 0;
  const diasLab  = cfg?.dias_laborables ?? 0;

  const proyectable = isCurrentMonth && diasTrab > 0 && diasLab > 0;

  const filas = ((rows ?? []) as { vendedor: string; kilos: number; neto: number; ccc: number }[])
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

  return { filas, diasTrabajados: diasTrab };
}

/**
 * Consolidado por producto sumando los períodos elegidos.
 * Kilos, $ y tendencia se suman; el CCC (clientes distintos) NO es sumable, así
 * que en multi-período se toma el del período más reciente.
 */
export async function fetchConsolidadoPorProducto(
  equipo:    string,
  periodos:  Periodo[],
  articulos: string[] | null,
  today:     Date,
): Promise<ConsolidadoProductoRow[]> {
  const partes = await mapConLimite(periodos, PERIODOS_EN_PARALELO, (p) =>
    fetchConsolidadoUnPeriodo(equipo, p.anio, p.mes, articulos, today),
  );

  if (partes.length === 1) return partes[0].filas;

  const diasTotales = partes.reduce((s, p) => s + p.diasTrabajados, 0);
  const cccPrincipal = new Map(
    partes[partes.length - 1].filas.map((f) => [f.vendedor, f.ccc]),
  );

  const porVendedor = new Map<string, ConsolidadoProductoRow[]>();
  for (const parte of partes) {
    for (const f of parte.filas) {
      const arr = porVendedor.get(f.vendedor) ?? [];
      arr.push(f);
      porVendedor.set(f.vendedor, arr);
    }
  }

  return [...porVendedor.entries()].map(([vendedor, filas]) => {
    const kilos = filas.reduce((s, f) => s + f.kilos, 0);
    const neto  = filas.reduce((s, f) => s + f.neto, 0);
    const proyecta     = filas.some((f) => f.tendencia !== null);
    const proyectaNeto = filas.some((f) => f.neto_tendencia !== null);
    return {
      vendedor,
      kilos,
      neto,
      ccc:             cccPrincipal.get(vendedor) ?? 0,
      tendencia:       proyecta     ? filas.reduce((s, f) => s + (f.tendencia      ?? f.kilos), 0) : null,
      media_real:      diasTotales > 0 ? kilos / diasTotales : 0,
      neto_tendencia:  proyectaNeto ? filas.reduce((s, f) => s + (f.neto_tendencia ?? f.neto),  0) : null,
      neto_media_real: diasTotales > 0 ? neto / diasTotales : 0,
    };
  });
}
