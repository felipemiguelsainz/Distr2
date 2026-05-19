import { AppShell } from '@/components/layout/AppShell';
import { CargarClient } from './CargarClient';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function CargarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', user.id)
    .single();

  if (profile?.rol !== 'admin') redirect('/');

  return (
    <AppShell>
      <CargarClient />
    </AppShell>
  );
}
