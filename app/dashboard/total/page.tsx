import { AppShell } from '@/components/layout/AppShell';
import { MonthFilter } from '@/components/ui/MonthFilter';
import { RangeFilter } from '@/components/ui/RangeFilter';
import { EntityFilter } from '@/components/ui/EntityFilter';
import { KpiTable } from '@/components/dashboard/KpiTable';
import { RangoVendido } from '@/components/dashboard/RangoVendido';
import { TrendChart, AvanceBarChart, RadarMetaChart } from '@/components/dashboard/LazyCharts';
import { ClientesTable } from '@/components/dashboard/ClientesTable';
import { fetchTotalKpis, fetchTrendData, fetchClientesData, fetchMetasCcc } from '@/lib/calculations/queries';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { KpiSkeleton } from '@/components/ui/Skeleton';
import { EmptyMonth } from '@/components/ui/EmptyMonth';

interface SearchParams {
  mes?:        string;
  anio?:       string;
  supervisor?: string;
  vendedor?:   string;
  desde?:      string;
  hasta?:      string;
}

const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export default async function TotalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const today  = new Date();
  const mes    = parseInt(params.mes  ?? String(today.getMonth() + 1), 10);
  const anio   = parseInt(params.anio ?? String(today.getFullYear()),  10);
  const supervisor = params.supervisor ?? '';
  const vendedor   = params.vendedor   ?? '';
  const desde = isDate(params.desde) ? params.desde! : '';
  const hasta = isDate(params.hasta) ? params.hasta! : '';

  // Listas para los dropdowns
  const supabase = await createClient();

  // Guard de rol propio (defensa en profundidad; no depender sólo del middleware):
  // esta página expone datos de TODA la empresa vía service client (bypass RLS).
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: prof } = await supabase.from('profiles').select('rol').eq('id', user.id).single();
  if (prof?.rol !== 'admin') redirect('/');

  const { data: vData } = await supabase
    .from('vendedores')
    .select('nombre, equipo')
    .eq('activo', true)
    .order('nombre');

  const vendedores   = vData ?? [];
  const supervisores = [...new Set(vendedores.map(v => v.equipo).filter(Boolean) as string[])].sort();

  // Subtítulo dinámico
  const subtitulo = vendedor
    ? vendedor
    : supervisor
      ? `Supervisor: ${supervisor}`
      : 'Todos los rubros y equipos';

  return (
    <AppShell>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b]">Total Empresa</h1>
            <p className="text-[13px] text-[#71717a] mt-0.5">{subtitulo}</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
            <Suspense>
              <EntityFilter supervisores={supervisores} vendedores={vendedores} />
            </Suspense>
            <Suspense>
              <MonthFilter defaultMes={mes} defaultAnio={anio} />
            </Suspense>
            <Suspense>
              <RangeFilter desde={desde} hasta={hasta} />
            </Suspense>
          </div>
        </div>

        {desde && hasta && (
          <Suspense fallback={<KpiSkeleton />}>
            <RangoVendido desde={desde} hasta={hasta} equipo={supervisor || undefined} vendedor={vendedor || undefined} />
          </Suspense>
        )}

        <Suspense fallback={<KpiSkeleton />}>
          <TotalKpiSection
            mes={mes} anio={anio} todayIso={today.toISOString()}
            supervisor={supervisor} vendedor={vendedor}
          />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function TotalKpiSection({
  mes, anio, todayIso, supervisor, vendedor,
}: {
  mes:        number;
  anio:       number;
  todayIso:   string;
  supervisor: string;
  vendedor:   string;
}) {
  const today  = new Date(todayIso);
  const equipo = supervisor || undefined;
  const vnd    = vendedor   || undefined;

  const [kpis, trend, { rows: clientes, cartera3mTotal, cccMesTotal, cccPrevTotal, cccAaTotal }, metasCcc] = await Promise.all([
    fetchTotalKpis(anio, mes, today, equipo, vnd),
    fetchTrendData({ equipo, vendedor: vnd }, anio, mes),
    fetchClientesData(anio, mes, today, equipo, vnd),
    fetchMetasCcc(anio, mes, equipo, vnd),
  ]);

  const metaTotal = kpis.reduce((s, k) => s + (k.meta ?? 0), 0);

  if (kpis.length === 0) return <EmptyMonth mes={mes} anio={anio} />;

  return (
    <div className="space-y-7">
      <KpiTable data={kpis} />
      <ClientesTable data={clientes} cartera3mTotal={cartera3mTotal} cccMesTotal={cccMesTotal} cccPrevTotal={cccPrevTotal} cccAaTotal={cccAaTotal} metaPorRubro={metasCcc.porRubro} metaTotal={metasCcc.total} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AvanceBarChart data={kpis} title="Proyección vs Meta por Rubro" />
        <div className="flex flex-col gap-5">
          <TrendChart data={trend} title="Tendencia KG acumulada" meta={metaTotal} />
          <RadarMetaChart data={kpis} title="Cumplimiento vs Meta · Por Rubro" />
        </div>
      </div>
    </div>
  );
}
