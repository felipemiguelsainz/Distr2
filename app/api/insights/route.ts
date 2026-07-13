import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { llmAvailable } from '@/lib/ai/provider';
import { resolveCarteras, type UserContext } from '@/lib/ai/tools';
import { getLatestInsight } from '@/lib/ai/insights';

// La app SÓLO sirve lo cacheado (rápido). Generar tarda ~35s y no entra en Vercel
// free (10s): lo hace el job diario (scripts/daily-jobs.ts en GitHub Actions).
export const maxDuration = 15;

type SvcClient = ReturnType<typeof createServiceClient>;

/**
 * Resuelve el scope_key del insight según el rol y el vendedor pedido (opcional),
 * y autoriza. Sin vendedor: vista agregada (empresa/equipo/su cartera). Con
 * vendedor: ese vendedor, si está en alcance. NO calcula KPIs: la app sólo sirve
 * el payload cacheado (que ya trae sus propios números), así que sólo necesita
 * el scope_key.
 */
async function resolveScope(svc: SvcClient, vendedorParam: string | null):
  Promise<{ scopeKey: string } | { error: string; status: 401 | 403 | 400 }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado', status: 401 };
  const { data: profile } = await supabase.from('profiles').select('rol, vendedor_nombre, equipo').eq('id', user.id).single();
  if (!profile) return { error: 'Sin perfil', status: 403 };

  const ctx: UserContext = { rol: profile.rol, vendedor_nombre: profile.vendedor_nombre, equipo: profile.equipo };
  const allowed = await resolveCarteras(svc, ctx);

  // Vista por vendedor
  if (vendedorParam) {
    if (allowed !== null && !allowed.includes(vendedorParam)) return { error: 'Vendedor fuera de tu alcance', status: 403 };
    return { scopeKey: `vendedor:${vendedorParam}` };
  }

  // Vista agregada (default)
  if (ctx.rol === 'admin') return { scopeKey: 'empresa:total' };
  if (ctx.rol === 'supervisor') {
    if (!ctx.equipo) return { error: 'Sin equipo asignado', status: 403 };
    return { scopeKey: `equipo:${ctx.equipo}` };
  }
  if (ctx.rol === 'vendedor' && ctx.vendedor_nombre) return { scopeKey: `vendedor:${ctx.vendedor_nombre}` };
  return { error: 'Sin alcance', status: 403 };
}

async function handle(vendedor: string | null) {
  // TODO dentro de try/catch: cualquier error debe salir como JSON, nunca como
  // una página HTML de error (rompería el res.json() del cliente).
  try {
    if (!llmAvailable()) return NextResponse.json({ error: 'Insights no configurados (falta API key).' }, { status: 503 });
    const svc = createServiceClient();
    const res = await resolveScope(svc, vendedor);
    if ('error' in res) return NextResponse.json({ error: res.error }, { status: res.status });
    // Sólo servir lo cacheado por el job diario. Si aún no hay, payload:null →
    // la UI muestra "análisis en preparación" en vez de intentar generar (timeout).
    const out = await getLatestInsight(svc, res.scopeKey);
    return NextResponse.json(out ?? { payload: null, generated_at: null });
  } catch (e) {
    console.error('[insights]', e);
    return NextResponse.json({ error: 'Error leyendo insights.' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const vendedor = new URL(req.url).searchParams.get('vendedor')?.trim() || null;
  return handle(vendedor);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const vendedor = (body.vendedor ?? '').trim() || null;
  return handle(vendedor);
}
