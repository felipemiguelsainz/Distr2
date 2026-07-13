'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import { CalendarRange, X } from 'lucide-react';

// Filtro ADITIVO de rango de fechas (desde–hasta). Escribe los params `desde` y
// `hasta` en la URL sin tocar el resto (mes, vendedor, etc.). Cuando ambos están
// seteados, la página muestra el panel "Vendido en el rango". Convive con el
// selector de mes: no lo reemplaza.
export function RangeFilter({ desde, hasta }: { desde: string; hasta: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) params.set(k, v);
        else params.delete(k);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const inputCls =
    'px-2 py-[7px] text-[13px] bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[8px] text-[#09090b] focus:outline-none focus:border-[rgba(12,92,171,0.4)] transition-all';

  return (
    <div className="flex items-center gap-1.5" title="Ver lo vendido entre dos fechas">
      <CalendarRange className="w-4 h-4 text-[#71717a] shrink-0" />
      <input
        type="date"
        value={desde}
        max={hasta || undefined}
        onChange={(e) => setParams({ desde: e.target.value })}
        className={inputCls}
        aria-label="Fecha desde"
      />
      <span className="text-[#71717a] text-[13px]">→</span>
      <input
        type="date"
        value={hasta}
        min={desde || undefined}
        onChange={(e) => setParams({ hasta: e.target.value })}
        className={inputCls}
        aria-label="Fecha hasta"
      />
      {(desde || hasta) && (
        <button
          onClick={() => setParams({ desde: null, hasta: null })}
          title="Limpiar rango"
          aria-label="Limpiar rango"
          className="p-1 text-[#a1a1aa] hover:text-[#dc2626] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
