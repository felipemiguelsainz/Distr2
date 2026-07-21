import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveCarteras, type UserContext } from '@/lib/ai/tools';
import { computeEnfriandose } from '@/lib/ai/insights';

// Lista completa de clientes enfriándose del alcance del usuario (sin IA).
export const maxDuration = 60;

export async function GET(req: Request) {
  const vendedor = new URL(req.url).searchParams.get('vendedor')?.trim() || null;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data: profile } = await supabase.from('profiles').select('rol, vendedor_nombre, equipo').eq('id', user.id).single();
  if (!profile) return NextResponse.json({ error: 'Sin perfil' }, { status: 403 });
  // Insights es solo para admin (mismo bloqueo que /insights).
  if (profile.rol !== 'admin') return NextResponse.json({ error: 'Sin acceso a Insights' }, { status: 403 });

  const svc = createServiceClient();
  const ctx: UserContext = { rol: profile.rol, vendedor_nombre: profile.vendedor_nombre, equipo: profile.equipo };
  const allowed = await resolveCarteras(svc, ctx);

  let carteras: string[] | null = allowed; // null = empresa (admin)
  if (vendedor) {
    if (allowed !== null && !allowed.includes(vendedor)) {
      return NextResponse.json({ error: 'Vendedor fuera de tu alcance' }, { status: 403 });
    }
    carteras = [vendedor];
  }

  try {
    const clientes = await computeEnfriandose(svc, carteras, new Date());
    return NextResponse.json({
      clientes,
      total: clientes.length,
      valor_total: clientes.reduce((a, c) => a + c.valor_mensual, 0),
      kg_total: clientes.reduce((a, c) => a + (c.kg_mensual ?? 0), 0),
    });
  } catch (e) {
    console.error('[enfriandose]', e);
    return NextResponse.json({ error: 'Error calculando clientes enfriándose.' }, { status: 500 });
  }
}
