'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Select } from '@/components/ui/Select';

interface VendedorFilterProps {
  vendedores: string[];
  current:    string;
}

// Filtro in-place por vendedor (escribe ?vendedor= en la URL preservando el
// resto de params). Usado por el supervisor para acotar la vista de su equipo
// a un solo vendedor, igual que el admin pero limitado a su equipo.
export function VendedorFilter({ vendedores, current }: VendedorFilterProps) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  function onChange(vendedor: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (vendedor) params.set('vendedor', vendedor);
    else          params.delete('vendedor');
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ''}`);
  }

  return (
    <Select value={current} onChange={(e) => onChange(e.target.value)}>
      <option value="">Todos los vendedores</option>
      {vendedores.map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </Select>
  );
}
