import { NextResponse } from 'next/server';
import { getPlanScope, vendedoresAsignables } from '@/lib/planificacion/scope';
import { traerTodo } from '@/lib/supabase/paginar';
import type { Cuadrante, PdvPlan, PlanificacionData } from '@/app/planificacion/types';

// Carga inicial del lienzo: todos los PDVs geolocalizados que el usuario puede
// ver, más los cuadrantes ya dibujados.
//
// A diferencia de /api/mapa, acá NO se llaman las RPC de recencia/cadencia: el
// lienzo colorea por día de visita, no por semáforo de compra, y esas RPC son
// lo más caro de aquel endpoint. `ultima_vta` sale del campo cacheado de pdvs,
// que alcanza como referencia al balancear cuadrantes.
export async function GET() {
  const scope = await getPlanScope();
  if ('error' in scope) return scope.error;
  const { svc, rol, vendedoresPermitidos } = scope;

  const PAGE = 1000;
  type RawRow = {
    pdv_id: number;
    latitud: number;
    longitud: number;
    partido: string | null;
    pdvs: Record<string, unknown> | null;
  };
  let raw: RawRow[];
  try {
    raw = await traerTodo<RawRow>((desde, hasta) =>
      svc
        .from('pdvs_geo')
        .select('pdv_id, latitud, longitud, partido, pdvs ( razon_social, domicilio, cartera, dia_visita, localidad, zona, canal_venta, ultima_vta, activo )')
        .not('latitud', 'is', null)
        .not('longitud', 'is', null)
        .range(desde, hasta) as unknown as PromiseLike<{ data: RawRow[] | null; error: { message: string } | null }>,
      { tam: PAGE },
    );
  } catch {
    return NextResponse.json({ error: 'No se pudieron cargar los PDVs.' }, { status: 500 });
  }

  const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

  let puntos: PdvPlan[] = raw
    .filter((r) => (r.pdvs as Record<string, unknown> | null)?.activo === true)
    .map((r) => {
      const pdv = r.pdvs as Record<string, unknown>;
      return {
        pdv_id:       r.pdv_id,
        lat:          round5(Number(r.latitud)),
        lon:          round5(Number(r.longitud)),
        razon_social: (pdv?.razon_social as string) ?? null,
        domicilio:    (pdv?.domicilio as string) ?? null,
        cartera:      (pdv?.cartera as string) ?? null,
        dia_visita:   (pdv?.dia_visita as string) ?? null,
        localidad:    (pdv?.localidad as string) ?? null,
        partido:      r.partido,
        zona:         (pdv?.zona as string) ?? null,
        canal_venta:  (pdv?.canal_venta as string) ?? null,
        ultima_vta:   (pdv?.ultima_vta as string) ?? null,
      };
    });

  // Cuadrantes visibles (el supervisor solo ve los de su equipo).
  let cuadQuery = svc
    .from('plan_cuadrantes')
    .select('id, nombre, dia, vendedor_nombre, color, poligono, localidad')
    .order('created_at');
  if (vendedoresPermitidos) {
    cuadQuery = cuadQuery.in('vendedor_nombre', [...vendedoresPermitidos]);
  }
  const { data: cuadRows, error: cuadErr } = await cuadQuery;
  if (cuadErr) return NextResponse.json({ error: 'No se pudieron cargar los cuadrantes.' }, { status: 500 });

  const ids = (cuadRows ?? []).map((c) => c.id as string);
  const porCuadrante = new Map<string, number[]>(ids.map((id) => [id, []]));
  if (ids.length > 0) {
    // Sin paginar el join: se traen las asignaciones de a lotes de cuadrantes
    // para no chocar con el límite de filas de PostgREST en carteras grandes.
    for (let i = 0; i < ids.length; i += 50) {
      const lote = ids.slice(i, i + 50);
      for (let page = 0; ; page++) {
        const { data } = await svc
          .from('plan_asignaciones')
          .select('cuadrante_id, pdv_id')
          .in('cuadrante_id', lote)
          .range(page * PAGE, (page + 1) * PAGE - 1);
        if (!data || data.length === 0) break;
        for (const a of data as { cuadrante_id: string; pdv_id: number }[]) {
          porCuadrante.get(a.cuadrante_id)?.push(a.pdv_id);
        }
        if (data.length < PAGE) break;
      }
    }
  }

  const cuadrantes: Cuadrante[] = (cuadRows ?? []).map((c) => ({
    id:              c.id as string,
    nombre:          c.nombre as string,
    dia:             c.dia as Cuadrante['dia'],
    vendedor_nombre: c.vendedor_nombre as string,
    color:           c.color as string,
    poligono:        c.poligono as Cuadrante['poligono'],
    localidad:       (c.localidad as string) ?? null,
    pdv_ids:         porCuadrante.get(c.id as string) ?? [],
  }));

  // El supervisor ve los PDVs de su equipo. Se suman los que ya tiene
  // asignados en algún cuadrante suyo aunque el maestro les haya cambiado la
  // cartera: si no, quedarían asignados pero invisibles, imposibles de corregir.
  if (vendedoresPermitidos) {
    const yaAsignados = new Set(cuadrantes.flatMap((c) => c.pdv_ids));
    puntos = puntos.filter(
      (p) => (p.cartera != null && vendedoresPermitidos.has(p.cartera)) || yaAsignados.has(p.pdv_id)
    );
  }

  const payload: PlanificacionData = {
    rol,
    vendedores: await vendedoresAsignables(scope),
    puntos,
    cuadrantes,
  };

  return NextResponse.json(payload, {
    // Sin caché a propósito. Con max-age el navegador servía el payload viejo
    // al volver a entrar y el cuadrante recién guardado no aparecía, como si
    // no se hubiera guardado. Los ~7k puntos tardan, pero mostrar una
    // planificación desactualizada es peor que esperar.
    headers: { 'Cache-Control': 'no-store' },
  });
}
