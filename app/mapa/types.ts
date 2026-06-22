export interface PdvGeo {
  pdv_id: number;
  latitud: number;
  longitud: number;
  partido: string | null;
  ruteable: boolean | null;
  razon_social: string | null;
  cartera: string | null;
  canal_venta: string | null;
  zona: string | null;
  ultima_vta: string | null;
  activo_3m: boolean;
  dia_visita: string | null;
}

// --- Ruteo (Módulo 1) -------------------------------------------------------
export interface RutaStop {
  pdv_id: number;
  razon_social: string | null;
  canal_venta: string | null;
  partido: string | null;
  lat: number;
  lon: number;
  ultima_vta: string | null;
}

export interface RutaSugerencia {
  pdv_id: number;
  razon_social: string | null;
  lat: number;
  lon: number;
  ultima_vta: string | null;
  dia_visita: string | null;
  dist_m: number; // distancia al punto más cercano de la ruta (metros)
}

export interface RutaResponse {
  vendedor: string;
  dia: string;
  stops: RutaStop[]; // ya en orden de visita
  geometry: [number, number][]; // polyline [lat, lon] para dibujar
  total_km: number;
  total_min: number;
  source: 'osrm' | 'haversine';
  sugerencias: RutaSugerencia[]; // PDVs inactivos de paso
  resumen: string; // texto determinístico; hook para narración con IA
}
