import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { llmAvailable } from '@/lib/ai/provider';
import { resolveCarteras, type UserContext } from '@/lib/ai/tools';
import { getOrCreateInsight, avanceFromKpis, type InsightAvance } from '@/lib/ai/insights';
import { fetchTotalKpis, fetchSupervisorKpis, fetchVendedorKpis } from '@/lib/calculations/queries/kpis';

// La primera generación (KPIs + LLM) puede tardar; evitar el timeout default.
export const maxDuration = 60;

type SvcClient = ReturnType<typeof createServiceClient>;

interface Scope { scopeKey: string; label: string; carteras: string[] | null; avance: InsightAvance[]; today: Date }

/**
 * Resuelve el alcance del insight según el rol y el vendedor pedido (opcional).
 * Sin vendedor: vista agregada (empresa para admin, equipo para supervisor, su
 * propia cartera para vendedor). Con vendedor: ese vendedor, si está en alcance.
 */
async function resolveScope(svc: SvcClient, vendedorParam: string | null):
  Promise<{ scope: Scope } | { error: string; status: 401 | 403 | 400 }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado', status: 401 };
  const { data: profile } = await supabase.from('profiles').select('rol, vendedor_nombre').eq('id', user.id).single();
  if (!profile) return { error: 'Sin perfil', status: 403 };

  const ctx: UserContext = { rol: profile.rol, vendedor_nombre: profile.vendedor_nombre };
  const allowed = await resolveCarteras(svc, ctx);
  const today = new Date();
  const y = today.getFullYear(), m = today.getMonth() + 1;

  // Vista por vendedor
  if (vendedorParam) {
    if (allowed !== null && !allowed.includes(vendedorParam)) return { error: 'Vendedor fuera de tu alcance', status: 403 };
    const avance = avanceFromKpis(await fetchVendedorKpis(vendedorParam, y, m, today));
    return { scope: { scopeKey: `vendedor:${vendedorParam}`, label: vendedorParam, carteras: [vendedorParam], avance, today } };
  }

  // Vista agregada (default)
  if (ctx.rol === 'admin') {
    const avance = avanceFromKpis(await fetchTotalKpis(y, m, today));
    return { scope: { scopeKey: 'empresa:total', label: 'Total Empresa', carteras: null, avance, today } };
  }
  if (ctx.rol === 'supervisor' && ctx.vendedor_nombre) {
    const { data: v } = await svc.from('vendedores').select('equipo').eq('nombre', ctx.vendedor_nombre).single();
    const equipo = v?.equipo;
    if (!equipo) return { error: 'Sin equipo asignado', status: 403 };
    const sup = await fetchSupervisorKpis(equipo, y, m, today);
    return { scope: { scopeKey: `equipo:${equipo}`, label: `Equipo ${equipo}`, carteras: allowed, avance: avanceFromKpis(sup.totales), today } };
  }
  if (ctx.rol === 'vendedor' && ctx.vendedor_nombre) {
    const avance = avanceFromKpis(await fetchVendedorKpis(ctx.vendedor_nombre, y, m, today));
    return { scope: { scopeKey: `vendedor:${ctx.vendedor_nombre}`, label: ctx.vendedor_nombre, carteras: [ctx.vendedor_nombre], avance, today } };
  }
  return { error: 'Sin alcance', status: 403 };
}

async function handle(vendedor: string | null, force: boolean) {
  if (!llmAvailable()) return NextResponse.json({ error: 'Insights no configurados (falta API key).' }, { status: 503 });
  const svc = createServiceClient();
  const res = await resolveScope(svc, vendedor);
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.status });
  try {
    const out = await getOrCreateInsight(svc, { ...res.scope, force });
    return NextResponse.json(out);
  } catch (e) {
    console.error('[insights]', e);
    return NextResponse.json({ error: 'Error generando insights.' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const vendedor = new URL(req.url).searchParams.get('vendedor')?.trim() || null;
  return handle(vendedor, false);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const vendedor = (body.vendedor ?? '').trim() || null;
  return handle(vendedor, true);
}
