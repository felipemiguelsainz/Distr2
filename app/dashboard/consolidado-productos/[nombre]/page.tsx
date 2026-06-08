import { AppShell } from '@/components/layout/AppShell';
import { MonthFilter } from '@/components/ui/MonthFilter';
import { SupervisorFilter } from '@/components/ui/SupervisorFilter';
import { KpiSkeleton } from '@/components/ui/Skeleton';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { fetchCatalogoProductos, fetchConsolidadoPorProducto } from '@/lib/calculations/productos';
import { ProductosClient } from './ProductosClient';

interface PageParams  { nombre: string }
interface SearchParams { mes?: string; anio?: string }

export default async function ConsolidadoProductosPage({
  params,
  searchParams,
}: {
  params:       Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { nombre } = await params;
  const sp          = await searchParams;
  const equipo      = decodeURIComponent(nombre);

  const today = new Date();
  const mes   = parseInt(sp.mes  ?? String(today.getMonth() + 1), 10);
  const anio  = parseInt(sp.anio ?? String(today.getFullYear()),   10);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre, equipo')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  if (profile.rol === 'vendedor') {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre ?? '')}`);
  }

  if (profile.rol === 'supervisor') {
    let myEquipo = profile.equipo ?? '';
    if (!myEquipo) {
      const { data: meVendedor } = await supabase
        .from('vendedores')
        .select('equipo')
        .eq('nombre', profile.vendedor_nombre ?? '')
        .single();
      myEquipo = meVendedor?.equipo ?? '';
    }
    if (myEquipo !== equipo) {
      redirect(`/dashboard/consolidado-productos/${encodeURIComponent(myEquipo)}`);
    }
  }

  let equipos: string[] = [];
  if (profile.rol === 'admin') {
    const { data: vRows } = await supabase
      .from('vendedores')
      .select('equipo')
      .eq('activo', true)
      .not('equipo', 'is', null);

    equipos = Array.from(
      new Set(
        (vRows ?? [])
          .map((v) => (v.equipo as string | null)?.trim())
          .filter((e): e is string => !!e && e !== 'SIN SUPERVISOR'),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]"
               style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Consolidado por producto
            </p>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#f0f4ff] mt-0.5">
              {equipo}
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {profile.rol === 'admin' && equipos.length > 0 && (
              <Suspense>
                <SupervisorFilter equipos={equipos} current={equipo} />
              </Suspense>
            )}
            <Suspense>
              <MonthFilter defaultMes={mes} defaultAnio={anio} />
            </Suspense>
          </div>
        </div>

        <Suspense fallback={<KpiSkeleton />}>
          <Section equipo={equipo} mes={mes} anio={anio} todayIso={today.toISOString()} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function Section({
  equipo,
  mes,
  anio,
  todayIso,
}: {
  equipo:   string;
  mes:      number;
  anio:     number;
  todayIso: string;
}) {
  const today = new Date(todayIso);

  const [catalogo, filasIniciales] = await Promise.all([
    fetchCatalogoProductos(),
    fetchConsolidadoPorProducto(equipo, anio, mes, null, today),
  ]);

  return (
    <ProductosClient
      equipo={equipo}
      mes={mes}
      anio={anio}
      catalogo={catalogo}
      filasIniciales={filasIniciales}
    />
  );
}
