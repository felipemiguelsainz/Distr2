import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { llmAvailable } from '@/lib/ai/provider';
import { resolveCarteras } from '@/lib/ai/tools';
import { InsightsClient } from './InsightsClient';

export default async function InsightsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles').select('rol, vendedor_nombre').eq('id', user.id).single();
  if (!profile) redirect('/login');

  const svc = createServiceClient();
  const carteras = await resolveCarteras(svc, { rol: profile.rol, vendedor_nombre: profile.vendedor_nombre });

  // Lista de vendedores seleccionables según el alcance del usuario.
  let vendedores: string[];
  if (carteras === null) {
    const { data } = await svc.from('vendedores').select('nombre').eq('activo', true).order('nombre');
    vendedores = (data ?? []).map((v: { nombre: string }) => v.nombre);
  } else {
    vendedores = [...carteras].sort();
  }

  return (
    <AppShell>
      <div className="max-w-[820px] mx-auto">
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b]">Insights</h1>
        <p className="text-[13px] text-[#71717a] mt-0.5 mb-5">
          Resumen del mes, clientes en riesgo y acciones sugeridas por vendedor.
        </p>
        {!llmAvailable() ? (
          <p className="text-[13px] text-[#dc2626] bg-[#dc2626]/[0.08] border border-[#dc2626]/20 px-3 py-2 rounded-[10px]">
            Los insights no están configurados (falta la API key del proveedor de IA).
          </p>
        ) : (
          <InsightsClient vendedores={vendedores} />
        )}
      </div>
    </AppShell>
  );
}
