import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { calcularMetasPreview } from '@/lib/calculations/metas';

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const { data: profile } = await authClient.from('profiles').select('rol').eq('id', user.id).single();
    if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });

    const { anio, mes, objetivosMondelez } = await request.json();
    const a = Number(anio), m = Number(mes);
    if (!Number.isInteger(a) || a < 2000 || a > 2100) {
      return NextResponse.json({ error: 'Año inválido.' }, { status: 400 });
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return NextResponse.json({ error: 'Mes inválido (1-12).' }, { status: 400 });
    }
    const preview = await calcularMetasPreview(
      a,
      m,
      objetivosMondelez ?? {},
    );
    return NextResponse.json({ preview });
  } catch (err) {
    console.error('[metas-preview]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
