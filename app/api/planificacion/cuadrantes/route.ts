import { NextResponse } from 'next/server';
import { getPlanScope } from '@/lib/planificacion/scope';
import {
  aplicarAsignaciones,
  filtrarPdvsPermitidos,
  parseCuadranteInput,
} from '@/lib/planificacion/asignar';
import type { Cuadrante, GuardarResultado } from '@/app/planificacion/types';

// Crea un cuadrante y le asigna los PDVs que quedaron dentro del polígono.
export async function POST(req: Request) {
  const scope = await getPlanScope();
  if ('error' in scope) return scope.error;

  const input = parseCuadranteInput(await req.json().catch(() => null));
  if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 400 });

  if (scope.vendedoresPermitidos && !scope.vendedoresPermitidos.has(input.vendedor_nombre)) {
    return NextResponse.json({ error: 'Ese vendedor no es de tu equipo.' }, { status: 403 });
  }

  const pdvIds = await filtrarPdvsPermitidos(scope, input.pdv_ids);

  const { data: creado, error } = await scope.svc
    .from('plan_cuadrantes')
    .insert({
      nombre:          input.nombre,
      dia:             input.dia,
      vendedor_nombre: input.vendedor_nombre,
      color:           input.color,
      poligono:        input.poligono,
      localidad:       input.localidad,
      creado_por:      scope.userId,
    })
    .select('id, nombre, dia, vendedor_nombre, color, poligono, localidad')
    .single();

  if (error || !creado) {
    return NextResponse.json({ error: error?.message ?? 'No se pudo crear el cuadrante.' }, { status: 500 });
  }

  let resultado;
  try {
    resultado = await aplicarAsignaciones(
      scope, creado.id as string, input.dia, input.vendedor_nombre, pdvIds, input.resolver
    );
  } catch (e) {
    // Sin asignaciones el cuadrante no sirve para nada: mejor no dejar el
    // polígono huérfano en el mapa. El cascade limpia lo que haya entrado.
    await scope.svc.from('plan_cuadrantes').delete().eq('id', creado.id);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudieron asignar los PDVs.' },
      { status: 500 }
    );
  }

  // Con resolver:'omitir' puede pasar que TODOS los PDVs estén en conflicto y
  // el cuadrante quede vacío. No sirve de nada: se deshace en vez de dejarlo.
  if (pdvIds.length === resultado.omitidos.length) {
    await scope.svc.from('plan_cuadrantes').delete().eq('id', creado.id);
    return NextResponse.json(
      { error: 'Todos esos PDVs ya están tomados: no quedó ninguno para este cuadrante.' },
      { status: 409 }
    );
  }

  const cuadrante: Cuadrante = {
    id:              creado.id as string,
    nombre:          creado.nombre as string,
    dia:             creado.dia as Cuadrante['dia'],
    vendedor_nombre: creado.vendedor_nombre as string,
    color:           creado.color as string,
    poligono:        creado.poligono as Cuadrante['poligono'],
    localidad:       (creado.localidad as string) ?? null,
    pdv_ids:         pdvIds.filter((id) => !resultado.omitidos.includes(id)),
  };

  const payload: GuardarResultado = { cuadrante, ...resultado };
  return NextResponse.json(payload, { status: 201 });
}
