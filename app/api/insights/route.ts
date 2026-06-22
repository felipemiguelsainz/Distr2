import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { llmAvailable } from '@/lib/ai/provider';
import { resolveCarteras, type UserContext } from '@/lib/ai/tools';
import { getOrCreateInsight } from '@/lib/ai/insights';

// La primera generación (KPIs + LLM) puede tardar; evitar el timeout default.
export const maxDuration = 60;

// Valida el rol/scope y devuelve el contexto + carteras visibles, o un error.
async function ctxOrError(svc: ReturnType<typeof createServiceClient>, vendedor: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autenticado', status: 401 as const };
  const { data: profile } = await supabase.from('profiles').select('rol, vendedor_nombre').eq('id', user.id).single();
  if (!profile) return { error: 'Sin perfil', status: 403 as const };
  const ctx: UserContext = { rol: profile.rol, vendedor_nombre: profile.vendedor_nombre };
  const carteras = await resolveCarteras(svc, ctx);
  if (carteras !== null && !carteras.includes(vendedor)) {
    return { error: 'Vendedor fuera de tu alcance', status: 403 as const };
  }
  return { ctx };
}

export async function GET(req: Request) {
  if (!llmAvailable()) return NextResponse.json({ error: 'Insights no configurados (falta API key).' }, { status: 503 });
  const vendedor = new URL(req.url).searchParams.get('vendedor')?.trim();
  if (!vendedor) return NextResponse.json({ error: 'Falta vendedor' }, { status: 400 });
  const svc = createServiceClient();
  const check = await ctxOrError(svc, vendedor);
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });
  try {
    const out = await getOrCreateInsight(svc, vendedor, new Date(), false);
    return NextResponse.json(out);
  } catch (e) {
    console.error('[insights]', e);
    return NextResponse.json({ error: 'Error generando insights.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!llmAvailable()) return NextResponse.json({ error: 'Insights no configurados (falta API key).' }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const vendedor = (body.vendedor ?? '').trim();
  if (!vendedor) return NextResponse.json({ error: 'Falta vendedor' }, { status: 400 });
  const svc = createServiceClient();
  const check = await ctxOrError(svc, vendedor);
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });
  try {
    const out = await getOrCreateInsight(svc, vendedor, new Date(), true); // force
    return NextResponse.json(out);
  } catch (e) {
    console.error('[insights]', e);
    return NextResponse.json({ error: 'Error generando insights.' }, { status: 500 });
  }
}
