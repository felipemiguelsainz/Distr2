'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/Select';

interface SupervisorFilterProps {
  equipos: string[];
  current: string;
  /**
   * Cuando la ruta lleva el equipo en el path (p.ej. /dashboard/consolidado/[nombre]),
   * pasar el prefijo para navegar reemplazando el último segmento. Si se omite, el
   * equipo se setea como query param `equipo` sobre la ruta actual (p.ej. /admin/metas-ccc).
   */
  basePath?: string;
}

export function SupervisorFilter({ equipos, current, basePath }: SupervisorFilterProps) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  function onChange(equipo: string) {
    if (basePath) {
      const qs = searchParams.toString();
      router.push(`${basePath}/${encodeURIComponent(equipo)}${qs ? `?${qs}` : ''}`);
    } else {
      const params = new URLSearchParams(searchParams.toString());
      params.set('equipo', equipo);
      router.push(`${pathname}?${params.toString()}`);
    }
  }

  return (
    <Select value={current} onChange={(e) => onChange(e.target.value)}>
      {equipos.map((eq) => (
        <option key={eq} value={eq}>{eq}</option>
      ))}
    </Select>
  );
}
