import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { recalcularResumenDiario } from '@/lib/calculations/resumen';
import { parseVentasFile } from '@/lib/excel/parser';
import { VentasUploadResult } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const { data: profile } = await authClient.from('profiles').select('rol').eq('id', user.id).single();
    if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });

    // Accept multipart/form-data (file upload) — avoids JSON body size limits
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const confirmed = formData.get('confirmed') === 'true';
    if (!file) {
      return NextResponse.json({ error: 'Archivo no recibido.' }, { status: 400 });
    }

    // Validar tamaño y extensión antes de parsear (evita DoS por archivo gigante)
    const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'El archivo supera el límite de 25 MB.' },
        { status: 413 },
      );
    }
    if (!/\.(xlsx|xls|xlsb|csv)$/.test((file.name ?? '').toLowerCase())) {
      return NextResponse.json(
        { error: 'Formato no soportado. Subí un Excel (.xlsx, .xls, .xlsb) o CSV.' },
        { status: 415 },
      );
    }

    const buffer = await file.arrayBuffer();
    let rows;
    try {
      rows = parseVentasFile(buffer);
    } catch {
      return NextResponse.json(
        { error: 'No se pudo leer el archivo. Verificá que sea un Excel válido.' },
        { status: 400 },
      );
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Sin filas válidas para procesar.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // --- Validación: vendedores huérfanos (no existen en maestros) ---
    const vendedoresEnArchivo = [...new Set(rows.map(r => r.vendedor).filter(Boolean))] as string[];
    const { data: vendedoresExistentes } = await supabase
      .from('vendedores')
      .select('nombre')
      .in('nombre', vendedoresEnArchivo);
    const existSet = new Set((vendedoresExistentes ?? []).map(v => v.nombre as string));
    const huerfanos = vendedoresEnArchivo.filter(v => !existSet.has(v)).sort();

    if (huerfanos.length > 0 && !confirmed) {
      return NextResponse.json({
        requires_confirmation: true,
        huerfanos,
        total_rows: rows.length,
        message: `Encontré ${huerfanos.length} vendedor(es) que NO existen en el maestro. Si subís sin agregarlos al master, sus ventas no aparecerán en las vistas por equipo/supervisor.`,
      });
    }

    const errors: string[] = [];
    let inserted = 0;
    const skipped = 0;
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

      // ignoreDuplicates=false → si el row existe (mismo fecha+pdv+comprobante+sku),
      // se sobrescribe con los nuevos valores. Permite re-subir un archivo
      // corregido sin tener que borrar el mes primero.
      const { data, error } = await supabase
        .from('ventas')
        .upsert(chunk, {
          onConflict: 'fecha,pdv_id,comprobante,sku',
          ignoreDuplicates: false,
        })
        .select('id, fecha');

      if (error) {
        errors.push(`Chunk ${i}–${i + chunk.length}: ${error.message}`);
        continue;
      }

      // Con ignoreDuplicates=false, todos los rows del chunk son procesados
      // (insert nuevo o update existente). No se puede distinguir uno del otro
      // sin queries extra, así que reportamos todos como "inserted".
      inserted += data?.length ?? 0;

      for (const row of chunk) {
        fechasSet.add(row.fecha);
      }
    }

    const fechas_afectadas = [...fechasSet].sort();

    let resumen_warning: string | undefined;
    try {
      await recalcularResumenDiario(fechas_afectadas);
    } catch (resumenErr) {
      console.error('[ventas-upload] recalcularResumenDiario falló:', resumenErr);
      resumen_warning = 'Ventas guardadas, pero el resumen diario no pudo recalcularse. Usá Panel Admin → Recalcular para actualizarlo.';
    }

    // Invalidate cached KPI queries — data just changed
    revalidateTag('kpis', { expire: 0 });

    const result: VentasUploadResult = {
      inserted,
      skipped,
      errors,
      fechas_afectadas,
      ...(resumen_warning ? { resumen_warning } : {}),
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error('[ventas-upload]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
