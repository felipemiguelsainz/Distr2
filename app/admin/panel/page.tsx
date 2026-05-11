import { AppShell } from '@/components/layout/AppShell';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PanelClient } from './PanelClient';

export default async function PanelAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', user.id)
    .single();

  if (profile?.rol !== 'admin') redirect('/');

  // Solo el mes corriente
  const today = new Date();
  const anio  = today.getFullYear();
  const mes   = today.getMonth() + 1;

  const { data: existing } = await supabase
    .from('config_meses')
    .select('dias_laborables')
    .eq('anio', anio)
    .eq('mes', mes)
    .single();

  const meses = [{ anio, mes, dias_laborables: existing?.dias_laborables ?? 0 }];

  return (
    <AppShell>
      <PanelClient meses={meses} />
    </AppShell>
  );
}
