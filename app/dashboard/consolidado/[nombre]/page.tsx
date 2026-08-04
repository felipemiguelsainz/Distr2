import { AppShell } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/ui/FilterBar';
import { KpiSkeleton } from '@/components/ui/Skeleton';
import { EmptyMonth } from '@/components/ui/EmptyMonth';
import { fetchSupervisorKpisMulti, fetchCCCByEquipo, fetchMetasCccByVendedor } from '@/lib/calculations/queries';
import { Periodo, TOTAL_EMPRESA, labelPeriodos, resolverPeriodos } from '@/lib/periodos';
import { SIN_SUPERVISOR } from '@/lib/constants';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ConsolidadoClient } from './ConsolidadoClient';

interface PageParams  { nombre: string }
interface SearchParams { mes?: string; anio?: string }

export default async function ConsolidadoPage({
  params,
  searchParams,
}: {
  params:       Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { nombre } = await params;
  const sp          = await searchParams;
  const segmento    = decodeURIComponent(nombre);
  // El segmento sentinel significa "todos los equipos" (sólo admin).
  const esTotal     = segmento === TOTAL_EMPRESA;
  const equipo      = esTotal ? '' : segmento;

  const today = new Date();
  const sel   = resolverPeriodos(sp, today);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre, equipo')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  // Vendedores: no access
  if (profile.rol === 'vendedor') {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre ?? '')}`);
  }

  // Supervisors can only see their own equipo (nunca el total de la empresa)
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
      redirect(`/dashboard/consolidado/${encodeURIComponent(myEquipo)}`);
    }
  }

  // Total Empresa es exclusivo de admin
  if (esTotal && profile.rol !== 'admin') redirect('/');

  // For admin: load equipo list to populate the supervisor filter
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
          .filter((e): e is string => !!e && e !== SIN_SUPERVISOR),
      ),
    ).sort((a, b) => a.localeCompare(b));
  }

  const titulo = esTotal ? 'Total Empresa' : equipo;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71717a]"
               style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Consolidado
            </p>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b] mt-0.5">
              {titulo}
            </h1>
            <p className="text-[13px] text-[#71717a] mt-0.5">{sel.label}</p>
          </div>
          <Suspense>
            <FilterBar
              meses={sel.meses}
              anios={sel.anios}
              equipos={profile.rol === 'admin' ? equipos : undefined}
              equipoActual={equipo}
              equipoBasePath="/dashboard/consolidado"
              permitirTotalEmpresa={profile.rol === 'admin'}
            />
          </Suspense>
        </div>

        <Suspense fallback={<KpiSkeleton />}>
          <ConsolidadoSection
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

async function ConsolidadoSection({
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
  // El CCC no se suma entre meses: se toma el del período más reciente.
  const { anio, mes } = principal;

  const [{ porVendedor, totales }, ccc, metaCccByVendedor] = await Promise.all([
    fetchSupervisorKpisMulti(equipo, periodos, today),
    fetchCCCByEquipo(equipo, anio, mes),
    fetchMetasCccByVendedor(equipo, anio, mes),
  ]);

  if (totales.length === 0) return <EmptyMonth mes={mes} anio={anio} />;

  return (
    <ConsolidadoClient
      porVendedor={porVendedor}
      ccc={ccc}
      metaCccByVendedor={metaCccByVendedor}
      cccCaption={multi ? `CCC: ${labelPeriodos([principal])} (no se suma entre meses)` : undefined}
    />
  );
}
