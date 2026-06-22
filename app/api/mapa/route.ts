import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import type { PdvGeo } from '@/app/mapa/types';

// Map PDV points for the authenticated user. Heavy payload (~6.6k rows), so it
// lives in a route handler fetched client-side instead of blocking the page's
// initial HTML. Same role-based access control as the dashboards.
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'Sin perfil' }, { status: 403 });

  const svc = createServiceClient();

  // Última venta real por PDV (pivot desde la base de ventas) — fuente de
  // verdad para la recencia de compra. Reemplaza el campo cacheado
  // pdvs.ultima_vta, que puede estar desactualizado.
  const { data: ultimaData } = await svc.rpc('pdvs_ultima_vta');
  const ultimaVtaMap = new Map<number, string>();
  for (const row of (ultimaData as { pdv_id: number; ultima: string }[] | null) ?? []) {
    if (row?.pdv_id != null && row.ultima) ultimaVtaMap.set(row.pdv_id, row.ultima);
  }

  // Cliente activo = compró en los últimos 3 meses (derivado de la última venta)
  const cutoff3m = new Date();
  cutoff3m.setMonth(cutoff3m.getMonth() - 3);
  const desde3m = cutoff3m.toISOString().slice(0, 10);

  // Load all geo points — paginate to bypass PostgREST row limit
  const PAGE = 1000;
  let page = 0;
  type RawGeoRow = {
    pdv_id: number;
    latitud: number;
    longitud: number;
    partido: string | null;
    ruteable: boolean | null;
    pdvs: Record<string, unknown> | null;
  };
  let rawGeo: RawGeoRow[] = [];
  while (true) {
    const { data: rawGeoPage } = await svc
      .from('pdvs_geo')
      .select(
        'pdv_id, latitud, longitud, partido, ruteable, pdvs ( razon_social, cartera, canal_venta, zona, ultima_vta, activo, dia_visita )'
      )
      .not('latitud', 'is', null)
      .not('longitud', 'is', null)
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (!rawGeoPage || rawGeoPage.length === 0) break;
    rawGeo = rawGeo.concat(rawGeoPage as unknown as RawGeoRow[]);
    if (rawGeoPage.length < PAGE) break;
    page++;
  }

  // Round coords to ~5 decimals (≈1 m) to trim payload bytes
  const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

  // Flatten nested join result, keep only active PDVs
  let puntos: PdvGeo[] = (rawGeo ?? [])
    .filter((r) => {
      const pdv = r.pdvs as Record<string, unknown> | null;
      return pdv?.activo === true;
    })
    .map((r) => {
      const pdv = r.pdvs as Record<string, unknown>;
      // Última venta real desde ventas; fallback al campo cacheado del PDV.
      const ultima = ultimaVtaMap.get(r.pdv_id) ?? (pdv?.ultima_vta as string) ?? null;
      return {
        pdv_id:      r.pdv_id,
        latitud:     round5(Number(r.latitud)),
        longitud:    round5(Number(r.longitud)),
        partido:     r.partido,
        ruteable:    r.ruteable,
        razon_social: (pdv?.razon_social as string) ?? null,
        cartera:     (pdv?.cartera as string) ?? null,
        canal_venta: (pdv?.canal_venta as string) ?? null,
        zona:        (pdv?.zona as string) ?? null,
        ultima_vta:  ultima,
        activo_3m:   ultima != null && ultima.slice(0, 10) >= desde3m,
        dia_visita:  (pdv?.dia_visita as string) ?? null,
      };
    });

  // Role-based filtering (applied server-side)
  if (profile.rol === 'vendedor' && profile.vendedor_nombre) {
    puntos = puntos.filter((p) => p.cartera === profile.vendedor_nombre);
  } else if (profile.rol === 'supervisor' && profile.vendedor_nombre) {
    const { data: vData } = await svc
      .from('vendedores')
      .select('equipo')
      .eq('nombre', profile.vendedor_nombre)
      .single();

    if (vData?.equipo) {
      const { data: equipoVends } = await svc
        .from('vendedores')
        .select('nombre')
        .eq('equipo', vData.equipo)
        .eq('activo', true);
      const nombres = new Set((equipoVends ?? []).map((v: { nombre: string }) => v.nombre));
      puntos = puntos.filter((p) => p.cartera != null && nombres.has(p.cartera));
    }
  }

  return NextResponse.json(puntos, {
    // Per-user data; cache briefly in the browser so re-visits are instant.
    headers: { 'Cache-Control': 'private, max-age=300' },
  });
}
