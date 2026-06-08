import { AppShell } from '@/components/layout/AppShell';
import { MonthFilter } from '@/components/ui/MonthFilter';
import { KpiTable } from '@/components/dashboard/KpiTable';
import { TrendChart } from '@/components/dashboard/LazyCharts';
import { CoberturaTable } from '@/components/dashboard/CoberturaTable';
import { ClientesTable } from '@/components/dashboard/ClientesTable';
import { fetchSupervisorKpis, fetchTrendData, fetchClientesData } from '@/lib/calculations/queries';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { KpiSkeleton } from '@/components/ui/Skeleton';
import { EmptyMonth } from '@/components/ui/EmptyMonth';
import { KpiVendedor } from '@/lib/types';
import { avanceColor, formatKg, formatPctPlain } from '@/lib/calculations/dashboard';

interface PageParams {
  nombre: string;
}
interface SearchParams {
  mes?: string;
  anio?: string;
}

export default async function SupervisorDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<PageParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { nombre } = await params;
  const sp = await searchParams;
  const vendedorNombre = decodeURIComponent(nombre);

  const today = new Date();
  const mes = parseInt(sp.mes ?? String(today.getMonth() + 1), 10);
  const anio = parseInt(sp.anio ?? String(today.getFullYear()), 10);

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

  // Vendedores: no access to team views
  if (profile.rol === 'vendedor') {
    redirect(`/dashboard/vendedor/${encodeURIComponent(profile.vendedor_nombre ?? '')}`);
  }

  // Fetch equipo for this supervisor
  const { data: vendedorData } = await supabase
    .from('vendedores')
    .select('equipo, supervisor')
    .eq('nombre', vendedorNombre)
    .single();

  // Supervisor puro: no tiene fila en vendedores; el equipo es el propio
  // segmento de la URL (que para supervisores es el nombre del equipo).
  const equipo = vendedorData?.equipo ?? vendedorNombre;

  // Supervisors can only see their own equipo
  if (profile.rol === 'supervisor') {
    let myEquipo = profile.equipo ?? '';
    if (!myEquipo) {
      const { data: me } = await supabase
        .from('vendedores')
        .select('equipo')
        .eq('nombre', profile.vendedor_nombre ?? '')
        .single();
      myEquipo = me?.equipo ?? '';
    }
    if (myEquipo !== equipo) {
      redirect(`/dashboard/supervisor/${encodeURIComponent(myEquipo)}`);
    }
  }

  return (
    <AppShell>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b]">{vendedorNombre}</h1>
            <p className="text-[13px] text-[#71717a] mt-0.5">Equipo: {equipo}</p>
          </div>
          <Suspense>
            <MonthFilter defaultMes={mes} defaultAnio={anio} />
          </Suspense>
        </div>

        <Suspense fallback={<KpiSkeleton />}>
          <SupervisorKpiSection equipo={equipo} mes={mes} anio={anio} todayIso={today.toISOString()} />
        </Suspense>
      </div>
    </AppShell>
  );
}

async function SupervisorKpiSection({
  equipo,
  mes,
  anio,
  todayIso,
}: {
  equipo: string;
  mes: number;
  anio: number;
  todayIso: string;
}) {
  const today = new Date(todayIso);
  const [{ totales, porVendedor }, trend, { rows: clientes, cartera3mTotal, cccMesTotal, cccPrevTotal, cccAaTotal }] = await Promise.all([
    fetchSupervisorKpis(equipo, anio, mes, today),
    fetchTrendData({ equipo }, anio, mes),
    fetchClientesData(anio, mes, today, equipo),
  ]);

  if (totales.length === 0) return <EmptyMonth mes={mes} anio={anio} />;

  // Group porVendedor by vendedor for the table below
  const vendedores = [...new Set(porVendedor.map((k) => k.vendedor))];

  return (
    <div className="space-y-8">
      <section>
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a] mb-3" style={{fontFamily: "'JetBrains Mono', monospace"}}>Totales del equipo</p>
        <KpiTable data={totales} />
      </section>

      <ClientesTable data={clientes} cartera3mTotal={cartera3mTotal} cccMesTotal={cccMesTotal} cccPrevTotal={cccPrevTotal} cccAaTotal={cccAaTotal} />

      <TrendChart data={trend} title="Tendencia KG diaria — Equipo" />

      <section>
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a] mb-3" style={{fontFamily: "'JetBrains Mono', monospace"}}>Por vendedor</p>
        <VendedorSummaryTable porVendedor={porVendedor} vendedores={vendedores} />
      </section>
    </div>
  );
}

function VendedorSummaryTable({
  porVendedor,
  vendedores,
}: {
  porVendedor: KpiVendedor[];
  vendedores: string[];
}) {
  if (vendedores.length === 0) {
    return <p className="text-sm text-gray-500">Sin datos para el período.</p>;
  }

  // Consolidate: one row per vendedor (sum across rubros for key metrics)
  const summary = vendedores.map((v) => {
    const rows = porVendedor.filter((k) => k.vendedor === v);
    const meta = rows.reduce((s, r) => s + (r.meta ?? 0), 0);
    const acumulado = rows.reduce((s, r) => s + r.acumulado, 0);
    const avance_pct = meta > 0 ? (acumulado / meta) * 100 : 0;
    const tendencia = rows.some(r => r.tendencia !== null)
      ? rows.reduce((s, r) => s + (r.tendencia ?? 0), 0)
      : null;
    return { v, meta, acumulado, avance_pct, tendencia };
  });

  return (
    <div className="overflow-x-auto rounded-2xl border border-[#e4e4e7] shadow-xl shadow-black/5">
      <table className="min-w-full text-[13px]">
        <thead>
          <tr className="bg-[#f4f4f5]/80 border-b border-[#e4e4e7]">
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Vendedor</th>
            <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Meta KG</th>
            <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Acumulado</th>
            <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Avance %</th>
            <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Tendencia</th>
          </tr>
        </thead>
        <tbody className="bg-[#ffffff] divide-y divide-[#e4e4e7]">
          {summary.map(({ v, meta, acumulado, avance_pct, tendencia }) => (
            <tr key={v} className="hover:bg-[rgba(12,92,171,0.04)] transition-colors">
              <td className="px-4 py-2.5 font-medium text-[#0c5cab]">
                <a href={`/dashboard/vendedor/${encodeURIComponent(v)}`}>{v}</a>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[#27272a]">{formatKg(meta)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[#27272a]">{formatKg(acumulado)}</td>
              <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${avanceColor(avance_pct)} rounded-lg`}>
                {formatPctPlain(avance_pct)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[#71717a]">
                {tendencia !== null ? formatKg(tendencia) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
