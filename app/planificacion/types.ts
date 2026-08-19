// Planificación — capa de zonificación paralela al maestro de PDVs.
// Ver supabase/migrations/042_planificacion_cuadrantes.sql para el modelo.

export const DIAS_HABILES = ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'] as const;
export type Dia = (typeof DIAS_HABILES)[number];

export const DIA_NOMBRE: Record<string, string> = {
  LUN: 'Lunes', MAR: 'Martes', MIE: 'Miércoles',
  JUE: 'Jueves', VIE: 'Viernes', SAB: 'Sábado',
};

/** Un PDV tal como lo necesita el lienzo: posición + los datos para decidir. */
export interface PdvPlan {
  pdv_id: number;
  lat: number;
  lon: number;
  razon_social: string | null;
  /** Calle y altura. Sin esto la hoja de ruta no sirve para salir a la calle. */
  domicilio: string | null;
  /** Vendedor del maestro (pdvs.cartera). Solo lectura: es el "antes". */
  cartera: string | null;
  /** Día del maestro (pdvs.dia_visita). Solo lectura: es el "antes". */
  dia_visita: string | null;
  localidad: string | null;
  partido: string | null;
  zona: string | null;
  canal_venta: string | null;
  ultima_vta: string | null;
}

/** Polígono como lo dibuja el usuario: anillo exterior [lat, lng], sin cerrar. */
export type Anillo = [number, number][];

export interface Cuadrante {
  id: string;
  nombre: string;
  dia: Dia;
  vendedor_nombre: string;
  color: string;
  poligono: Anillo;
  localidad: string | null;
  /** PDVs asignados a este cuadrante (persistidos, no recalculados en vivo). */
  pdv_ids: number[];
}

export interface PlanificacionData {
  rol: 'admin' | 'supervisor';
  /** Vendedores a los que este usuario puede asignar PDVs. */
  vendedores: string[];
  puntos: PdvPlan[];
  cuadrantes: Cuadrante[];
}

/** Lo que la API devuelve tras guardar: qué hizo realmente con los conflictos. */
export interface GuardarResultado {
  cuadrante: Cuadrante;
  /** PDVs que se le sacaron a otro cuadrante para dárselos a este. */
  robados: number[];
  /** PDVs que se dejaron donde estaban (conflicto no resuelto). */
  omitidos: number[];
}

// ---------------------------------------------------------------------------
// Point-in-polygon (ray casting). Se corre en el cliente sobre ~7k puntos cada
// vez que se cierra un polígono; O(n·v) es de sobra a esa escala.
//
// El anillo se trata como cerrado aunque el último vértice no repita al primero
// (el bucle usa i/j circular). Las coordenadas son [lat, lng] — a esta escala
// (un partido del GBA) tratar lat/lng como plano no introduce error visible.
// ---------------------------------------------------------------------------
export function dentroDelPoligono(lat: number, lon: number, anillo: Anillo): boolean {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [yi, xi] = anillo[i];
    const [yj, xj] = anillo[j];
    // Cruza el rayo horizontal que sale del punto hacia +x.
    const cruza = (yi > lat) !== (yj > lat)
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

// ---------------------------------------------------------------------------
// Día mencionado en el nombre del cuadrante.
//
// El selector de día arranca siempre en LUN y hay que tocarlo en cada cuadrante
// nuevo. Es facilísimo escribir "zona 5 miercoles" y olvidarse del chip: pasó
// con 8 de los primeros 24 cuadrantes reales, que quedaron todos en lunes y
// desbalancearon la semana entera sin que nada lo avisara.
// ---------------------------------------------------------------------------
const DIA_EN_NOMBRE: [Dia, RegExp][] = [
  ['LUN', /\blun(es)?\b/],
  ['MAR', /\bmar(tes)?\b/],
  ['MIE', /\bmie(rcoles)?\b/],
  ['JUE', /\bjue(ves)?\b/],
  ['VIE', /\bvie(rnes)?\b/],
  ['SAB', /\bsab(ado)?\b/],
];

/** Día que menciona el nombre, o null si no nombra ninguno. */
export function diaMencionadoEn(nombre: string): Dia | null {
  const n = nombre.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const encontrados = DIA_EN_NOMBRE.filter(([, re]) => re.test(n));
  // Con dos días en el nombre no se puede inferir la intención: no se avisa.
  return encontrados.length === 1 ? encontrados[0][0] : null;
}

// ---------------------------------------------------------------------------
// Tipo de PDV según el canal de venta.
//
// `pdvs.canal_venta` es texto libre del maestro. Los valores reales hoy (7.109
// PDVs) son: KIOSCO 2.674 · TRADICIONALES 1.597 · AUTOSERVICIO 1.176 ·
// OTROS 1.037 · MAXI KIOSCO 520 · REVENTA 1 · '' 2, más 102 en NULL.
//
// El match es por substring y en minúsculas para que aguante variantes de
// tipeo del maestro ("Maxi Kiosco", "AUTOSERVICIOS"). Cualquier valor nuevo
// que aparezca cae en 'otro' y se ve gris en el mapa: es un fallback visible,
// que es el modo correcto de fallar acá — un canal sin clasificar se nota.
// ---------------------------------------------------------------------------
export type TipoPdv = 'tradicional' | 'autoservicio' | 'otro';

export function tipoPDV(canalVenta: string | null): TipoPdv {
  if (!canalVenta) return 'otro'; // cubre null y '' (2 filas en la base)
  const c = canalVenta.toLowerCase();
  // Autoservicio primero: es el más específico y no comparte substring con los
  // de abajo. 'super'/'hiper' no matchean nada hoy, quedan por si el maestro
  // suma esos canales más adelante.
  if (c.includes('autoservicio') || c.includes('super') || c.includes('hiper')) return 'autoservicio';
  // 'tradicional' cubre TRADICIONALES; 'kiosco' cubre KIOSCO y MAXI KIOSCO.
  if (c.includes('kiosco') || c.includes('tradicional') || c.includes('ventana')) return 'tradicional';
  return 'otro'; // OTROS, REVENTA y lo que venga
}

export const COLOR_TRADICIONAL  = '#22c55e';
export const COLOR_AUTOSERVICIO = '#ef4444';
export const COLOR_OTRO_CANAL   = '#94a3b8';

export function colorPorCanal(canalVenta: string | null): string {
  const t = tipoPDV(canalVenta);
  if (t === 'tradicional')  return COLOR_TRADICIONAL;
  if (t === 'autoservicio') return COLOR_AUTOSERVICIO;
  return COLOR_OTRO_CANAL;
}

/** jsPDF pide los colores como tres enteros 0-255, no como hex. */
export function hexARgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const LEYENDA_CANAL: { tipo: TipoPdv; color: string; label: string }[] = [
  { tipo: 'tradicional',  color: COLOR_TRADICIONAL,  label: 'Tradicional / Kiosco' },
  { tipo: 'autoservicio', color: COLOR_AUTOSERVICIO, label: 'Autoservicio' },
  { tipo: 'otro',         color: COLOR_OTRO_CANAL,   label: 'Sin clasificar' },
];

/** Cuenta cuántos PDVs de cada tipo hay en una lista. */
export function contarPorCanal(pdvs: PdvPlan[]): Record<TipoPdv, number> {
  const out: Record<TipoPdv, number> = { tradicional: 0, autoservicio: 0, otro: 0 };
  for (const p of pdvs) out[tipoPDV(p.canal_venta)] += 1;
  return out;
}

/** Paleta de los cuadrantes: alto contraste entre sí y contra el mapa base. */
export const COLORES_CUADRANTE = [
  '#0c5cab', '#e11d48', '#16a34a', '#f59e0b', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
];
