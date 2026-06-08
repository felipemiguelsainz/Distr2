import { createServiceClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/supabase/profile';
import { redirect } from 'next/navigation';
import { PanelClient } from './PanelClient';

// AppShell + tabs los provee app/admin/layout.tsx. Acá reforzamos admin-only.
export default async function PanelAdminPage() {
  const profile = await getCurrentProfile();
  if (profile?.rol !== 'admin') redirect('/');

  const today = new Date();
  const anio  = today.getFullYear();
  const mes   = today.getMonth() + 1;

  const svc = createServiceClient();
  const { data: existing } = await svc
    .from('config_meses')
    .select('dias_laborables')
    .eq('anio', anio)
    .eq('mes', mes)
    .maybeSingle();

  const meses = [{ anio, mes, dias_laborables: existing?.dias_laborables ?? null }];

  return <PanelClient meses={meses} />;
}
