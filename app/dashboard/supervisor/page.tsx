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

  const destino = profile?.vendedor_nombre ?? profile?.equipo;
  if (destino) {
    redirect(`/dashboard/supervisor/${encodeURIComponent(destino)}`);
  }

  redirect('/login');
}
