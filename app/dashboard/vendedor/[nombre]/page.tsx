import { AppShell } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/ui/FilterBar';
import { RangoVendido } from '@/components/dashboard/RangoVendido';
import { KpiTable } from '@/components/dashboard/KpiTable';
import { TrendChart } from '@/components/dashboard/LazyCharts';
import { CccCard } from '@/components/dashboard/CccCard';
import { CoberturaTable } from '@/components/dashboard/CoberturaTable';
import { ClientesTable } from '@/components/dashboard/ClientesTable';
import {
  fetchVendedorKpisMulti,
  fetchTrendData,
  fetchCCC,
  fetchCobertura,
  fetchClientesData,
  fetchMetasCcc,
} from '@/lib/calculations/queries';
import { Periodo, labelPeriodos, resolverPeriodos } from '@/lib/periodos';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { KpiSkeleton } from '@/components/ui/Skeleton';
import { EmptyMonth } from '@/components/ui/EmptyMonth';

interface PageParams { nombre: string }
interface SearchParams { mes?: string; anio?: string; desde?: string; hasta?: string }

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function VendedorDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { nombre } = await params;
  const sp = await searchParams;
  const vendedor = decodeURIComponent(nombre);

  const supabase = await createClient();

  // Auth check + role-based access control
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre, equipo')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/login');

  // Vendedores can only see their own dashboard
  if (profile.rol === 'vendedor' && profile.vendedor_nombre !== vendedor) {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre ?? '')}`);
  }

  // Supervisors can only see vendedores from their equipo.
  // El equipo del supervisor sale de profiles.equipo (NO de vendedores: el
  // supervisor no suele ser una fila ahí → daría null y bloquearía todo).
  if (profile.rol === 'supervisor') {
    let myEquipo = profile.equipo ?? '';
    if (!myEquipo && profile.vendedor_nombre) {
      const { data: me } = await supabase
        .from('vendedores').select('equipo').eq('nombre', profile.vendedor_nombre).single();
      myEquipo = me?.equipo ?? '';
    }
    const { data: targetVendedor } = await supabase
      .from('vendedores').select('equipo').eq('nombre', vendedor).single();
    if (!myEquipo || myEquipo !== targetVendedor?.equipo) redirect('/');
  }

  const today = new Date();
  const sel   = resolverPeriodos(sp, today);
  const desde = isDate(sp.desde) ? sp.desde! : '';
  const hasta = isDate(sp.hasta) ? sp.hasta! : '';

  const [{ data: vData }, { data: asig }] = await Promise.all([
    supabase.from('vendedores').select('supervisor, equipo').eq('nombre', vendedor).single(),
    supabase.from('asignaciones').select('cartera').eq('vendedor_nombre', vendedor).order('fecha_desde', { ascending: false }).limit(1),
  ]);

  const cartera = asig?.[0]?.cartera ?? null;

  return (
    <AppShell>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b]">{vendedor}</h1>
            <p className="text-[13px] text-[#71717a] mt-0.5">
              {vData?.equipo && `Equipo: ${vData.equipo}`}
              {vData?.supervisor && ` · Supervisor: ${vData.supervisor}`}
              {` · ${sel.label}`}
            </p>
          </div>
          <Suspense>
            <FilterBar
              meses={sel.meses} anios={sel.anios}
              mostrarRango desde={desde} hasta={hasta}
            />
          </Suspense>
        </div>

        {desde && hasta && (
          <Suspense fallback={<KpiSkeleton />}>
            <RangoVendido desde={desde} hasta={hasta} vendedor={vendedor} />
          </Suspense>
        )}

        <Suspense fallback={<KpiSkeleton />}>
          <VendedorKpiSection
            vendedor={vendedor}
            cartera={cartera}
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

async function VendedorKpiSection({
  vendedor,
  cartera,
  periodos,
  principal,
  multi,
  todayIso,
}: {
  vendedor:  string;
  cartera:   string | null;
  periodos:  Periodo[];
  principal: Periodo;
  multi:     boolean;
  todayIso:  string;
}) {
  const today = new Date(todayIso);
  // CCC, cobertura y tendencia son mensuales y no se suman: con varios períodos
  // elegidos se muestran los del más reciente.
  const { anio, mes } = principal;
  const labelPrincipal = labelPeriodos([principal]);

  const [kpis, trend, ccc, cobertura, { rows: clientes, cartera3mTotal, cccMesTotal, cccPrevTotal, cccAaTotal }, metasCcc] = await Promise.all([
    fetchVendedorKpisMulti(vendedor, periodos, today),
    fetchTrendData({ vendedor }, anio, mes),
    fetchCCC(vendedor, anio, mes),
    fetchCobertura(vendedor, cartera, anio, mes),
    fetchClientesData(anio, mes, today, undefined, vendedor),
    fetchMetasCcc(anio, mes, undefined, vendedor),
  ]);

  if (kpis.length === 0) return <EmptyMonth mes={mes} anio={anio} />;

  return (
    <div className="space-y-7">
      <KpiTable data={kpis} />
      <ClientesTable
        data={clientes} cartera3mTotal={cartera3mTotal} cccMesTotal={cccMesTotal}
        cccPrevTotal={cccPrevTotal} cccAaTotal={cccAaTotal}
        metaPorRubro={metasCcc.porRubro} metaTotal={metasCcc.total}
        caption={multi ? `Clientes: ${labelPrincipal} (no se suman entre meses)` : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <CccCard data={ccc} />
        <TrendChart data={trend} title={`KG acumulados por día — ${labelPrincipal}`} />
      </div>

      <CoberturaTable data={cobertura} />
    </div>
  );
}
