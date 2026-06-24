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
    .from('profiles').select('rol, vendedor_nombre, equipo').eq('id', user.id).single();
  if (!profile) redirect('/login');

  const svc = createServiceClient();
  const carteras = await resolveCarteras(svc, { rol: profile.rol, vendedor_nombre: profile.vendedor_nombre, equipo: profile.equipo });

  // Vendedores seleccionables según alcance. Admin (carteras null) → todos.
  let vendedores: string[];
  if (carteras === null) {
    const { data } = await svc.from('vendedores').select('nombre').eq('activo', true).order('nombre');
    vendedores = (data ?? []).map((v: { nombre: string }) => v.nombre);
  } else {
    vendedores = [...carteras].sort();
  }

  return (
    <AppShell>
      <div className="bg-gray-50 -mx-4 -my-6 lg:-mx-6 lg:-my-8 min-h-full px-4 py-6 lg:px-8 lg:py-8">
        <div className="max-w-4xl mx-auto">
          {!llmAvailable() ? (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900">Insights</h1>
              <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">
                Los insights no están configurados (falta la API key del proveedor de IA).
              </p>
            </>
          ) : (
            <InsightsClient vendedores={vendedores} />
          )}
        </div>
      </div>
    </AppShell>
  );
}
