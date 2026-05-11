import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { MetaPreviewRubro } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const { anio, mes, preview } = await request.json() as {
      anio: number; mes: number; preview: MetaPreviewRubro[];
    };
    if (!anio || !mes || !Array.isArray(preview)) {
      return NextResponse.json({ error: 'Parámetros inválidos.' }, { status: 400 });
    }

    const rows: { anio: number; mes: number; vendedor_nombre: string; rubro: string; kilos_meta: number; neto_meta: number | null }[] = [];
    for (const p of preview) {
      for (const v of p.vendedores) {
        rows.push({
          anio, mes,
          vendedor_nombre: v.vendedor,
          rubro:           p.rubro,
          kilos_meta:      v.kg_meta,
          neto_meta:       v.neto_meta ?? null,
        });
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No hay metas para guardar.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Borrar metas previas del mes para no acumular duplicados con valores viejos
    await supabase.from('metas').delete().eq('anio', anio).eq('mes', mes);

    // Insertar en chunks para evitar payloads enormes
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from('metas').insert(chunk);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, total: rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
