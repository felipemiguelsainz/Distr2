import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { anio, mes } = await request.json();
    if (!anio || !mes) return NextResponse.json({ error: 'Faltan parámetros.' }, { status: 400 });

    const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const hasta = `${anio}-${String(mes).padStart(2, '0')}-31`;

    const supabase = createServiceClient();

    // Fetch all dates with ventas in this month
    const { data: fechasData, error: fechasErr } = await supabase
      .from('ventas')
      .select('fecha')
      .gte('fecha', desde)
      .lte('fecha', hasta);

    if (fechasErr) return NextResponse.json({ error: fechasErr.message }, { status: 500 });

    const fechas = [...new Set((fechasData ?? []).map(r => r.fecha as string))];
    if (fechas.length === 0) return NextResponse.json({ error: 'No hay ventas para ese mes.' }, { status: 400 });

    const { error } = await supabase.rpc('recalcular_resumen_diario', { p_fechas: fechas });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, fechas_procesadas: fechas.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
