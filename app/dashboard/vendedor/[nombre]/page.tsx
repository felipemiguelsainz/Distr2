import { AppShell } from '@/components/layout/AppShell';
import { MonthFilter } from '@/components/ui/MonthFilter';
import { KpiTable } from '@/components/dashboard/KpiTable';
import { TrendChart } from '@/components/dashboard/LazyCharts';
import { CccCard } from '@/components/dashboard/CccCard';
import { CoberturaTable } from '@/components/dashboard/CoberturaTable';
import { ClientesTable } from '@/components/dashboard/ClientesTable';
import {
  fetchVendedorKpis,
  fetchTrendData,
  fetchCCC,
  fetchCobertura,
  fetchClientesData,
} from '@/lib/calculations/queries';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { KpiSkeleton } from '@/components/ui/Skeleton';
import { EmptyMonth } from '@/components/ui/EmptyMonth';

interface PageParams { nombre: string }
interface SearchParams { mes?: string; anio?: string }

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
    .select('rol, vendedor_nombre')
    .eq('id', user.id)
    .single();

  if (!profile) redirect('/login');

  // Vendedores can only see their own dashboard
  if (profile.rol === 'vendedor' && profile.vendedor_nombre !== vendedor) {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre ?? '')}`);
  }

  // Supervisors can only see vendedores from their equipo
  if (profile.rol === 'supervisor') {
    const { data: supervisorVendedor } = await supabase
      .from('vendedores')
      .select('equipo')
      .eq('nombre', profile.vendedor_nombre ?? '')
      .single();
    const { data: targetVendedor } = await supabase
      .from('vendedores')
      .select('equipo')
      .eq('nombre', vendedor)
      .single();
    if (supervisorVendedor?.equipo !== targetVendedor?.equipo) redirect('/');
  }

  const today = new Date();
  const mes = parseInt(sp.mes ?? String(today.getMonth() + 1), 10);
  const anio = parseInt(sp.anio ?? String(today.getFullYear()), 10);

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
            </p>
          </div>
          <Suspense>
            <MonthFilter defaultMes={mes} defaultAnio={anio} />
          </Suspense>
        </div>

        <Suspense fallback={<KpiSkeleton />}>
          <VendedorKpiSection
            vendedor={vendedor}
            cartera={cartera}
            mes={mes}
            anio={anio}
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
  mes,
  anio,
  todayIso,
}: {
  vendedor: string;
  cartera: string | null;
  mes: number;
  anio: number;
  todayIso: string;
}) {
  const today = new Date(todayIso);
  const [kpis, trend, ccc, cobertura, { rows: clientes, cartera3mTotal, cccMesTotal, cccPrevTotal, cccAaTotal }] = await Promise.all([
    fetchVendedorKpis(vendedor, anio, mes, today),
    fetchTrendData({ vendedor }, anio, mes),
    fetchCCC(vendedor, anio, mes),
    fetchCobertura(vendedor, cartera, anio, mes),
    fetchClientesData(anio, mes, today, undefined, vendedor),
  ]);

  if (kpis.length === 0) return <EmptyMonth mes={mes} anio={anio} />;

  return (
    <div className="space-y-7">
      <KpiTable data={kpis} />
      <ClientesTable data={clientes} cartera3mTotal={cartera3mTotal} cccMesTotal={cccMesTotal} cccPrevTotal={cccPrevTotal} cccAaTotal={cccAaTotal} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <CccCard data={ccc} />
        <TrendChart data={trend} title="KG acumulados por día" />
      </div>

      <CoberturaTable data={cobertura} />
    </div>
  );
}
