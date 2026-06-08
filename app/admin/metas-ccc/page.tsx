import { MonthFilter } from '@/components/ui/MonthFilter';
import { SupervisorFilter } from '@/components/ui/SupervisorFilter';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { MetasCccClient, type VendedorMetas } from './MetasCccClient';

interface SearchParams { mes?: string; anio?: string; equipo?: string }

export default async function SupervisorMetasPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre, equipo')
    .eq('id', user.id)
    .single();
  if (!profile || (profile.rol !== 'supervisor' && profile.rol !== 'admin')) redirect('/');

  const svc = createServiceClient();
  const today = new Date();
  const mes = parseInt(sp.mes ?? String(today.getMonth() + 1), 10);
  const anio = parseInt(sp.anio ?? String(today.getFullYear()), 10);

  // Determinar equipo y (para admin) la lista de equipos.
  let equipo = '';
  let equipos: string[] = [];

  if (profile.rol === 'supervisor') {
    equipo = profile.equipo ?? '';
    if (!equipo && profile.vendedor_nombre) {
      const { data: me } = await svc
        .from('vendedores').select('equipo').eq('nombre', profile.vendedor_nombre).single();
      equipo = me?.equipo ?? '';
    }
  } else {
    // admin: selector de equipos
    const { data: vRows } = await svc
      .from('vendedores').select('equipo').eq('activo', true).not('equipo', 'is', null);
    equipos = Array.from(new Set(
      (vRows ?? []).map((v) => (v.equipo as string | null)?.trim())
        .filter((e): e is string => !!e && e !== 'SIN SUPERVISOR'),
    )).sort((a, b) => a.localeCompare(b));
    equipo = sp.equipo ?? equipos[0] ?? '';
  }

  // Vendedores activos del equipo
  const { data: vends } = await svc
    .from('vendedores').select('nombre').eq('equipo', equipo).eq('activo', true).order('nombre');
  const vendedores = (vends ?? []).map((v) => v.nombre as string);

  // Metas CCC del período para esos vendedores
  const { data: metas } = vendedores.length > 0
    ? await svc
        .from('metas_ccc')
        .select('vendedor, rubro, meta_pdvs, es_preset')
        .eq('mes', mes).eq('anio', anio)
        .in('vendedor', vendedores)
    : { data: [] as { vendedor: string; rubro: string | null; meta_pdvs: number; es_preset: boolean }[] };

  // Armar columnas (rubros) y filas por vendedor
  const rubros = Array.from(new Set(
    (metas ?? []).map((m) => m.rubro).filter((r): r is string => !!r),
  )).sort((a, b) => a.localeCompare(b));

  const byVend = new Map<string, VendedorMetas>();
  for (const v of vendedores) {
    byVend.set(v, { vendedor: v, total: null, totalPreset: true, rubros: {} });
  }
  for (const m of metas ?? []) {
    const row = byVend.get(m.vendedor);
    if (!row) continue;
    if (m.rubro === null) {
      row.total = m.meta_pdvs;
      row.totalPreset = m.es_preset;
    } else {
      row.rubros[m.rubro] = m.meta_pdvs;
    }
  }
  const filas = [...byVend.values()];

  return (
    <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Metas CCC
            </p>
            <h1 className="text-[22px] font-bold tracking-[-0.02em] text-[#09090b] mt-0.5">{equipo || '—'}</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {profile.rol === 'admin' && equipos.length > 0 && (
              <Suspense><SupervisorFilter equipos={equipos} current={equipo} /></Suspense>
            )}
            <Suspense><MonthFilter defaultMes={mes} defaultAnio={anio} /></Suspense>
          </div>
        </div>

        {filas.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#e4e4e7] py-14 text-center text-[14px] text-[#71717a]">
            No hay vendedores activos en este equipo.
          </div>
        ) : rubros.length === 0 && filas.every((f) => f.total === null) ? (
          <div className="rounded-2xl border border-dashed border-[#e4e4e7] py-14 text-center text-[14px] text-[#71717a]">
            Todavía no hay metas CCC calculadas para este período.<br />
            Se generan automáticamente al recargar el maestro de PDVs.
          </div>
        ) : (
          <MetasCccClient mes={mes} anio={anio} rubros={rubros} filas={filas} />
        )}
    </div>
  );
}
