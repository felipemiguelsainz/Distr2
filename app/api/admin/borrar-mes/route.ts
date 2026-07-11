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

    // Rango [primer día, primer día del mes siguiente) con `.lt`. Antes se usaba
    // `-31` fijo, que en meses de 30 días y febrero es una fecha inválida: la
    // query fallaba y —sin capturar el error— devolvía "ok" sin borrar nada.
    const desde = `${a}-${String(m).padStart(2, '0')}-01`;
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? a + 1 : a;
    const hasta = `${nextY}-${String(nextM).padStart(2, '0')}-01`;

    const supabase = createServiceClient();
    const delV = await supabase.from('ventas').delete().gte('fecha', desde).lt('fecha', hasta);
    const delR = await supabase.from('resumen_diario').delete().gte('fecha', desde).lt('fecha', hasta);
    const delC = await supabase.from('resumen_clientes_pdv').delete().eq('anio', a).eq('mes', m);
    const delErr = delV.error || delR.error || delC.error;
    if (delErr) {
      console.error('[borrar-mes] delete:', delErr);
      return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }

    revalidateTag('kpis', { expire: 0 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[borrar-mes]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
