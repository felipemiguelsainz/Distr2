import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function SupervisorIndexPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('vendedor_nombre')
    .eq('id', user.id)
    .single();

  if (profile?.vendedor_nombre) {
    redirect(`/dashboard/supervisor/${encodeURIComponent(profile.vendedor_nombre)}`);
  }

  redirect('/login');
}
