import { AppShell } from '@/components/layout/AppShell';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PlanificacionClientWrapper } from './PlanificacionClientWrapper';

export default async function PlanificacionPage() {
  // Gate liviano; los ~7k PDVs los baja el cliente desde /api/planificacion.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  // Reasignar carteras es decisión de jefatura: el vendedor no entra.
  if (profile.rol !== 'admin' && profile.rol !== 'supervisor') redirect('/perfil');

  return (
    <AppShell>
      {/* Mismo truco que /mapa: margen negativo para escapar el padding del
          AppShell y llenar el viewport (dvh por el chrome del browser mobile). */}
      <div className="-mx-4 -my-6 lg:-mx-6 lg:-my-8 h-[calc(100dvh-3.5rem)] lg:h-[100dvh]">
        <PlanificacionClientWrapper />
      </div>
    </AppShell>
  );
}
