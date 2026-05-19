import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const { data: profile } = await authClient.from('profiles').select('rol').eq('id', user.id).single();
    if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });

    const { anio, mes } = await request.json();
    const a = Number(anio), m = Number(mes);
    if (!Number.isInteger(a) || a < 2000 || a > 2100) {
      return NextResponse.json({ error: 'Año inválido.' }, { status: 400 });
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return NextResponse.json({ error: 'Mes inválido (1-12).' }, { status: 400 });
    }

    const desde = `${a}-${String(m).padStart(2, '0')}-01`;
    const hasta = `${a}-${String(m).padStart(2, '0')}-31`;
    const periodo = `${a}-${String(m).padStart(2, '0')}`;

    const supabase = createServiceClient();

    // Fetch all dates with ventas in this month
    const { data: fechasData, error: fechasErr } = await supabase
      .from('ventas')
      .select('fecha')
      .gte('fecha', desde)
      .lte('fecha', hasta);

    if (fechasErr) {
      console.error('[recalcular-resumen] fetch fechas:', fechasErr);
      return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }

    const fechas = [...new Set((fechasData ?? []).map(r => r.fecha as string))];
    if (fechas.length === 0) return NextResponse.json({ error: 'No hay ventas para ese mes.' }, { status: 400 });

    const { error } = await supabase.rpc('recalcular_resumen_diario', { p_fechas: fechas });
    if (error) {
      console.error('[recalcular-resumen] rpc:', error);
      return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }

    // También recalcular la tabla pre-agregada por PDV/mes
    const { error: rcpErr } = await supabase.rpc('recalcular_resumen_clientes_pdv', { p_periodos: [periodo] });
    if (rcpErr) {
      console.error('[recalcular-resumen] rcp:', rcpErr);
    }

    revalidateTag('kpis', { expire: 0 });

    return NextResponse.json({ ok: true, fechas_procesadas: fechas.length });
  } catch (err) {
    console.error('[recalcular-resumen]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
