import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveCarteras } from '@/lib/ai/tools';
import { EnfriandoseClient } from './EnfriandoseClient';

export default async function EnfriandosePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles').select('rol, vendedor_nombre, equipo').eq('id', user.id).single();
  if (!profile) redirect('/login');
  // Insights es solo para admin.
  if (profile.rol !== 'admin') redirect('/');

  const svc = createServiceClient();
  const carteras = await resolveCarteras(svc, { rol: profile.rol, vendedor_nombre: profile.vendedor_nombre, equipo: profile.equipo });

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
        <div className="max-w-5xl mx-auto">
          <Link href="/insights" className="text-sm text-blue-600 hover:text-blue-700">← Volver a Insights</Link>
          {/* EnfriandoseClient lee ?vendedor= con useSearchParams → necesita Suspense. */}
          <Suspense fallback={<p className="mt-4 text-sm text-gray-500">Cargando…</p>}>
            <EnfriandoseClient vendedores={vendedores} mostrarVendedor={carteras === null || vendedores.length > 1} />
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}
