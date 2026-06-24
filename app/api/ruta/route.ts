import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { haversine, haversineMatrix, optimizeRoute, routeLength } from '@/lib/routing/tsp';
import { osrmTableFoot, osrmRouteGeometry } from '@/lib/routing/osrm';
import type { RutaResponse, RutaStop, RutaSugerencia } from '@/app/mapa/types';

const DIAS_VALIDOS = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM'];
// Radio para sugerir un PDV inactivo "de paso" respecto de la ruta (metros).
const SUGERENCIA_RADIO_M = 400;
const MAX_SUGERENCIAS = 10;
// Ruta a pie: velocidad de caminata (km/h) para estimar tiempos.
const KMH_PIE = 5;

type GeoRow = {
  pdv_id: number;
  razon_social: string | null;
  canal_venta: string | null;
  partido: string | null;
  lat: number;
  lon: number;
  dia_visita: string | null;
};

function diasDe(dv: string | null): string[] {
  return (dv ?? '').replace(/\s/g, '').split(',').filter(Boolean);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const vendedorParam = (searchParams.get('vendedor') ?? '').trim();
  const dia = (searchParams.get('dia') ?? '').trim().toUpperCase();
  // Radio para clientes apagados cercanos (m), ajustable. Clamp 100–2000.
  const radio = Math.min(2000, Math.max(100, Number(searchParams.get('radio')) || SUGERENCIA_RADIO_M));
  // PDVs agregados manualmente a la ruta ("sumar a la ruta"): ids separados por coma.
  const extraIds = new Set(
    (searchParams.get('extra') ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0)
  );

  if (!DIAS_VALIDOS.includes(dia)) {
    return NextResponse.json({ error: 'Día inválido' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre, equipo')
    .eq('id', user.id)
    .single();
  if (!profile) return NextResponse.json({ error: 'Sin perfil' }, { status: 403 });

  const svc = createServiceClient();

  // --- Scoping por rol: definir qué vendedor puede consultar ---
  let vendedor = vendedorParam;
  if (profile.rol === 'vendedor') {
    if (!profile.vendedor_nombre) {
      return NextResponse.json({ error: 'Sin cartera asignada' }, { status: 403 });
    }
    vendedor = profile.vendedor_nombre; // ignora el param: solo su propia cartera
  } else if (profile.rol === 'supervisor') {
    // El equipo sale de profiles.equipo (el supervisor no siempre es un vendedor).
    if (!profile.equipo) {
      return NextResponse.json({ error: 'Sin equipo asignado' }, { status: 403 });
    }
    const { data: equipoVends } = await svc
      .from('vendedores')
      .select('nombre')
      .eq('equipo', profile.equipo)
      .eq('activo', true);
    const nombres = new Set((equipoVends ?? []).map((v: { nombre: string }) => v.nombre));
    if (!nombres.has(vendedor)) {
      return NextResponse.json({ error: 'Vendedor fuera de tu equipo' }, { status: 403 });
    }
  }
  // admin: cualquier vendedor
  if (!vendedor) {
    return NextResponse.json({ error: 'Falta vendedor' }, { status: 400 });
  }

  // --- PDVs activos del vendedor con geo (todos los días: base para ruta + sugerencias) ---
  const { data: rows } = await svc
    .from('pdvs')
    .select('id, razon_social, canal_venta, dia_visita, pdvs_geo!inner ( latitud, longitud, partido )')
    .eq('cartera', vendedor)
    .eq('activo', true)
    .not('pdvs_geo.latitud', 'is', null)
    .not('pdvs_geo.longitud', 'is', null);

  type Raw = {
    id: number;
    razon_social: string | null;
    canal_venta: string | null;
    dia_visita: string | null;
    pdvs_geo: { latitud: number; longitud: number; partido: string | null } | { latitud: number; longitud: number; partido: string | null }[] | null;
  };
  const candidatos: GeoRow[] = ((rows as unknown as Raw[]) ?? [])
    .map((r) => {
      const g = Array.isArray(r.pdvs_geo) ? r.pdvs_geo[0] : r.pdvs_geo;
      if (!g) return null;
      return {
        pdv_id: r.id,
        razon_social: r.razon_social,
        canal_venta: r.canal_venta,
        partido: g.partido,
        lat: Number(g.latitud),
        lon: Number(g.longitud),
        dia_visita: r.dia_visita,
      } as GeoRow;
    })
    .filter((x): x is GeoRow => x !== null);

  // --- Última venta real por PDV (recencia) ---
  const { data: ultimaData } = await svc.rpc('pdvs_ultima_vta');
  const ultimaMap = new Map<number, string>();
  for (const u of (ultimaData as { pdv_id: number; ultima: string }[] | null) ?? []) {
    if (u?.pdv_id != null && u.ultima) ultimaMap.set(u.pdv_id, u.ultima);
  }
  const cutoff3m = new Date();
  cutoff3m.setMonth(cutoff3m.getMonth() - 3);
  const desde3m = cutoff3m.toISOString().slice(0, 10);
  const esRojo = (pdvId: number) => {
    const u = ultimaMap.get(pdvId);
    return !u || u.slice(0, 10) < desde3m;
  };

  // --- PDVs de la ruta = los del día + los agregados manualmente ("sumar") ---
  const delDia = candidatos.filter((c) => diasDe(c.dia_visita).includes(dia));
  const enDia = new Set(delDia.map((c) => c.pdv_id));
  const extras = candidatos.filter((c) => extraIds.has(c.pdv_id) && !enDia.has(c.pdv_id));
  const agregadoSet = new Set(extras.map((c) => c.pdv_id));
  const ruta = [...delDia, ...extras];

  const toStop = (c: GeoRow): RutaStop => ({
    pdv_id: c.pdv_id,
    razon_social: c.razon_social,
    canal_venta: c.canal_venta,
    partido: c.partido,
    lat: c.lat,
    lon: c.lon,
    ultima_vta: ultimaMap.get(c.pdv_id) ?? null,
    agregado: agregadoSet.has(c.pdv_id),
  });

  // Caso trivial: 0 o 1 parada
  if (ruta.length <= 1) {
    const stops = ruta.map(toStop);
    const resp: RutaResponse = {
      vendedor,
      dia,
      stops,
      geometry: stops.map((s) => [s.lat, s.lon]),
      total_km: 0,
      total_min: 0,
      source: 'haversine',
      sugerencias: [],
      resumen:
        stops.length === 0
          ? `Sin PDVs asignados al ${dia} para ${vendedor}.`
          : `1 parada el ${dia} para ${vendedor}.`,
    };
    return NextResponse.json(resp);
  }

  // --- Optimización: matriz a pie (router foot propio) o haversine ---
  const pts = ruta.map((c) => ({ lat: c.lat, lon: c.lon }));
  const table = await osrmTableFoot(pts);
  const source: 'osrm' | 'haversine' = table ? 'osrm' : 'haversine';
  const distMatrix = table ? table.distKm : haversineMatrix(pts);
  const { order } = optimizeRoute(distMatrix);

  const orderedRows = order.map((i) => ruta[i]);
  const stops = orderedRows.map(toStop);
  const orderedPts = orderedRows.map((c) => ({ lat: c.lat, lon: c.lon }));

  // --- Geometría por calle (siempre) + totales a pie ---
  // La traza sigue las calles para no cruzar manzanas. La distancia/tiempo se
  // estiman a pie salvo que haya un router peatón real (perfil foot).
  let geometry: [number, number][] = orderedPts.map((p) => [p.lat, p.lon]);
  let total_km = routeLength(distMatrix, order);
  let total_min = (total_km / KMH_PIE) * 60;

  const road = await osrmRouteGeometry(orderedPts);
  if (road) {
    geometry = road.geometry; // traza por calles (no líneas rectas)
    if (road.foot) {
      // router peatón real: confiar en su distancia/tiempo
      total_km = road.distKm;
      total_min = road.durMin;
    }
  }

  // --- Sugerencias: clientes apagados "de paso" para sumar a la ruta ---
  // Condiciones: (a) misma cartera del vendedor — garantizado, `candidatos` ya
  // está filtrado por cartera = vendedor; (b) NO asignados al día de la ruta;
  // (c) inactivos (rojo, +3 meses); (d) cerca de la ruta (radio, abajo).
  const enRuta = new Set(ruta.map((c) => c.pdv_id));
  const sugerencias: RutaSugerencia[] = candidatos
    .filter((c) => !enRuta.has(c.pdv_id) && !diasDe(c.dia_visita).includes(dia) && esRojo(c.pdv_id))
    .map((c) => {
      let minKm = Infinity;
      for (const s of orderedPts) minKm = Math.min(minKm, haversine(s, { lat: c.lat, lon: c.lon }));
      return {
        pdv_id: c.pdv_id,
        razon_social: c.razon_social,
        lat: c.lat,
        lon: c.lon,
        ultima_vta: ultimaMap.get(c.pdv_id) ?? null,
        dia_visita: c.dia_visita,
        dist_m: Math.round(minKm * 1000),
      };
    })
    .filter((s) => s.dist_m <= radio)
    .sort((a, b) => a.dist_m - b.dist_m)
    .slice(0, MAX_SUGERENCIAS);

  const resumen =
    `${stops.length} paradas · ${total_km.toFixed(1)} km a pie · ~${Math.round(total_min)} min` +
    (sugerencias.length
      ? ` · ${sugerencias.length} cliente(s) apagado(s) cercano(s)`
      : '');

  const resp: RutaResponse = {
    vendedor,
    dia,
    stops,
    geometry,
    total_km,
    total_min,
    source,
    sugerencias,
    resumen,
  };
  return NextResponse.json(resp);
}
