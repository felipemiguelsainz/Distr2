import { AppShell } from '@/components/layout/AppShell';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { UsuariosClient } from './UsuariosClient';

export default async function UsuariosAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol')
    .eq('id', user.id)
    .single();
  if (profile?.rol !== 'admin') redirect('/');

  // Listas para los desplegables del formulario.
  const svc = createServiceClient();
  const { data: vRows } = await svc
    .from('vendedores')
    .select('nombre, equipo')
    .eq('activo', true)
    .not('equipo', 'is', null);

  const vendedores = Array.from(
    new Set((vRows ?? []).map((v) => v.nombre as string)),
  ).sort((a, b) => a.localeCompare(b));

  const supervisores = Array.from(
    new Set(
      (vRows ?? [])
        .map((v) => (v.equipo as string | null)?.trim())
        .filter((e): e is string => !!e && e !== 'SIN SUPERVISOR'),
    ),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <AppShell>
      <UsuariosClient
        supervisores={supervisores}
        vendedores={vendedores}
        currentUserId={user.id}
      />
    </AppShell>
  );
}
