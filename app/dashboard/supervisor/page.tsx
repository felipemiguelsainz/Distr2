import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function SupervisorIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('vendedor_nombre, equipo')
    .eq('id', user.id)
    .single();

  // El segmento de /dashboard/supervisor/[nombre] es el EQUIPO → preferir equipo.
  const destino = profile?.equipo ?? profile?.vendedor_nombre;
  if (destino) {
    redirect(`/dashboard/supervisor/${encodeURIComponent(destino)}`);
  }

  redirect('/login');
}
