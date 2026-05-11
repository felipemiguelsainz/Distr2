import { AppShell } from '@/components/layout/AppShell';
import { MonthFilter } from '@/components/ui/MonthFilter';
import { KpiTable } from '@/components/dashboard/KpiTable';
import { TrendChart } from '@/components/dashboard/TrendChart';
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
import { Suspense } from 'react';
import { KpiSkeleton } from '@/components/ui/Skeleton';

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

  const today = new Date();
  const mes = parseInt(sp.mes ?? String(today.getMonth() + 1), 10);
  const anio = parseInt(sp.anio ?? String(today.getFullYear()), 10);

  const supabase = await createClient();
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
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#f0f4ff]">{vendedor}</h1>
            <p className="text-[13px] text-[#6b85a8] mt-0.5">
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
  const [kpis, trend, ccc, cobertura, clientes] = await Promise.all([
    fetchVendedorKpis(vendedor, anio, mes, today),
    fetchTrendData({ vendedor }, anio, mes),
    fetchCCC(vendedor, anio, mes),
    fetchCobertura(vendedor, cartera, anio, mes),
    fetchClientesData(anio, mes, today, undefined, vendedor),
  ]);

  return (
    <div className="space-y-7">
      <KpiTable data={kpis} />
      <ClientesTable data={clientes} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <CccCard data={ccc} />
        <TrendChart data={trend} title="KG acumulados por día" />
      </div>

      <CoberturaTable data={cobertura} />
    </div>
  );
}
