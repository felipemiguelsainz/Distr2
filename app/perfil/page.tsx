import { AppShell } from '@/components/layout/AppShell';
import { getCurrentProfile } from '@/lib/supabase/profile';
import { redirect } from 'next/navigation';
import { PasswordChangeForm } from '@/components/perfil/PasswordChangeForm';

const ROL_LABEL: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  vendedor: 'Vendedor',
};

export default async function PerfilPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');

  return (
    <AppShell>
      <div className="max-w-xl mx-auto space-y-7">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b]">Mi perfil</h1>
          <p className="text-[13px] text-[#71717a] mt-0.5">Datos de la cuenta y contraseña</p>
        </div>

        {/* Datos (solo lectura) */}
        <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 p-5 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[12px] text-[#71717a] uppercase tracking-[0.04em]">Nombre</span>
            <span className="text-[14px] font-medium text-[#09090b]">{profile.nombre ?? '—'}</span>
          </div>
          <div className="flex justify-between items-center border-t border-[#e4e4e7] pt-3">
            <span className="text-[12px] text-[#71717a] uppercase tracking-[0.04em]">Rol</span>
            <span className="text-[14px] font-medium text-[#09090b]">{ROL_LABEL[profile.rol] ?? profile.rol}</span>
          </div>
          {(profile.vendedor_nombre || profile.equipo) && (
            <div className="flex justify-between items-center border-t border-[#e4e4e7] pt-3">
              <span className="text-[12px] text-[#71717a] uppercase tracking-[0.04em]">
                {profile.rol === 'supervisor' ? 'Equipo' : 'Vendedor'}
              </span>
              <span className="text-[14px] font-medium text-[#09090b]">
                {profile.rol === 'supervisor' ? profile.equipo : profile.vendedor_nombre}
              </span>
            </div>
          )}
        </div>

        {/* Cambio de contraseña */}
        <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5 p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a] mb-4" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            Cambiar contraseña
          </p>
          <PasswordChangeForm requireCurrent />
        </div>
      </div>
    </AppShell>
  );
}
