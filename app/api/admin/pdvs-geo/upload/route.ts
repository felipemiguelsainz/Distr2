import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

interface GeoRow {
  pdv_id: number;
  partido: string | null;
  provincia: string | null;
  calle: string | null;
  altura: string | null;
  entre1: string | null;
  entre2: string | null;
  latitud: number | null;
  longitud: number | null;
  ruteable: boolean | null;
  domicilio_geo: string | null;
  fecha_geo: string | null;
  hora_geo: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const { data: profile } = await authClient.from('profiles').select('rol').eq('id', user.id).single();
    if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });

    const body = await request.json();
    const rows: GeoRow[] = body.rows;

    if (!rows?.length) {
      return NextResponse.json({ error: 'No se recibieron filas.' }, { status: 400 });
    }

    const svc = createServiceClient();

    // Deduplicate by pdv_id client-side (belt+suspenders — RPC also uses DISTINCT ON)
    const deduped = [...new Map(rows.map(r => [r.pdv_id, r])).values()];

    // Delegate everything to a DB-side function:
    // filters valid pdv_ids via JOIN, deduplicates, upserts atomically.
    const { data, error } = await svc.rpc('bulk_upsert_pdvs_geo', {
      p_rows: deduped,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json(data);
  } catch (err) {
    console.error('[pdvs-geo-upload]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
