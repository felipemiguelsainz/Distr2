import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { veTodaLaEmpresa } from '@/lib/auth/alcance';
import { AppShell } from '@/components/layout/AppShell';
import { SinEquipo } from '@/components/ui/SinEquipo';
import { TOTAL_EMPRESA } from '@/lib/periodos';

export default async function ConsolidadoIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre, equipo, ve_empresa')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  if (profile.rol === 'vendedor') {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre ?? '')}`);
  }

  // Con alcance de empresa se cae al Total Empresa de abajo, igual que un
  // admin: no tiene sentido encerrarlo en su equipo si puede ver todos.
  if (profile.rol === 'supervisor' && !veTodaLaEmpresa(profile)) {
    let eq = profile.equipo ?? '';
    if (!eq) {
      const { data: me } = await supabase
        .from('vendedores')
        .select('equipo')
        .eq('nombre', profile.vendedor_nombre ?? '')
        .single();
      eq = me?.equipo ?? '';
    }
    // Sin equipo no hay a dónde ir: redirigir con segmento vacío vuelve acá
    // y arma un bucle de redirects.
    if (!eq) return <AppShell><SinEquipo /></AppShell>;
    redirect(`/dashboard/consolidado/${encodeURIComponent(eq)}`);
  }

  // admin o alcance de empresa: arranca en Total Empresa (todos los equipos); desde el filtro baja a uno
  redirect(`/dashboard/consolidado/${TOTAL_EMPRESA}`);
}
