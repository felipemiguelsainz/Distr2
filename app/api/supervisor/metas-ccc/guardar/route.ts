import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';

interface MetaRow {
  vendedor: string;
  rubro: string | null; // null = meta total
  meta_pdvs: number;
}

// Guarda metas CCC editadas por el supervisor (o admin). Marca es_preset=false.
export async function POST(request: NextRequest) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });

  const { data: profile } = await authClient
    .from('profiles')
    .select('rol, vendedor_nombre, equipo')
    .eq('id', user.id)
    .single();
  if (!profile || (profile.rol !== 'supervisor' && profile.rol !== 'admin')) {
    return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });
  }

  const { mes, anio, rows } = await request.json() as {
    mes?: number; anio?: number; rows?: MetaRow[];
  };
  if (!mes || !anio || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'Payload inválido.' }, { status: 400 });
  }

  const svc = createServiceClient();

  // Si es supervisor, validar que TODOS los vendedores del payload sean de su equipo.
  if (profile.rol === 'supervisor') {
    let equipo = profile.equipo ?? '';
    if (!equipo && profile.vendedor_nombre) {
      const { data: me } = await svc
        .from('vendedores').select('equipo').eq('nombre', profile.vendedor_nombre).single();
      equipo = me?.equipo ?? '';
    }
    if (!equipo) return NextResponse.json({ error: 'No se pudo determinar tu equipo.' }, { status: 400 });

    const { data: equipoVends } = await svc
      .from('vendedores').select('nombre').eq('equipo', equipo).eq('activo', true);
    const permitidos = new Set((equipoVends ?? []).map((v) => v.nombre as string));

    const ajenos = rows.filter((r) => !permitidos.has(r.vendedor));
    if (ajenos.length > 0) {
      return NextResponse.json({ error: 'Hay vendedores fuera de tu equipo.' }, { status: 403 });
    }
  }

  // Sanitizar y upsert (es_preset=false para marcar edición manual).
  const payload = rows.map((r) => ({
    mes, anio,
    vendedor: r.vendedor,
    rubro: r.rubro ?? null,
    meta_pdvs: Math.max(0, Math.round(Number(r.meta_pdvs) || 0)),
    es_preset: false,
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await svc
    .from('metas_ccc')
    .upsert(payload, { onConflict: 'mes,anio,vendedor,rubro' })
    .select('vendedor, rubro, meta_pdvs, es_preset');

  if (error) {
    console.error('[metas-ccc:guardar]', error);
    return NextResponse.json({ error: 'No se pudieron guardar las metas.' }, { status: 500 });
  }

  // Las metas CCC se leen en los dashboards vía fetchMetasCcc (cache tag 'kpis').
  // Invalidar para que la edición se refleje sin esperar el revalidate de 5 min.
  revalidateTag('kpis', { expire: 0 });

  return NextResponse.json({ ok: true, rows: data });
}
