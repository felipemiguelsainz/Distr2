import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { getCurrentProfile } from '@/lib/supabase/profile';
import { AdminTabs } from '@/components/admin/AdminTabs';

// Layout del área de configuración.
// - Admin: ve el título "Configuración" + todas las tabs.
// - Supervisor: solo accede a /admin/metas-ccc; ve la página sin tabs (su
//   entrada en el sidebar se llama "Metas del equipo").
// El gate fino (admin-only) de cada tab lo refuerzan las páginas y el proxy.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (profile.rol !== 'admin' && profile.rol !== 'supervisor') redirect('/');

  if (profile.rol !== 'admin') {
    // Supervisor: sin chrome de configuración, solo su contenido.
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto">{children}</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b]">Configuración</h1>
          <p className="text-[13px] text-[#71717a] mt-0.5">Días, metas, carga de datos y cuentas</p>
        </div>
        <AdminTabs />
        <div>{children}</div>
      </div>
    </AppShell>
  );
}
