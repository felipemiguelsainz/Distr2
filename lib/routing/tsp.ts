// ---------------------------------------------------------------------------
// Optimización de rutas (TSP abierto) — determinístico, sin IA.
// Trabaja sobre una matriz de distancias NxN, así sirve igual para distancias
// por calle (OSRM) o en línea recta (haversine como fallback).
// Heurística: vecino más cercano + mejora 2-opt. Rápido y muy bueno para los
// tamaños reales de una cartera (decenas de PDVs).
// ---------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lon: number;
}

const R_KM = 6371;
const toRad = (x: number) => (x * Math.PI) / 180;

/** Distancia en km entre dos coordenadas (gran círculo). */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(s));
}

/** Matriz de distancias haversine (km) — fallback cuando OSRM no responde. */
export function haversineMatrix(points: LatLng[]): number[][] {
  const n = points.length;
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = haversine(points[i], points[j]);
      m[i][j] = d;
      m[j][i] = d;
    }
  }
  return m;
}

/** Largo total de una ruta (en las unidades de la matriz) para un orden dado. */
export function routeLength(dist: number[][], order: number[]): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) total += dist[order[i - 1]][order[i]];
  return total;
}

/** Construye un orden inicial con vecino más cercano desde `start`. */
export function nearestNeighbor(dist: number[][], start = 0): number[] {
  const n = dist.length;
  const used = new Array(n).fill(false);
  const order = [start];
  used[start] = true;
  for (let k = 1; k < n; k++) {
    const cur = order[order.length - 1];
    let best = -1;
    let bd = Infinity;
    for (let j = 0; j < n; j++) {
      if (!used[j] && dist[cur][j] < bd) {
        bd = dist[cur][j];
        best = j;
      }
    }
    order.push(best);
    used[best] = true;
  }
  return order;
}

/**
 * Mejora 2-opt sobre una ruta abierta (no vuelve al origen). Invierte segmentos
 * mientras reduzca la distancia total. Itera hasta no encontrar mejoras.
 */
export function twoOpt(dist: number[][], order: number[]): number[] {
  const route = order.slice();
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < route.length - 1; i++) {
      for (let j = i + 1; j < route.length; j++) {
        const a = route[i - 1];
        const b = route[i];
        const c = route[j];
        const d = j + 1 < route.length ? route[j + 1] : -1;
        const before = dist[a][b] + (d >= 0 ? dist[c][d] : 0);
        const after = dist[a][c] + (d >= 0 ? dist[b][d] : 0);
        if (after + 1e-9 < before) {
          // invertir el segmento [i..j]
          let lo = i;
          let hi = j;
          while (lo < hi) {
            const tmp = route[lo];
            route[lo] = route[hi];
            route[hi] = tmp;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }
  return route;
}

/** Optimiza una ruta abierta a partir de una matriz de distancias. */
export function optimizeRoute(dist: number[][]): {
  order: number[];
  length: number;
} {
  if (dist.length <= 2) {
    const order = dist.map((_, i) => i);
    return { order, length: routeLength(dist, order) };
  }
  const order = twoOpt(dist, nearestNeighbor(dist, 0));
  return { order, length: routeLength(dist, order) };
}
