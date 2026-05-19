import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchConsolidadoPorProducto } from '@/lib/calculations/productos';

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    const { data: profile } = await authClient
      .from('profiles')
      .select('rol, vendedor_nombre')
      .eq('id', user.id)
      .single();
    if (!profile) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    if (profile.rol === 'vendedor') {
      return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });
    }

    const body = await request.json() as {
      equipo: string; anio: number; mes: number; articulos: string[] | null;
    };
    const { equipo, anio, mes, articulos } = body;
    if (!equipo || !anio || !mes) {
      return NextResponse.json({ error: 'Parámetros inválidos.' }, { status: 400 });
    }

    // Un supervisor solo puede consultar su propio equipo
    if (profile.rol === 'supervisor') {
      const { data: me } = await authClient
        .from('vendedores')
        .select('equipo')
        .eq('nombre', profile.vendedor_nombre ?? '')
        .single();
      if ((me?.equipo ?? '') !== equipo) {
        return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });
      }
    }

    const filas = await fetchConsolidadoPorProducto(
      equipo, anio, mes,
      Array.isArray(articulos) ? articulos : null,
      new Date(),
    );

    return NextResponse.json({ filas });
  } catch (err) {
    console.error('[consolidado-productos]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
