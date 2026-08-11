import type { PlanScope } from './scope';
import type { Anillo, Dia } from '@/app/planificacion/types';
import { DIAS_HABILES } from '@/app/planificacion/types';

/** Lotes chicos al filtrar por listas largas: la query va en la URL. */
const LOTE = 400;

export interface CuadranteInput {
  nombre: string;
  dia: Dia;
  vendedor_nombre: string;
  color: string;
  poligono: Anillo;
  localidad: string | null;
  pdv_ids: number[];
  /** Qué hacer con los PDVs en conflicto: robárselos al otro, o dejarlos. */
  resolver: 'robar' | 'omitir';
}

/** Valida y normaliza el body de un cuadrante. Devuelve string si algo no cierra. */
export function parseCuadranteInput(body: unknown): CuadranteInput | string {
  if (typeof body !== 'object' || body === null) return 'Body inválido.';
  const b = body as Record<string, unknown>;

  const nombre = typeof b.nombre === 'string' ? b.nombre.trim() : '';
  if (!nombre) return 'Falta el nombre del cuadrante.';
  if (nombre.length > 80) return 'El nombre es demasiado largo.';

  const dia = b.dia as Dia;
  if (!DIAS_HABILES.includes(dia)) return 'Día inválido.';

  const vendedor_nombre = typeof b.vendedor_nombre === 'string' ? b.vendedor_nombre.trim() : '';
  if (!vendedor_nombre) return 'Falta el vendedor.';

  const color = typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#0c5cab';

  // Un polígono necesita al menos 3 vértices; si no, no encierra nada.
  const poligono = b.poligono;
  if (!Array.isArray(poligono) || poligono.length < 3) return 'El polígono necesita al menos 3 puntos.';
  const anillo: Anillo = [];
  for (const v of poligono) {
    if (!Array.isArray(v) || v.length !== 2) return 'Polígono mal formado.';
    const [lat, lng] = v as [unknown, unknown];
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) {
      return 'Polígono mal formado.';
    }
    anillo.push([lat, lng]);
  }

  const pdv_ids = Array.isArray(b.pdv_ids)
    ? [...new Set(b.pdv_ids.filter((n): n is number => Number.isInteger(n)))]
    : [];
  // Un cuadrante sin PDVs no representa nada: solo ensucia el mapa, la lista y
  // el resumen (aparece un vendedor con 0). Se rechaza en el borde.
  if (pdv_ids.length === 0) return 'El cuadrante no encierra ningún PDV.';

  return {
    nombre,
    dia,
    vendedor_nombre,
    color,
    poligono: anillo,
    localidad: typeof b.localidad === 'string' && b.localidad.trim() ? b.localidad.trim() : null,
    pdv_ids,
    resolver: b.resolver === 'robar' ? 'robar' : 'omitir',
  };
}

/**
 * Recorta la lista de PDVs a los que el usuario tiene permitido tocar.
 * El admin no tiene recorte. Al supervisor le deja los de su equipo más los
 * que ya estén en alguno de sus cuadrantes (mismo criterio que el GET, para
 * que pueda corregir un PDV al que el maestro le cambió la cartera).
 */
export async function filtrarPdvsPermitidos(scope: PlanScope, pdvIds: number[]): Promise<number[]> {
  if (!scope.vendedoresPermitidos || pdvIds.length === 0) return pdvIds;
  const permitidos = scope.vendedoresPermitidos;

  const ok = new Set<number>();
  for (let i = 0; i < pdvIds.length; i += LOTE) {
    const lote = pdvIds.slice(i, i + LOTE);
    const { data } = await scope.svc.from('pdvs').select('id, cartera').in('id', lote);
    for (const p of (data ?? []) as { id: number; cartera: string | null }[]) {
      if (p.cartera != null && permitidos.has(p.cartera)) ok.add(p.id);
    }
    const { data: asig } = await scope.svc
      .from('plan_asignaciones')
      .select('pdv_id, plan_cuadrantes!inner ( vendedor_nombre )')
      .in('pdv_id', lote);
    for (const a of (asig ?? []) as unknown as { pdv_id: number; plan_cuadrantes: { vendedor_nombre: string } }[]) {
      if (permitidos.has(a.plan_cuadrantes?.vendedor_nombre)) ok.add(a.pdv_id);
    }
  }
  return pdvIds.filter((id) => ok.has(id));
}

export interface ConflictoDetectado {
  pdv_id: number;
  cuadrante_id: string;
  vendedor_nombre: string;
  dia: string;
}

/**
 * Busca choques contra los cuadrantes ya guardados.
 *
 * Hay conflicto si el PDV ya está tomado por OTRO vendedor (cualquier día), o
 * si ya tiene ese MISMO día ocupado (aunque sea del mismo vendedor: dos veces
 * el mismo día no es una visita, es un error de dibujo).
 *
 * No es conflicto que el mismo vendedor lo tenga otro día: eso es exactamente
 * una visita 2 veces por semana, que es válido.
 */
export async function detectarConflictos(
  scope: PlanScope,
  pdvIds: number[],
  dia: Dia,
  vendedor: string,
  excluirCuadranteId: string | null
): Promise<ConflictoDetectado[]> {
  if (pdvIds.length === 0) return [];

  const conflictos: ConflictoDetectado[] = [];
  for (let i = 0; i < pdvIds.length; i += LOTE) {
    const lote = pdvIds.slice(i, i + LOTE);
    const { data } = await scope.svc
      .from('plan_asignaciones')
      .select('pdv_id, cuadrante_id, dia, plan_cuadrantes!inner ( vendedor_nombre )')
      .in('pdv_id', lote);

    for (const a of (data ?? []) as unknown as {
      pdv_id: number; cuadrante_id: string; dia: string;
      plan_cuadrantes: { vendedor_nombre: string };
    }[]) {
      if (a.cuadrante_id === excluirCuadranteId) continue;
      const otroVendedor = a.plan_cuadrantes?.vendedor_nombre;
      if (otroVendedor !== vendedor || a.dia === dia) {
        conflictos.push({
          pdv_id: a.pdv_id,
          cuadrante_id: a.cuadrante_id,
          vendedor_nombre: otroVendedor,
          dia: a.dia,
        });
      }
    }
  }
  return conflictos;
}

export interface AplicarResultado {
  robados: number[];
  omitidos: number[];
}

/**
 * Deja el cuadrante con exactamente los PDVs pedidos, resolviendo conflictos
 * según `resolver`. Reemplaza el set completo: los PDVs que ya no estén en la
 * lista se desasignan de este cuadrante.
 */
export async function aplicarAsignaciones(
  scope: PlanScope,
  cuadranteId: string,
  dia: Dia,
  vendedor: string,
  pdvIds: number[],
  resolver: 'robar' | 'omitir'
): Promise<AplicarResultado> {
  const conflictos = await detectarConflictos(scope, pdvIds, dia, vendedor, cuadranteId);
  const enConflicto = new Set(conflictos.map((c) => c.pdv_id));

  let finales = pdvIds;
  let robados: number[] = [];
  let omitidos: number[] = [];

  if (resolver === 'robar') {
    robados = [...enConflicto];
    // Sacarlos de su cuadrante anterior antes de insertar: si no, el UNIQUE
    // (pdv_id, dia) rebota el insert entero. Se agrupan por cuadrante rival:
    // uno por uno eran cientos de round trips al robar un cuadrante grande.
    const porRival = new Map<string, number[]>();
    for (const c of conflictos) {
      const arr = porRival.get(c.cuadrante_id);
      if (arr) arr.push(c.pdv_id);
      else porRival.set(c.cuadrante_id, [c.pdv_id]);
    }
    for (const [rivalId, ids] of porRival) {
      for (let i = 0; i < ids.length; i += LOTE) {
        const { error } = await scope.svc
          .from('plan_asignaciones')
          .delete()
          .eq('cuadrante_id', rivalId)
          .in('pdv_id', ids.slice(i, i + LOTE));
        if (error) throw new Error(error.message);
      }
    }
  } else {
    omitidos = [...enConflicto];
    finales = pdvIds.filter((id) => !enConflicto.has(id));
  }

  // Set completo: primero se limpia este cuadrante, después se reinserta.
  await scope.svc.from('plan_asignaciones').delete().eq('cuadrante_id', cuadranteId);

  for (let i = 0; i < finales.length; i += LOTE) {
    const filas = finales.slice(i, i + LOTE).map((pdv_id) => ({ cuadrante_id: cuadranteId, dia, pdv_id }));
    const { error } = await scope.svc.from('plan_asignaciones').insert(filas);
    if (error) throw new Error(error.message);
  }

  return { robados, omitidos };
}
