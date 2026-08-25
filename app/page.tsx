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

  // Los rebotes al login llevan motivo: la sesión es válida, así que sin él el
  // usuario vuelve a entrar, vuelve a rebotar y no se entera nunca de que lo
  // que está mal es el perfil. Ver el cartel en /login.
  if (!profile) redirect('/login?e=perfil');

  if (profile.rol === 'admin') redirect('/dashboard/total');
  if (profile.rol === 'supervisor') redirect('/dashboard/supervisor');
  if (profile.rol === 'vendedor') {
    if (!profile.vendedor_nombre) redirect('/login?e=sinvendedor');
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre)}`);
  }

  redirect('/login?e=perfil');
}
