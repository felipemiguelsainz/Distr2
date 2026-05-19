import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function ConsolidadoIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  if (profile.rol === 'vendedor') {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre ?? '')}`);
  }

  if (profile.rol === 'supervisor') {
    const { data: me } = await supabase
      .from('vendedores')
      .select('equipo')
      .eq('nombre', profile.vendedor_nombre ?? '')
      .single();
    const eq = me?.equipo ?? '';
    redirect(`/dashboard/consolidado/${encodeURIComponent(eq)}`);
  }

  // admin: redirect to first equipo alphabetically
  const { data: vRows } = await supabase
    .from('vendedores')
    .select('equipo')
    .eq('activo', true)
    .not('equipo', 'is', null);

  const equipos = Array.from(
    new Set(
      (vRows ?? [])
        .map((v) => (v.equipo as string | null)?.trim())
        .filter((e): e is string => !!e && e !== 'SIN SUPERVISOR'),
    ),
  ).sort((a, b) => a.localeCompare(b));

  if (equipos.length === 0) redirect('/dashboard/total');
  redirect(`/dashboard/consolidado/${encodeURIComponent(equipos[0])}`);
}
