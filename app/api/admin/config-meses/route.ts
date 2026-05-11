import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { anio, mes, dias_laborables } = await request.json();
    if (!anio || !mes || dias_laborables === undefined) {
      return NextResponse.json({ error: 'Parámetros inválidos.' }, { status: 400 });
    }
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('config_meses')
      .upsert({ anio, mes, dias_laborables }, { onConflict: 'anio,mes' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
