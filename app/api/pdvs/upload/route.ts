import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { PdvsUploadResult, Pdv } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
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

    // Proceed with upsert
    let inserted = 0;
    let updated = 0;
    const today = new Date().toISOString().slice(0, 10);

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);

      const { data } = await supabase
        .from('pdvs')
        .upsert(chunk, { onConflict: 'id', ignoreDuplicates: false })
        .select('id');

      // Determine inserted vs updated
      for (const row of chunk) {
        if (existingMap.has(row.id)) updated++;
        else inserted++;
      }
      void data;
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

    const result: PdvsUploadResult = {
      total: rows.length,
      inserted,
      updated,
      reasignaciones,
    };

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
