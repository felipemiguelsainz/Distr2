import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { recalcularResumenDiario } from '@/lib/calculations/resumen';
import { parseVentasFile } from '@/lib/excel/parser';
import { VentasUploadResult } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    // Accept multipart/form-data (file upload) — avoids JSON body size limits
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'Archivo no recibido.' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const rows = parseVentasFile(buffer);

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Sin filas válidas para procesar.' }, { status: 400 });
    }

    const supabase = createServiceClient();
    const errors: string[] = [];
    let inserted = 0;
    let skipped = 0;
    const fechasSet = new Set<string>();

    // Auto-crear PDVs faltantes para no violar el FK constraint
    const uniquePdvIds = [...new Set(rows.map(r => r.pdv_id))];
    const { data: existingPdvs } = await supabase
      .from('pdvs')
      .select('id')
      .in('id', uniquePdvIds);

    const existingIds = new Set((existingPdvs ?? []).map(p => p.id));
    const missingPdvs = rows
      .filter(r => !existingIds.has(r.pdv_id))
      .reduce((acc, r) => {
        if (!acc.has(r.pdv_id)) acc.set(r.pdv_id, {
          id:           r.pdv_id,
          razon_social: r.razon_social || `PDV ${r.pdv_id}`,
          cartera:      r.cartera || null,
          activo:       true,
        });
        return acc;
      }, new Map<number, object>());

    if (missingPdvs.size > 0) {
      await supabase.from('pdvs').upsert([...missingPdvs.values()], {
        onConflict: 'id',
        ignoreDuplicates: true,
      });
    }

    // Upsert in chunks of 500
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);

      const { data, error } = await supabase
        .from('ventas')
        .upsert(chunk, {
          onConflict: 'fecha,pdv_id,comprobante,sku',
          ignoreDuplicates: true,
        })
        .select('id, fecha');

      if (error) {
        errors.push(`Chunk ${i}–${i + chunk.length}: ${error.message}`);
        continue;
      }

      inserted += data?.length ?? 0;
      skipped += chunk.length - (data?.length ?? 0);

      for (const row of chunk) {
        fechasSet.add(row.fecha);
      }
    }

    const fechas_afectadas = [...fechasSet].sort();

    await recalcularResumenDiario(fechas_afectadas);

    const result: VentasUploadResult = {
      inserted,
      skipped,
      errors,
      fechas_afectadas,
    };

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
