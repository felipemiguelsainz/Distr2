// ---------------------------------------------------------------------------
// Cliente de ruteo (API OSRM). Solo se usa server-side.
//
// Por defecto usa el router PEATÓN público de FOSSGIS
// (routing.openstreetmap.de/routed-foot) — el mismo que usa openstreetmap.org
// para caminar: gratis, sin API key, perfil `foot` real (cruza por donde camina
// un peatón, ignora sentidos únicos de auto). Devuelve traza + distancia +
// tiempo peatonales de verdad.
//
// Se puede apuntar a un OSRM propio con OSRM_URL (+ OSRM_PROFILE). Si el router
// foot falla, la geometría cae al OSRM público de auto SOLO para trazar por
// calles (no líneas rectas); en ese caso la distancia/tiempo se estiman a pie.
// ---------------------------------------------------------------------------
import type { LatLng } from './tsp';

const FOOT_BASE = process.env.OSRM_URL ?? 'https://routing.openstreetmap.de/routed-foot';
const FOOT_PROFILE = process.env.OSRM_PROFILE ?? 'foot';
const PUBLIC_CAR_BASE = 'https://router.project-osrm.org';

/** Hay router peatón (por defecto sí: el público de FOSSGIS). */
export const footRouterConfigured = FOOT_BASE !== '';

const OSRM_MAX = 90; // límite de puntos por request
const TIMEOUT_MS = 8000;

function coordsParam(points: LatLng[]): string {
  // OSRM espera lon,lat separados por ';'
  return points.map((p) => `${p.lon},${p.lat}`).join(';');
}

async function osrmFetch(url: string): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Matriz de distancias (km) y duraciones (min) A PIE. Null si no hay router
 * peatón propio o hay demasiados puntos (no se usa el público: es de auto).
 */
export async function osrmTableFoot(
  points: LatLng[]
): Promise<{ distKm: number[][]; durMin: number[][] } | null> {
  if (!footRouterConfigured || points.length < 2 || points.length > OSRM_MAX) return null;
  const url = `${FOOT_BASE}/table/v1/${FOOT_PROFILE}/${coordsParam(points)}?annotations=distance,duration`;
  const data = (await osrmFetch(url)) as
    | { code?: string; distances?: number[][]; durations?: number[][] }
    | null;
  if (!data || data.code !== 'Ok' || !data.distances || !data.durations) return null;
  return {
    distKm: data.distances.map((row) => row.map((m) => m / 1000)),
    durMin: data.durations.map((row) => row.map((s) => s / 60)),
  };
}

/**
 * Geometría por calle siguiendo los puntos en orden. Usa el router peatón
 * propio si existe; si no, el público (auto) solo para trazar por calles.
 * Devuelve el polyline [lat,lon][], la distancia/duración del router y si la
 * traza es realmente peatonal (`foot`). Null si no hay geometría disponible.
 */
export async function osrmRouteGeometry(ordered: LatLng[]): Promise<{
  geometry: [number, number][];
  distKm: number;
  durMin: number;
  foot: boolean;
} | null> {
  if (ordered.length < 2 || ordered.length > OSRM_MAX) return null;

  const fetchRoute = async (base: string, profile: string) => {
    const url = `${base}/route/v1/${profile}/${coordsParam(ordered)}?overview=full&geometries=geojson`;
    const data = (await osrmFetch(url)) as
      | { code?: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }
      | null;
    if (!data || data.code !== 'Ok' || !data.routes?.length) return null;
    const r = data.routes[0];
    // GeoJSON viene [lon,lat]; leaflet quiere [lat,lon].
    const geometry = r.geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number]);
    return { geometry, distKm: r.distance / 1000, durMin: r.duration / 60 };
  };

  // 1) router peatón (default). 2) fallback: auto público solo para trazar calles.
  const foot = await fetchRoute(FOOT_BASE, FOOT_PROFILE);
  if (foot) return { ...foot, foot: true };
  if (FOOT_BASE !== PUBLIC_CAR_BASE) {
    const car = await fetchRoute(PUBLIC_CAR_BASE, 'driving');
    if (car) return { ...car, foot: false };
  }
  return null;
}
