import { createServiceClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/supabase/profile';
import { redirect } from 'next/navigation';
import { UsuariosClient } from './UsuariosClient';

// Gate de admin + AppShell + tabs los provee app/admin/layout.tsx.
export default async function UsuariosAdminPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (profile.rol !== 'admin') redirect('/');

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
    <UsuariosClient
      supervisores={supervisores}
      vendedores={vendedores}
      currentUserId={profile.id}
    />
  );
}
