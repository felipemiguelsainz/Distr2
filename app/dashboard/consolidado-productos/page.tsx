import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TOTAL_EMPRESA } from '@/lib/periodos';

export default async function ConsolidadoProductosIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre, equipo')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  if (profile.rol === 'vendedor') {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre ?? '')}`);
  }

  if (profile.rol === 'supervisor') {
    let eq = profile.equipo ?? '';
    if (!eq) {
      const { data: me } = await supabase
        .from('vendedores')
        .select('equipo')
        .eq('nombre', profile.vendedor_nombre ?? '')
        .single();
      eq = me?.equipo ?? '';
    }
    redirect(`/dashboard/consolidado-productos/${encodeURIComponent(eq)}`);
  }

  // admin: arranca en Total Empresa (todos los equipos)
  redirect(`/dashboard/consolidado-productos/${TOTAL_EMPRESA}`);
}
