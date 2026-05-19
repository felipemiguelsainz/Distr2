import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { MaestrosUploadResult } from '@/lib/types';
import { RawVendedorRow } from '@/lib/excel/parser';

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const { data: profile } = await authClient.from('profiles').select('rol').eq('id', user.id).single();
    if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });

    const body = await request.json();
    const vendedores: RawVendedorRow[] = body.vendedores;

    if (!vendedores?.length) {
      return NextResponse.json({ error: 'No se encontraron filas de vendedores.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('vendedores')
      .upsert(vendedores, { onConflict: 'nombre', ignoreDuplicates: false })
      .select('id');

    if (error) {
      console.error('[maestros-upload] upsert:', error);
      throw new Error('Error al actualizar vendedores.');
    }

    // El equipo/supervisor está denormalizado en resumen_diario y
    // resumen_clientes_pdv. Si cambió en el master, rebuild ambos para que
    // los KPIs históricos reflejen el equipo correcto.
    const { error: recErr } = await supabase.rpc('recalcular_resumen_completo');
    if (recErr) {
      console.error('[maestros-upload] recalcular_resumen_completo:', recErr);
    }

    revalidateTag('kpis', { expire: 0 });

    const result: MaestrosUploadResult = { vendedores_upserted: data?.length ?? 0 };
    return NextResponse.json(result);
  } catch (err) {
    console.error('[maestros-upload]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
