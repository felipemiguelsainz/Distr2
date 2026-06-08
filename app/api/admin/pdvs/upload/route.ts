import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { PdvsUploadResult, Pdv } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const { data: profile } = await authClient.from('profiles').select('rol').eq('id', user.id).single();
    if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });

    const body = await request.json();
    const rows: Pdv[] = body.rows;
    const confirmed: boolean = body.confirmed ?? false;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'Sin filas para procesar.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Fetch existing cartera values to detect changes
    const ids = rows.map((r) => r.id);
    const { data: existing } = await supabase
      .from('pdvs')
      .select('id, cartera, razon_social')
      .in('id', ids);

    const existingMap = new Map<number, { cartera: string; razon_social: string }>();
    for (const e of existing ?? []) {
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

    // If not confirmed and there are reasignaciones, return them for review
    if (!confirmed && reasignaciones.length > 0) {
      return NextResponse.json({
        requires_confirmation: true,
        reasignaciones,
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

      const { data } = await supabase
        .from('pdvs')
        .upsert(chunk, { onConflict: 'id', ignoreDuplicates: false })
        .select('id');

      for (const row of chunk) {
        if (existingMap.has(row.id)) updated++;
        else inserted++;
      }
      void data;
    }

    // Reemplazo completo: marcar activo=false los PDVs que NO vinieron en este archivo.
    // No los borramos físicamente porque ventas.pdv_id es FK; preservamos la historia.
    const idsInFile = new Set(rows.map((r) => r.id));
    const { data: allActive } = await supabase
      .from('pdvs')
      .select('id')
      .eq('activo', true);
    const toDeactivate = (allActive ?? [])
      .map((p) => p.id as number)
      .filter((id) => !idsInFile.has(id));

    let deactivated = 0;
    if (toDeactivate.length > 0) {
      const { error: deactErr } = await supabase
        .from('pdvs')
        .update({ activo: false })
        .in('id', toDeactivate);
      if (!deactErr) deactivated = toDeactivate.length;
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
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[pdvs-upload]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
