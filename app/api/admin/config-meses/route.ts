import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const { data: profile } = await authClient.from('profiles').select('rol').eq('id', user.id).single();
    if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });

    const { anio, mes, dias_laborables } = await request.json();
    const a = Number(anio), m = Number(mes), d = Number(dias_laborables);
    if (!Number.isInteger(a) || a < 2000 || a > 2100) {
      return NextResponse.json({ error: 'Año inválido.' }, { status: 400 });
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return NextResponse.json({ error: 'Mes inválido (1-12).' }, { status: 400 });
    }
    if (!Number.isInteger(d) || d < 1 || d > 31) {
      return NextResponse.json({ error: 'Días laborables inválido (1-31).' }, { status: 400 });
    }
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('config_meses')
      .upsert({ anio: a, mes: m, dias_laborables: d }, { onConflict: 'anio,mes' });
    if (error) {
      console.error('[config-meses] upsert:', error);
      return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[config-meses]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
