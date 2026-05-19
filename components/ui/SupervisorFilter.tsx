'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/Select';

interface SupervisorFilterProps {
  equipos: string[];
  current: string;
}

export function SupervisorFilter({ equipos, current }: SupervisorFilterProps) {
  const router      = useRouter();
  const searchParams = useSearchParams();

  function onChange(equipo: string) {
    const qs = searchParams.toString();
    router.push(`/dashboard/consolidado/${encodeURIComponent(equipo)}${qs ? `?${qs}` : ''}`);
  }

  return (
    <Select value={current} onChange={(e) => onChange(e.target.value)}>
      {equipos.map((eq) => (
        <option key={eq} value={eq}>{eq}</option>
      ))}
    </Select>
  );
}
