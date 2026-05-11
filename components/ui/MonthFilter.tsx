'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { Select } from '@/components/ui/Select';

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

interface MonthFilterProps {
  defaultMes: number;
  defaultAnio: number;
}

export function MonthFilter({ defaultMes, defaultAnio }: MonthFilterProps) {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(key, value);
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const currentYear = new Date().getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear];

  return (
    <div className="flex items-center gap-2">
      <Select
        value={defaultMes}
        onChange={(e) => updateParam('mes', e.target.value)}
      >
        {MESES.map((m, i) => (
          <option key={i + 1} value={i + 1}>{m}</option>
        ))}
      </Select>

      <Select
        value={defaultAnio}
        onChange={(e) => updateParam('anio', e.target.value)}
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </Select>
    </div>
  );
}
