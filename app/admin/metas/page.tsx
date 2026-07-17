import { getCurrentProfile } from '@/lib/supabase/profile';
import { createServiceClient } from '@/lib/supabase/server';
import { tieneSupervisor } from '@/lib/constants';
import { redirect } from 'next/navigation';
import { MetasClient } from './MetasClient';

// AppShell + tabs los provee app/admin/layout.tsx. Acá reforzamos admin-only.
export default async function MetasPage() {
  const profile = await getCurrentProfile();
  if (profile?.rol !== 'admin') redirect('/');

  // Vendedores activos para el selector de exclusión del cálculo de metas.
  const svc = createServiceClient();
  const today = new Date();

  // El reparto de metas pesa por nombre tal como viene en las ventas, y hay nombres
  // que no matchean el maestro (ej: ventas dice 'VENTA OFICINA LANU', maestro
  // 'VENTA OFICINA LANUS'). Sumamos los del historial para que se puedan excluir.
  const desde = new Date(today.getFullYear(), today.getMonth() - 12, 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [{ data: vData }, { data: hData }] = await Promise.all([
    svc.from('vendedores').select('nombre, supervisor').eq('activo', true).order('nombre'),
    svc.rpc('resumen_totales_por_vendedor_rubro', { p_desde: iso(desde), p_hasta: iso(today) }),
  ]);

  const delMaestro = (vData ?? []).map((v: { nombre: string; supervisor: string | null }) => ({
    nombre: v.nombre,
    sinSupervisor: !tieneSupervisor(v.supervisor),
    enMaestro: true,
  }));

  const conocidos = new Set(delMaestro.map(v => v.nombre));
  const huerfanos = [...new Set((hData ?? []).map((r: { vendedor: string }) => r.vendedor))]
    .filter((n): n is string => typeof n === 'string' && !conocidos.has(n))
    .sort()
    // Sin registro en el maestro no sabemos si tienen supervisor: quedan sin tildar.
    .map(nombre => ({ nombre, sinSupervisor: false, enMaestro: false }));

  const vendedores = [...delMaestro, ...huerfanos];
  return <MetasClient defaultAnio={today.getFullYear()} defaultMes={today.getMonth() + 1} vendedores={vendedores} />;
}
