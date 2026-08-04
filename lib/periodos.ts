// ---------------------------------------------------------------------------
// Períodos (mes/año) seleccionables desde los filtros.
//
// Los filtros aceptan VARIOS meses y VARIOS años: `?mes=6,7,8&anio=2026`. El
// conjunto de períodos es el producto cartesiano años × meses, y los dashboards
// SUMAN todos los períodos elegidos (acumulado, meta, días laborables…).
//
// Los meses futuros se descartan: sumarían meta sin ventas y romperían el avance.
// Si TODO lo elegido es futuro se respeta la selección (el usuario quiere ver la
// meta cargada de un mes que todavía no arrancó).
// ---------------------------------------------------------------------------

/** Equipo sentinel: "todos los equipos". Sólo admin. */
export const TOTAL_EMPRESA = '__total__';

export const MESES_LARGOS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
] as const;

export const MESES_CORTOS = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
] as const;

export interface Periodo { anio: number; mes: number }

/** Tope de períodos por consulta: cada uno dispara su propia tanda de RPCs. */
export const MAX_PERIODOS = 24;

const ord = (p: Periodo) => p.anio * 12 + (p.mes - 1);

function parseLista(raw: string | undefined, valido: (n: number) => boolean): number[] {
  if (!raw) return [];
  const nums = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && valido(n));
  return [...new Set(nums)].sort((a, b) => a - b);
}

export interface SeleccionPeriodos {
  /** Meses elegidos (1-12), ordenados. */
  meses: number[];
  /** Años elegidos, ordenados. */
  anios: number[];
  /** Períodos efectivos a consultar (años × meses, sin futuros), cronológicos. */
  periodos: Periodo[];
  /** El más reciente: el que usan tendencia, CCC y cobertura (no son sumables). */
  principal: Periodo;
  /** true si hay más de un período seleccionado. */
  multi: boolean;
  /** Etiqueta legible: "Agosto 2026" · "Jun–Ago 2026" · "3 períodos". */
  label: string;
}

/**
 * Resuelve la selección de períodos a partir de los search params.
 * Sin params: el mes corriente.
 */
export function resolverPeriodos(
  params: { mes?: string; anio?: string },
  today: Date = new Date(),
): SeleccionPeriodos {
  const mesHoy  = today.getMonth() + 1;
  const anioHoy = today.getFullYear();

  const mesesSel = parseLista(params.mes,  (n) => n >= 1 && n <= 12);
  const aniosSel = parseLista(params.anio, (n) => n >= 2000 && n <= anioHoy + 1);

  const meses = mesesSel.length > 0 ? mesesSel : [mesHoy];
  const anios = aniosSel.length > 0 ? aniosSel : [anioHoy];

  const todos: Periodo[] = [];
  for (const anio of anios) for (const mes of meses) todos.push({ anio, mes });
  todos.sort((a, b) => ord(a) - ord(b));

  const hoyOrd    = anioHoy * 12 + (mesHoy - 1);
  const pasados   = todos.filter((p) => ord(p) <= hoyOrd);
  const periodos  = (pasados.length > 0 ? pasados : todos).slice(-MAX_PERIODOS);

  return {
    meses,
    anios,
    periodos,
    principal: periodos[periodos.length - 1],
    multi:     periodos.length > 1,
    label:     labelPeriodos(periodos),
  };
}

/** "Agosto 2026" · "Jun–Ago 2026" · "Ene 2025 · Ene 2026" · "8 períodos". */
export function labelPeriodos(periodos: Periodo[]): string {
  if (periodos.length === 0) return '—';
  if (periodos.length === 1) return `${MESES_LARGOS[periodos[0].mes - 1]} ${periodos[0].anio}`;

  const primero = periodos[0];
  const ultimo  = periodos[periodos.length - 1];
  const contiguo = periodos.every((p, i) => ord(p) === ord(primero) + i);

  if (contiguo) {
    return primero.anio === ultimo.anio
      ? `${MESES_CORTOS[primero.mes - 1]}–${MESES_CORTOS[ultimo.mes - 1]} ${primero.anio}`
      : `${MESES_CORTOS[primero.mes - 1]} ${primero.anio} – ${MESES_CORTOS[ultimo.mes - 1]} ${ultimo.anio}`;
  }
  if (periodos.length <= 4) {
    return periodos.map((p) => `${MESES_CORTOS[p.mes - 1]} ${p.anio}`).join(' · ');
  }
  return `${periodos.length} períodos`;
}

/** El mes anterior al corriente — el "cierre" del mes pasado. */
export function mesPasado(today: Date = new Date()): Periodo {
  const mes = today.getMonth() + 1;
  return mes === 1
    ? { anio: today.getFullYear() - 1, mes: 12 }
    : { anio: today.getFullYear(), mes: mes - 1 };
}

/** true si el período ya cerró (es anterior al mes corriente). */
export function esPeriodoCerrado(anio: number, mes: number, today: Date = new Date()): boolean {
  return anio * 12 + (mes - 1) < today.getFullYear() * 12 + today.getMonth();
}
