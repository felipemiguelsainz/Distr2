import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { traerTodo } from '@/lib/supabase/paginar';
import { PdvsUploadResult, Pdv } from '@/lib/types';

// Upsert de ~7.000 PDVs + bajas + recálculo de metas CCC: pasa el default de Vercel.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const { data: profile } = await authClient.from('profiles').select('rol').eq('id', user.id).single();
    if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });

    const body = await request.json();
    // Un id repetido en el archivo hace fallar el upsert del lote entero
    // ("cannot affect row a second time"): queda la última aparición.
    const rows: Pdv[] = Array.isArray(body.rows)
      ? [...new Map((body.rows as Pdv[]).map((r) => [r.id, r])).values()]
      : body.rows;
    const confirmed: boolean = body.confirmed ?? false;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'Sin filas para procesar.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Todos los PDVs actuales, paginados. Antes iba un .in('id', ids) con los
    // ~7.000 ids del archivo: la URL pasa el tope y PostgREST responde 400, y
    // además cualquier select corta en 1000 filas → no se detectaban
    // reasignaciones y las bajas se calculaban sobre 1000 activos.
    const existing = await traerTodo<{ id: number; cartera: string; razon_social: string; activo: boolean }>(
      (desde, hasta) => supabase.from('pdvs').select('id, cartera, razon_social, activo').order('id').range(desde, hasta),
    );

    const existingMap = new Map<number, { cartera: string; razon_social: string }>();
    for (const e of existing) {
      existingMap.set(e.id, e);
    }

    // Fetch latest vendedor per cartera
    const carterasInFile = [...new Set(rows.map((r) => r.cartera).filter(Boolean))];
    const latestVendedor = new Map<string, string>();
    if (carterasInFile.length > 0) {
      const { data: asig } = await supabase
        .from('asignaciones')
        .select('cartera, vendedor_nombre, fecha_desde')
        .in('cartera', carterasInFile as string[])
        .order('fecha_desde', { ascending: false });

      const seen = new Set<string>();
      for (const a of asig ?? []) {
        if (!seen.has(a.cartera)) {
          seen.add(a.cartera);
          latestVendedor.set(a.cartera, a.vendedor_nombre);
        }
      }
    }

    // Detect reasignaciones
    const reasignaciones = rows
      .filter((r) => {
        const old = existingMap.get(r.id);
        return old && old.cartera !== r.cartera && r.cartera;
      })
      .map((r) => {
        const old = existingMap.get(r.id)!;
        return {
          pdv_id: r.id,
          razon_social: r.razon_social ?? old.razon_social,
          cartera: r.cartera!,
          vendedor_anterior: latestVendedor.get(old.cartera) ?? old.cartera,
          vendedor_nuevo: latestVendedor.get(r.cartera!) ?? r.cartera!,
        };
      });

    // Cuántos PDVs activos quedarían dados de baja (no vienen en el archivo).
    const idsInFile = new Set(rows.map((r) => r.id));
    const activosAntes = existing.filter((p) => p.activo).map((p) => p.id);
    const bajas = activosAntes.filter((id) => !idsInFile.has(id)).length;
    // Guardrail: dar de baja a >30% de los activos casi siempre es un archivo
    // parcial/equivocado → pedir confirmación explícita.
    const bajaMasiva = activosAntes.length > 0 && bajas > activosAntes.length * 0.3;

    // Pedir confirmación si hay reasignaciones de cartera o una baja masiva.
    if (!confirmed && (reasignaciones.length > 0 || bajaMasiva)) {
      return NextResponse.json({
        requires_confirmation: true,
        reasignaciones,
        bajas,
        baja_masiva: bajaMasiva,
        activos_antes: activosAntes.length,
        total: rows.length,
      });
    }

    // Asegurar activo=true para los PDVs del archivo (por si estaban dados de baja)
    const rowsAsActive = rows.map((r) => ({ ...r, activo: true }));

    // Proceed with upsert
    let inserted = 0;
    let updated = 0;
    const today = new Date().toISOString().slice(0, 10);

    const CHUNK = 500;
    for (let i = 0; i < rowsAsActive.length; i += CHUNK) {
      const chunk = rowsAsActive.slice(i, i + CHUNK);

      const { error: upsertErr } = await supabase
        .from('pdvs')
        .upsert(chunk, { onConflict: 'id', ignoreDuplicates: false });
      // Cortar acá: si seguía, daba de baja a los PDVs que no se llegaron a guardar.
      if (upsertErr) throw new Error(`Guardando PDVs (filas ${i + 1}–${i + chunk.length}): ${upsertErr.message}`);

      for (const row of chunk) {
        if (existingMap.has(row.id)) updated++;
        else inserted++;
      }
    }

    // Reemplazo completo: marcar activo=false los PDVs que NO vinieron en este archivo.
    // No los borramos físicamente porque ventas.pdv_id es FK; preservamos la historia
    // (las ventas NO se tocan). Reutilizamos activosAntes calculado arriba.
    const toDeactivate = activosAntes.filter((id) => !idsInFile.has(id));
    let deactivated = 0;
    for (let i = 0; i < toDeactivate.length; i += CHUNK) {
      const chunk = toDeactivate.slice(i, i + CHUNK);
      const { error: deactErr } = await supabase.from('pdvs').update({ activo: false }).in('id', chunk);
      if (!deactErr) deactivated += chunk.length;
    }

    // Limpiar la geo de los PDVs que quedaron inactivos (pdvs_geo solo con vigentes).
    let geo_eliminada = 0;
    try {
      const { data: ge } = await supabase.rpc('cleanup_pdvs_geo_inactivos');
      geo_eliminada = typeof ge === 'number' ? ge : 0;
    } catch (e) {
      console.error('[pdvs-upload] cleanup geo', e);
    }

    // Record asignaciones for cartera changes
    if (reasignaciones.length > 0) {
      const asigRows = reasignaciones.map((r) => ({
        cartera: r.cartera,
        vendedor_nombre: r.vendedor_nuevo,
        fecha_desde: today,
      }));
      await supabase.from('asignaciones').insert(asigRows);
    }

    revalidateTag('kpis', { expire: 0 });

    // Recalcular las metas CCC preseteadas para el mes corriente: la meta total
    // por vendedor depende de los PDVs activos asignados, que acaban de cambiar.
    // No pisa metas editadas por el supervisor (es_preset = false).
    try {
      const now = new Date();
      await supabase.rpc('calcular_preset_ccc', {
        p_mes: now.getMonth() + 1,
        p_anio: now.getFullYear(),
      });
    } catch (e) {
      console.error('[pdvs-upload] calcular_preset_ccc', e);
    }

    const result: PdvsUploadResult = {
      total: rows.length,
      inserted,
      updated,
      reasignaciones,
      deactivated,
      geo_eliminada,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[pdvs-upload]', err);
    const detalle = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Error interno del servidor: ${detalle}` }, { status: 500 });
  }
}
