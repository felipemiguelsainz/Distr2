import { NextResponse } from 'next/server';
import { getPlanScope, type PlanScope } from '@/lib/planificacion/scope';
import {
  aplicarAsignaciones,
  filtrarPdvsPermitidos,
  parseCuadranteInput,
} from '@/lib/planificacion/asignar';
import type { Cuadrante, GuardarResultado } from '@/app/planificacion/types';

type Params = { params: Promise<{ id: string }> };

/** Trae el cuadrante y verifica que este usuario pueda tocarlo. */
async function cargarCuadrante(scope: PlanScope, id: string) {
  const { data } = await scope.svc
    .from('plan_cuadrantes')
    .select('id, vendedor_nombre, dia')
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  if (scope.vendedoresPermitidos && !scope.vendedoresPermitidos.has(data.vendedor_nombre as string)) {
    return null;
  }
  return data as { id: string; vendedor_nombre: string; dia: string };
}

export async function PATCH(req: Request, { params }: Params) {
  const scope = await getPlanScope();
  if ('error' in scope) return scope.error;
  const { id } = await params;

  const actual = await cargarCuadrante(scope, id);
  if (!actual) return NextResponse.json({ error: 'Cuadrante no encontrado.' }, { status: 404 });

  const input = parseCuadranteInput(await req.json().catch(() => null));
  if (typeof input === 'string') return NextResponse.json({ error: input }, { status: 400 });

  if (scope.vendedoresPermitidos && !scope.vendedoresPermitidos.has(input.vendedor_nombre)) {
    return NextResponse.json({ error: 'Ese vendedor no es de tu equipo.' }, { status: 403 });
  }

  const pdvIds = await filtrarPdvsPermitidos(scope, input.pdv_ids);

  // Vaciar el cuadrante ANTES de tocar su día: plan_asignaciones.dia se
  // sincroniza por FK ON UPDATE CASCADE y, si el PDV ya tuviera ocupado el día
  // nuevo en otro cuadrante, el cascade chocaría con UNIQUE (pdv_id, dia).
  //
  // Pero solo cuando el día REALMENTE cambia. Antes se borraba siempre, así que
  // un simple cambio de nombre o color dejaba el cuadrante sin PDVs si el
  // UPDATE que venía después fallaba. Renombrar no puede costar los datos.
  if (actual.dia !== input.dia) {
    await scope.svc.from('plan_asignaciones').delete().eq('cuadrante_id', id);
  }

  const { data: guardado, error } = await scope.svc
    .from('plan_cuadrantes')
    .update({
      nombre:          input.nombre,
      dia:             input.dia,
      vendedor_nombre: input.vendedor_nombre,
      color:           input.color,
      poligono:        input.poligono,
      localidad:       input.localidad,
    })
    .eq('id', id)
    .select('id, nombre, dia, vendedor_nombre, color, poligono, localidad')
    .single();

  if (error || !guardado) {
    return NextResponse.json({ error: error?.message ?? 'No se pudo guardar.' }, { status: 500 });
  }

  let resultado;
  try {
    resultado = await aplicarAsignaciones(
      scope, id, input.dia, input.vendedor_nombre, pdvIds, input.resolver
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudieron asignar los PDVs.' },
      { status: 500 }
    );
  }

  const cuadrante: Cuadrante = {
    id:              guardado.id as string,
    nombre:          guardado.nombre as string,
    dia:             guardado.dia as Cuadrante['dia'],
    vendedor_nombre: guardado.vendedor_nombre as string,
    color:           guardado.color as string,
    poligono:        guardado.poligono as Cuadrante['poligono'],
    localidad:       (guardado.localidad as string) ?? null,
    pdv_ids:         pdvIds.filter((p) => !resultado.omitidos.includes(p)),
  };

  const payload: GuardarResultado = { cuadrante, ...resultado };
  return NextResponse.json(payload);
}

export async function DELETE(_req: Request, { params }: Params) {
  const scope = await getPlanScope();
  if ('error' in scope) return scope.error;
  const { id } = await params;

  const actual = await cargarCuadrante(scope, id);
  if (!actual) return NextResponse.json({ error: 'Cuadrante no encontrado.' }, { status: 404 });

  // plan_asignaciones cae por ON DELETE CASCADE.
  const { error } = await scope.svc.from('plan_cuadrantes').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
