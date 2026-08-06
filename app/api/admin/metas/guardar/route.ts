import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { MetaPreviewRubro } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const authClient = await createClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
    const { data: profile } = await authClient.from('profiles').select('rol').eq('id', user.id).single();
    if (profile?.rol !== 'admin') return NextResponse.json({ error: 'Prohibido.' }, { status: 403 });

    const { anio, mes, preview } = await request.json() as {
      anio: number; mes: number; preview: MetaPreviewRubro[];
    };
    // El período se valida por rango, no sólo por truthy: más abajo se BORRAN las
    // metas de (anio, mes) antes de insertar. Un año mal tipeado borraría las de
    // otro mes.
    const a = Number(anio), m = Number(mes);
    if (!Number.isInteger(a) || a < 2000 || a > 2100) {
      return NextResponse.json({ error: 'Año inválido.' }, { status: 400 });
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      return NextResponse.json({ error: 'Mes inválido (1-12).' }, { status: 400 });
    }
    if (!Array.isArray(preview)) {
      return NextResponse.json({ error: 'Parámetros inválidos.' }, { status: 400 });
    }

    const rows: { anio: number; mes: number; vendedor_nombre: string; rubro: string; kilos_meta: number; neto_meta: number | null }[] = [];
    for (const p of preview) {
      if (!p?.rubro || !Array.isArray(p.vendedores)) continue;
      for (const v of p.vendedores) {
        const kg   = Number(v?.kg_meta);
        const neto = v?.neto_meta == null ? null : Number(v.neto_meta);
        if (!v?.vendedor || !Number.isFinite(kg) || kg < 0) continue;
        rows.push({
          anio: a, mes: m,
          vendedor_nombre: v.vendedor,
          rubro:           p.rubro,
          kilos_meta:      kg,
          neto_meta:       neto != null && Number.isFinite(neto) ? neto : null,
        });
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No hay metas para guardar.' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Borrar metas previas del mes para no acumular duplicados con valores viejos
    await supabase.from('metas').delete().eq('anio', a).eq('mes', m);

    // Insertar en chunks para evitar payloads enormes
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from('metas').insert(chunk);
      if (error) {
        console.error('[metas-guardar] insert chunk:', error);
        return NextResponse.json({ error: 'Error al guardar metas.' }, { status: 500 });
      }
    }

    // NO borrar ai_insights acá: la app ya no genera on-demand (sólo sirve el
    // cache del job diario). Borrarlos dejaría los insights VACÍOS hasta la
    // próxima corrida nocturna. El % de avance se refresca solo en esa corrida;
    // que quede un día levemente desactualizado es preferible a mostrarlos en blanco.
    revalidateTag('kpis', { expire: 0 });

    return NextResponse.json({ ok: true, total: rows.length });
  } catch (err) {
    console.error('[metas-guardar]', err);
    return NextResponse.json({ error: 'Error interno del servidor.' }, { status: 500 });
  }
}
