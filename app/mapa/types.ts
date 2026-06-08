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
