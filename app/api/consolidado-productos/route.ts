import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { fetchConsolidadoPorProducto } from '@/lib/calculations/productos';
import { MAX_PERIODOS, Periodo } from '@/lib/periodos';
import { veTodaLaEmpresa } from '@/lib/auth/alcance';

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

    const { data: profile } = await authClient
      .from('profiles')
      .select('rol, vendedor_nombre, equipo, ve_empresa')
      .eq('id', user.id)
      .single();
    if (!profile) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    if (profile.rol === 'vendedor') {
      return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });
    }

    const body = await request.json() as {
      equipo: string; periodos: Periodo[]; articulos: string[] | null;
    };
    const { equipo, articulos } = body;

    // Períodos: se validan acá porque llegan del cliente (y acotan el nº de RPCs).
    const periodos = (Array.isArray(body.periodos) ? body.periodos : [])
      .filter((p) =>
        Number.isInteger(p?.anio) && p.anio >= 2000 && p.anio <= 2100 &&
        Number.isInteger(p?.mes)  && p.mes  >= 1    && p.mes  <= 12)
      .slice(0, MAX_PERIODOS);
    if (periodos.length === 0) {
      return NextResponse.json({ error: 'Parámetros inválidos.' }, { status: 400 });
    }

    const veTodo = veTodaLaEmpresa(profile);

    // equipo vacío = Total Empresa: sólo con alcance de empresa.
    if (!equipo && !veTodo) {
      return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });
    }

    // Un supervisor sin alcance de empresa solo consulta su propio equipo.
    if (profile.rol === 'supervisor' && !veTodo) {
      let myEquipo = profile.equipo ?? '';
      if (!myEquipo && profile.vendedor_nombre) {
        const { data: me } = await authClient
          .from('vendedores').select('equipo').eq('nombre', profile.vendedor_nombre).single();
        myEquipo = me?.equipo ?? '';
      }
      if (!myEquipo || myEquipo !== equipo) {
        return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });
      }
    }

    const filas = await fetchConsolidadoPorProducto(
      equipo, periodos,
      Array.isArray(articulos) ? articulos : null,
      new Date(),
    );

    return NextResponse.json({ filas });
  } catch (err) {
    console.error('[consolidado-productos]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
