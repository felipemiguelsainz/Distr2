import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { fixParkedGeo } from '@/lib/geo/regeocode';

// Cron: re-geocodifica un lote chico de PDV imprecisos no verificados. Vercel
// Cron lo llama según vercel.json y manda Authorization: Bearer $CRON_SECRET.
// Lote chico + 1 req/seg de Nominatim → entra cómodo en el budget del request.
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET no configurado' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const svc = createServiceClient();
  try {
    const r = await fixParkedGeo(svc, 15);
    if (r.pendientes_restantes === -1) {
      return NextResponse.json({ ok: false, motivo: 'IA no configurada (falta ANTHROPIC_API_KEY)' });
    }
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error('[cron/geo-fix]', e);
    return NextResponse.json({ error: 'Error re-geocodificando.' }, { status: 500 });
  }
}
