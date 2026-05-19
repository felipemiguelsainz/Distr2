import { AppShell } from '@/components/layout/AppShell';
import { MonthFilter } from '@/components/ui/MonthFilter';
import { KpiTable } from '@/components/dashboard/KpiTable';
import { TrendChart } from '@/components/dashboard/TrendChart';
import { CoberturaTable } from '@/components/dashboard/CoberturaTable';
import { ClientesTable } from '@/components/dashboard/ClientesTable';
import { fetchSupervisorKpis, fetchTrendData, fetchClientesData } from '@/lib/calculations/queries';
import { createClient } from '@/lib/supabase/server';
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

  // Fetch equipo for this supervisor
  const supabase = await createClient();
  const { data: vendedorData } = await supabase
    .from('vendedores')
    .select('equipo, supervisor')
    .eq('nombre', vendedorNombre)
    .single();

  const equipo = vendedorData?.equipo ?? '';

  return (
    <AppShell>
      <div className="space-y-7">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#f0f4ff]">{vendedorNombre}</h1>
            <p className="text-[13px] text-[#6b85a8] mt-0.5">Equipo: {equipo}</p>
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
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8] mb-3" style={{fontFamily: "'JetBrains Mono', monospace"}}>Totales del equipo</p>
        <KpiTable data={totales} />
      </section>

      <ClientesTable data={clientes} cartera3mTotal={cartera3mTotal} cccMesTotal={cccMesTotal} cccPrevTotal={cccPrevTotal} cccAaTotal={cccAaTotal} />

      <TrendChart data={trend} title="Tendencia KG diaria — Equipo" />

      <section>
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8] mb-3" style={{fontFamily: "'JetBrains Mono', monospace"}}>Por vendedor</p>
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
    const meta = rows.reduce((s, r) => s + r.meta, 0);
    const acumulado = rows.reduce((s, r) => s + r.acumulado, 0);
    const avance_pct = meta > 0 ? (acumulado / meta) * 100 : 0;
    const tendencia = rows.some(r => r.tendencia !== null)
      ? rows.reduce((s, r) => s + (r.tendencia ?? 0), 0)
      : null;
    return { v, meta, acumulado, avance_pct, tendencia };
  });

  return (
    <div className="overflow-x-auto rounded-2xl border border-[#1a2d4a] shadow-xl shadow-black/30">
      <table className="min-w-full text-[13px]">
        <thead>
          <tr className="bg-[#0f1e38]/80 border-b border-[#1a2d4a]">
            <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Vendedor</th>
            <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Meta KG</th>
            <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Acumulado</th>
            <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Avance %</th>
            <th className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Tendencia</th>
          </tr>
        </thead>
        <tbody className="bg-[#0b1528] divide-y divide-[#1a2d4a]">
          {summary.map(({ v, meta, acumulado, avance_pct, tendencia }) => (
            <tr key={v} className="hover:bg-[rgba(59,130,246,0.04)] transition-colors">
              <td className="px-4 py-2.5 font-medium text-[#3b82f6]">
                <a href={`/dashboard/vendedor/${encodeURIComponent(v)}`}>{v}</a>
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[#c8d8f0]">{formatKg(meta)}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[#c8d8f0]">{formatKg(acumulado)}</td>
              <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${avanceColor(avance_pct)} rounded-lg`}>
                {formatPctPlain(avance_pct)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-[#6b85a8]">
                {tendencia !== null ? formatKg(tendencia) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
