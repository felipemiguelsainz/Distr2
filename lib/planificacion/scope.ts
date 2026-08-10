import { NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PlanScope {
  userId: string;
  rol: 'admin' | 'supervisor';
  /** Vendedores que este usuario puede asignar. null = todos (admin). */
  vendedoresPermitidos: Set<string> | null;
  svc: SupabaseClient;
}

/**
 * Autoriza y acota una request de Planificación.
 *
 * Solo entran admin y supervisor: reasignar carteras es una decisión de
 * jefatura, el vendedor no participa. El supervisor queda encerrado en los
 * vendedores de su equipo, tanto para ver como para asignar.
 *
 * Devuelve `{ error }` con la respuesta HTTP ya armada, o el scope resuelto.
 */
export async function getPlanScope(): Promise<{ error: NextResponse } | PlanScope> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, equipo, vendedor_nombre')
    .eq('id', user.id)
    .single();
  if (!profile) return { error: NextResponse.json({ error: 'Sin perfil' }, { status: 403 }) };

  if (profile.rol !== 'admin' && profile.rol !== 'supervisor') {
    return { error: NextResponse.json({ error: 'Sin acceso a Planificación' }, { status: 403 }) };
  }

  const svc = createServiceClient();

  if (profile.rol === 'admin') {
    return { userId: user.id, rol: 'admin', vendedoresPermitidos: null, svc };
  }

  // Supervisor sin equipo cargado: no ve nada, en vez de verlo todo.
  if (!profile.equipo) {
    return { userId: user.id, rol: 'supervisor', vendedoresPermitidos: new Set(), svc };
  }

  const { data: equipo } = await svc
    .from('vendedores')
    .select('nombre')
    .eq('equipo', profile.equipo)
    .eq('activo', true);

  return {
    userId: user.id,
    rol: 'supervisor',
    vendedoresPermitidos: new Set((equipo ?? []).map((v: { nombre: string }) => v.nombre)),
    svc,
  };
}

/** Lista ordenada de vendedores asignables por este usuario. */
export async function vendedoresAsignables(scope: PlanScope): Promise<string[]> {
  if (scope.vendedoresPermitidos) return [...scope.vendedoresPermitidos].sort();
  const { data } = await scope.svc
    .from('vendedores')
    .select('nombre')
    .eq('activo', true)
    .order('nombre');
  return (data ?? []).map((v: { nombre: string }) => v.nombre);
}
