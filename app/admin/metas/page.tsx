import { AppShell } from '@/components/layout/AppShell';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { MetasClient } from './MetasClient';

export default async function MetasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', user.id)
    .single();

  if (profile?.rol !== 'admin') redirect('/');

  const today = new Date();
  return (
    <AppShell>
      <MetasClient defaultAnio={today.getFullYear()} defaultMes={today.getMonth() + 1} />
    </AppShell>
  );
}
