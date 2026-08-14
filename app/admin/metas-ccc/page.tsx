import { FilterBar } from '@/components/ui/FilterBar';
import { resolverPeriodos } from '@/lib/periodos';
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
  // Las metas se cargan de a un período: acá el filtro es de selección única.
  const sel  = resolverPeriodos(sp, today);
  const mes  = sel.principal.mes;
  const anio = sel.principal.anio;

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
          <Suspense>
            <FilterBar
              meses={[mes]}
              anios={[anio]}
              periodoUnico
              equipos={profile.rol === 'admin' && equipos.length > 0 ? equipos : undefined}
              equipoActual={equipo}
            />
          </Suspense>
        </div>

        {/* Qué es y para qué sirve.

            Va en un <details> nativo y colapsado: son 15 líneas de prosa que en
            un teléfono ocupaban la pantalla entera y dejaban la tabla —que es la
            herramienta— abajo del pliegue. Es material de referencia que se lee
            una vez, no cada vez que entrás a cargar metas. Nativo y no un
            componente propio: trae el toggle, el foco y el rol ARIA gratis. */}
        <details className="group rounded-2xl border border-[rgba(12,92,171,0.2)] bg-[rgba(12,92,171,0.04)] px-5 py-4 text-[13px] text-[#27272a]">
          <summary className="flex items-center gap-2 cursor-pointer list-none font-semibold text-[#0c5cab] [&::-webkit-details-marker]:hidden">
            <svg
              className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open:rotate-90"
              viewBox="0 0 12 12" fill="none" aria-hidden="true"
            >
              <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            ¿Qué son las Metas CCC?
          </summary>
          <p className="mb-2 mt-2.5">
            <strong>CCC = Clientes que Compraron.</strong> La meta CCC es la <strong>cantidad de clientes (PDVs)</strong> que
            querés que le compren a cada vendedor en el mes: una <strong>meta total</strong> (cuántos de sus clientes deberían
            comprar algo) y, derivada de ella, una meta <strong>por rubro</strong> (cuántos deberían comprar chocolates,
            galletitas, etc.). Es una meta de <em>cobertura</em> —cuántos clientes—, distinta de la meta de kilos/$.
          </p>
          <ul className="space-y-1 text-[#52525b] list-disc pl-5">
            <li>Se <strong>prellenan solas</strong> según la penetración histórica de cada vendedor y se recalculan al recargar el maestro de PDVs (badge <span className="text-[#71717a] font-semibold">auto</span>).</li>
            <li>Editás sólo la <strong>meta total</strong>; las de rubro se recalculan por cascadeo (badge <span className="text-[#0c5cab] font-semibold">editada</span> cuando la tocaste).</li>
            <li>El <strong>avance</strong> (clientes que efectivamente compraron vs la meta) se ve en el dashboard, en la tabla de clientes.</li>
          </ul>
        </details>

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
          /* El `key` fuerza el remonte al cambiar de período o equipo. El
             componente guarda las metas tipeadas en estado y, sin esto, React
             reusa la instancia: se seguirían viendo —y se podrían guardar— las
             metas del período anterior sobre el nuevo. */
          <MetasCccClient
            key={`${equipo}|${anio}-${mes}`}
            mes={mes} anio={anio} rubros={rubros} filas={filas}
          />
        )}
    </div>
  );
}
