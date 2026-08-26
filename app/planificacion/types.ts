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

/** Color por día del maestro — para leer de un vistazo cómo está hoy la semana. */
export const DIA_COLOR: Record<string, string> = {
  LUN: '#0c5cab', MAR: '#e11d48', MIE: '#16a34a',
  JUE: '#f59e0b', VIE: '#7c3aed', SAB: '#0891b2',
};

/** Día que menciona el nombre, o null si no nombra ninguno. */
export function diaMencionadoEn(nombre: string): Dia | null {
  const n = nombre.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const encontrados = DIA_EN_NOMBRE.filter(([, re]) => re.test(n));
  // Con dos días en el nombre no se puede inferir la intención: no se avisa.
  return encontrados.length === 1 ? encontrados[0][0] : null;
}

// ---------------------------------------------------------------------------
// Canal de venta.
//
// Se muestra tal cual viene del maestro: el canal ya está puesto ahí y agrupar
// KIOSCO + MAXI KIOSCO + TRADICIONALES en un "tradicional" inventado escondía
// justamente lo que se quiere ver en el mapa.
//
// Valores reales hoy (7.109 PDVs): KIOSCO 2.674 · TRADICIONALES 1.597 ·
// AUTOSERVICIO 1.176 · OTROS 1.037 · MAXI KIOSCO 520 · REVENTA 1, más 108 sin
// dato (solo 9 activos). Se normaliza a MAYÚSCULAS y sin espacios de más
// —el maestro es texto libre y admite "Maxi Kiosco"— pero no se traduce nada.
//
// Un canal nuevo que aparezca en el maestro se muestra igual, con su nombre y
// el color de reserva: no hay que tocar código para que se vea.
// ---------------------------------------------------------------------------

/** Cuando el maestro no trae canal. No es un canal: es la ausencia de dato. */
export const SIN_CANAL = 'SIN CANAL';

/** El canal del PDV, normalizado. Nunca vacío. */
export function canalDe(canalVenta: string | null): string {
  const c = (canalVenta ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  return c || SIN_CANAL;
}

// Los canales de hoy, en el orden en que se listan: de más PDVs a menos, que
// es como se lee. Sirve para ordenar leyendas y columnas; el color no sale de
// acá, para que un canal nuevo del maestro no dependa de esta lista.
export const CANALES = [
  'KIOSCO', 'TRADICIONALES', 'AUTOSERVICIO', 'OTROS', 'MAXI KIOSCO', 'REVENTA',
];

// Dos colores y nada más: en el mapa lo que se decide es dónde están los
// autoservicios: el resto de los canales se recorre igual y pintarlos de seis
// colores distintos era ruido. El nombre del canal sí se muestra completo en
// la leyenda y en las listas, así que no se pierde nada.
export const COLOR_AUTOSERVICIO = '#ef4444';
export const COLOR_OTROS_CANALES = '#22c55e';

export function colorPorCanal(canalVenta: string | null): string {
  // Por substring: el maestro hoy dice AUTOSERVICIO, pero un AUTOSERVICIOS o
  // un AUTOSERVICIO GRANDE tienen que caer del mismo lado.
  return canalDe(canalVenta).includes('AUTOSERVICIO')
    ? COLOR_AUTOSERVICIO
    : COLOR_OTROS_CANALES;
}

/** jsPDF pide los colores como tres enteros 0-255, no como hex. */
export function hexARgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface CuentaCanal { canal: string; color: string; n: number }

/**
 * Cuántos PDVs hay de cada canal, en el orden de CANALES y sin los que no
 * aparecen: una leyenda con "0 REVENTA" es ruido.
 *
 * Un canal que no esté en CANALES (o los sin dato) va al final, de mayor a
 * menor: es el caso raro y no tiene por qué encabezar la lista.
 */
export function contarPorCanal(pdvs: PdvPlan[]): CuentaCanal[] {
  const n = new Map<string, number>();
  for (const p of pdvs) {
    const c = canalDe(p.canal_venta);
    n.set(c, (n.get(c) ?? 0) + 1);
  }
  const orden = (c: string) => {
    const i = CANALES.indexOf(c);
    return i === -1 ? CANALES.length : i;
  };
  return [...n.entries()]
    .map(([canal, cant]) => ({ canal, color: colorPorCanal(canal), n: cant }))
    // Desempate por cantidad para los que no están en CANALES.
    .sort((a, b) => orden(a.canal) - orden(b.canal) || b.n - a.n);
}

/** Paleta de los cuadrantes: alto contraste entre sí y contra el mapa base. */
export const COLORES_CUADRANTE = [
  '#0c5cab', '#e11d48', '#16a34a', '#f59e0b', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5',
];
