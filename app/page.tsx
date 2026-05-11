import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/login');

  if (profile.rol === 'admin') redirect('/dashboard/total');
  if (profile.rol === 'supervisor') redirect('/dashboard/supervisor');
  if (profile.rol === 'vendedor' && profile.vendedor_nombre) {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre)}`);
  }

  redirect('/login');
}
