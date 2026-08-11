import { AppShell } from '@/components/layout/AppShell';
import { SinEquipo } from '@/components/ui/SinEquipo';
import { FilterBar } from '@/components/ui/FilterBar';
import { KpiSkeleton } from '@/components/ui/Skeleton';
import { createClient } from '@/lib/supabase/server';
import { veTodaLaEmpresa } from '@/lib/auth/alcance';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { fetchCatalogoProductos, fetchConsolidadoPorProducto } from '@/lib/calculations/productos';
import { Periodo, TOTAL_EMPRESA, labelPeriodos, resolverPeriodos } from '@/lib/periodos';
import { SIN_SUPERVISOR } from '@/lib/constants';
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
  const segmento    = decodeURIComponent(nombre);
  const esTotal     = segmento === TOTAL_EMPRESA;
  const equipo      = esTotal ? '' : segmento;

  const today = new Date();
  const sel   = resolverPeriodos(sp, today);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre, equipo, ve_empresa')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  if (profile.rol === 'vendedor') {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre ?? '')}`);
  }

  const veTodo = veTodaLaEmpresa(profile);

  // Supervisor comun: encerrado en su equipo. Con alcance de empresa no, porque
  // justamente puede mirar cualquiera.
  if (profile.rol === 'supervisor' && !veTodo) {
    let myEquipo = profile.equipo ?? '';
    if (!myEquipo) {
      const { data: meVendedor } = await supabase
        .from('vendedores')
        .select('equipo')
        .eq('nombre', profile.vendedor_nombre ?? '')
        .single();
      myEquipo = meVendedor?.equipo ?? '';
    }
    // Sin equipo: redirigir a un segmento vacío arma un bucle de redirects.
    if (!myEquipo) return <AppShell><SinEquipo /></AppShell>;
    if (myEquipo !== equipo) {
      redirect(`/dashboard/consolidado-productos/${encodeURIComponent(myEquipo)}`);
    }
  }

  // Total Empresa: solo quien tiene alcance de empresa
  if (esTotal && !veTodo) redirect('/');

  let equipos: string[] = [];
  if (veTodo) {
    const { data: vRows } = await supabase
      .from('vendedores')
      .select('equipo')
      .eq('activo', true)
      .not('equipo', 'is', null);

    equipos = Array.from(
      new Set(
        (vRows ?? [])
          .map((v) => (v.equipo as string | null)?.trim())
          .filter((e): e is string => !!e && e !== SIN_SUPERVISOR),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71717a]"
               style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Consolidado por producto
            </p>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b] mt-0.5">
              {esTotal ? 'Total Empresa' : equipo}
            </h1>
            <p className="text-[13px] text-[#71717a] mt-0.5">{sel.label}</p>
          </div>
          <Suspense>
            <FilterBar
              meses={sel.meses}
              anios={sel.anios}
              equipos={veTodo ? equipos : undefined}
              equipoActual={equipo}
              equipoBasePath="/dashboard/consolidado-productos"
              permitirTotalEmpresa={veTodo}
            />
          </Suspense>
        </div>

        <Suspense fallback={<KpiSkeleton />}>
          <Section
            equipo={equipo}
            periodos={sel.periodos}
            principal={sel.principal}
            multi={sel.multi}
            todayIso={today.toISOString()}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function Section({
  equipo,
  periodos,
  principal,
  multi,
  todayIso,
}: {
  equipo:    string;   // '' = todos los equipos
  periodos:  Periodo[];
  principal: Periodo;
  multi:     boolean;
  todayIso:  string;
}) {
  const today = new Date(todayIso);

  const [catalogo, filasIniciales] = await Promise.all([
    fetchCatalogoProductos(),
    fetchConsolidadoPorProducto(equipo, periodos, null, today),
  ]);

  return (
    <ProductosClient
      equipo={equipo}
      periodos={periodos}
      catalogo={catalogo}
      filasIniciales={filasIniciales}
      cccCaption={multi ? `CCC: ${labelPeriodos([principal])} (no se suma entre meses)` : undefined}
    />
  );
}
