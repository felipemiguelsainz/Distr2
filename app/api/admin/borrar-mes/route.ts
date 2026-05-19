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

    const supabase = createServiceClient();
    await supabase.from('ventas').delete().gte('fecha', desde).lte('fecha', hasta);
    await supabase.from('resumen_diario').delete().gte('fecha', desde).lte('fecha', hasta);
    await supabase.from('resumen_clientes_pdv').delete().eq('anio', a).eq('mes', m);

    revalidateTag('kpis', { expire: 0 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[borrar-mes]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
