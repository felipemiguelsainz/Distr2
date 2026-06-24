import { getCurrentProfile } from '@/lib/supabase/profile';
import { createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { MetasClient } from './MetasClient';

// AppShell + tabs los provee app/admin/layout.tsx. Acá reforzamos admin-only.
export default async function MetasPage() {
  const profile = await getCurrentProfile();
  if (profile?.rol !== 'admin') redirect('/');

  // Vendedores activos para el selector de exclusión del cálculo de metas.
  const svc = createServiceClient();
  const { data: vData } = await svc.from('vendedores').select('nombre').eq('activo', true).order('nombre');
  const vendedores = (vData ?? []).map((v: { nombre: string }) => v.nombre);

  const today = new Date();
  return <MetasClient defaultAnio={today.getFullYear()} defaultMes={today.getMonth() + 1} vendedores={vendedores} />;
}
