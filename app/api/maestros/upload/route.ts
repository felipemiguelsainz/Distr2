import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { MaestrosUploadResult } from '@/lib/types';
import { RawVendedorRow } from '@/lib/excel/parser';

export async function POST(request: NextRequest) {
  try {
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

    if (error) throw new Error(`Vendedores: ${error.message}`);

    const result: MaestrosUploadResult = { vendedores_upserted: data?.length ?? 0 };
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
