import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { PasswordChangeForm } from '@/components/perfil/PasswordChangeForm';

// Página standalone (sin AppShell) para el cambio forzado en el primer login.
// No usa AppShell a propósito: así el redirect de must_change_password no hace loop.
export default async function CambiarPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#fafafa] px-4 animate-rise">
      <div className="mb-6 text-center">
        <h1 className="text-[22px] font-bold tracking-[-0.01em] text-[#09090b]">Cambiá tu contraseña</h1>
        <p className="text-[13px] text-[#71717a] mt-1 max-w-[320px]">
          Estás usando una contraseña temporal. Elegí una nueva para continuar.
        </p>
      </div>
      <div className="w-full max-w-[360px] bg-[#ffffff] rounded-2xl border border-[#e4e4e7] shadow-[0_10px_30px_rgba(0,0,0,0.08)] px-8 py-8">
        <PasswordChangeForm requireCurrent={false} redirectTo="/" />
      </div>
    </div>
  );
}
