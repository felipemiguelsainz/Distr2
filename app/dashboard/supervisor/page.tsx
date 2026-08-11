import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/layout/AppShell';
import { SinEquipo } from '@/components/ui/SinEquipo';

export default async function SupervisorIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre, equipo')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  if (profile.rol === 'vendedor' && profile.vendedor_nombre) {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre)}`);
  }

  // El segmento de /dashboard/supervisor/[nombre] es el EQUIPO → preferir equipo.
  const destino = profile.equipo ?? profile.vendedor_nombre;
  if (destino) {
    redirect(`/dashboard/supervisor/${encodeURIComponent(destino)}`);
  }

  // El admin no tiene equipo propio, así que "Mi Equipo" no aplica: va a su
  // home. Antes caía en el redirect('/login') de abajo y, estando logueado,
  // parecía que se le había caído la sesión.
  if (profile.rol === 'admin') redirect('/dashboard/total');

  // Supervisor sin equipo cargado: decirle qué pasa en vez de rebotarlo.
  return <AppShell><SinEquipo /></AppShell>;
}
