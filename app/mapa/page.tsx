import { AppShell } from '@/components/layout/AppShell';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { MapaClientWrapper } from './MapaClientWrapper';

export interface PdvGeo {
  pdv_id: number;
  latitud: number;
  longitud: number;
  partido: string | null;
  provincia: string | null;
  ruteable: boolean | null;
  razon_social: string | null;
  cartera: string | null;
  canal_venta: string | null;
  zona: string | null;
  localidad: string | null;
  ultima_vta: string | null;
  activo_3m: boolean;
  dia_visita: string | null;
}

export default async function MapaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('rol, vendedor_nombre')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');

  const svc = createServiceClient();

  // Active clients from ventas (last 3 months) — source of truth
  const cutoff3m = new Date();
  cutoff3m.setMonth(cutoff3m.getMonth() - 3);
  const desde3m = cutoff3m.toISOString().slice(0, 10);
  const { data: activosData } = await svc.rpc('pdvs_activos_ids', { p_desde: desde3m });
  const activos3mSet = new Set<number>((activosData as number[] | null) ?? []);

  // Load all geo points — paginate to bypass PostgREST row limit
  const PAGE = 1000;
  let page = 0;
  type RawGeoRow = {
    pdv_id: number;
    latitud: number;
    longitud: number;
    partido: string | null;
    provincia: string | null;
    ruteable: boolean | null;
    pdvs: Record<string, unknown> | null;
  };
  let rawGeo: RawGeoRow[] = [];
  while (true) {
    const { data: rawGeoPage } = await svc
      .from('pdvs_geo')
      .select(
        'pdv_id, latitud, longitud, partido, provincia, ruteable, pdvs ( razon_social, cartera, canal_venta, zona, localidad, ultima_vta, activo, dia_visita )'
      )
      .not('latitud', 'is', null)
      .not('longitud', 'is', null)
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (!rawGeoPage || rawGeoPage.length === 0) break;
    rawGeo = rawGeo.concat(rawGeoPage as unknown as RawGeoRow[]);
    if (rawGeoPage.length < PAGE) break;
    page++;
  }

  // Flatten nested join result, keep only active PDVs
  let puntos: PdvGeo[] = (rawGeo ?? [])
    .filter((r) => {
      const pdv = r.pdvs as Record<string, unknown> | null;
      return pdv?.activo === true;
    })
    .map((r) => {
      const pdv = r.pdvs as Record<string, unknown>;
      return {
        pdv_id:      r.pdv_id,
        latitud:     Number(r.latitud),
        longitud:    Number(r.longitud),
        partido:     r.partido,
        provincia:   r.provincia,
        ruteable:    r.ruteable,
        razon_social: (pdv?.razon_social as string) ?? null,
        cartera:     (pdv?.cartera as string) ?? null,
        canal_venta: (pdv?.canal_venta as string) ?? null,
        zona:        (pdv?.zona as string) ?? null,
        localidad:   (pdv?.localidad as string) ?? null,
        ultima_vta:  (pdv?.ultima_vta as string) ?? null,
        activo_3m:   activos3mSet.has(r.pdv_id),
        dia_visita:  (pdv?.dia_visita as string) ?? null,
      };
    });

  // Role-based filtering (applied server-side)
  if (profile.rol === 'vendedor' && profile.vendedor_nombre) {
    puntos = puntos.filter((p) => p.cartera === profile.vendedor_nombre);
  } else if (profile.rol === 'supervisor' && profile.vendedor_nombre) {
    const { data: vData } = await svc
      .from('vendedores')
      .select('equipo')
      .eq('nombre', profile.vendedor_nombre)
      .single();

    if (vData?.equipo) {
      const { data: equipoVends } = await svc
        .from('vendedores')
        .select('nombre')
        .eq('equipo', vData.equipo)
        .eq('activo', true);
      const nombres = new Set((equipoVends ?? []).map((v: { nombre: string }) => v.nombre));
      puntos = puntos.filter((p) => p.cartera != null && nombres.has(p.cartera));
    }
  }

  return (
    <AppShell>
      {/* Negative margin to escape AppShell's px-6 py-8 wrapper and fill viewport */}
      <div className="-mx-6 -my-8" style={{ height: 'calc(100vh - 0px)' }}>
        <MapaClientWrapper puntos={puntos} />
      </div>
    </AppShell>
  );
}
