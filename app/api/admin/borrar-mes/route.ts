import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { anio, mes } = await request.json();
    if (!anio || !mes) return NextResponse.json({ error: 'Faltan parámetros.' }, { status: 400 });

    const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const hasta = `${anio}-${String(mes).padStart(2, '0')}-31`;

    const supabase = createServiceClient();
    await supabase.from('ventas').delete().gte('fecha', desde).lte('fecha', hasta);
    await supabase.from('resumen_diario').delete().gte('fecha', desde).lte('fecha', hasta);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
