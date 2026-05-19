import { Sidebar, SupervisorLink } from './Sidebar';
import { ShellLayout } from './ShellLayout';
import { fetchMonthInfo } from '@/lib/calculations/queries';
import { getCurrentProfile, getAdminEquipos } from '@/lib/supabase/profile';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();

  // Parallel: load equipos (cached) + month info (cached)
  const [equipos, monthInfo] = profile
    ? await Promise.all([
        profile.rol === 'admin' ? getAdminEquipos() : Promise.resolve<string[]>([]),
        (async () => {
          const today = new Date();
          return fetchMonthInfo(today.getFullYear(), today.getMonth() + 1, today);
        })(),
      ])
    : [[] as string[], { diasLaborables: 0, diasTrabajados: 0 }];

  const supervisores: SupervisorLink[] = equipos.map((equipo) => ({ equipo }));

  const sidebar = profile ? (
    <Sidebar
      rol={profile.rol}
      nombre={profile.nombre}
      vendedorNombre={profile.vendedor_nombre}
      supervisores={supervisores}
      diasLaborables={monthInfo.diasLaborables}
      diasTrabajados={monthInfo.diasTrabajados}
    />
  ) : null;

  return (
    <ShellLayout sidebar={sidebar}>
      {children}
    </ShellLayout>
  );
}
