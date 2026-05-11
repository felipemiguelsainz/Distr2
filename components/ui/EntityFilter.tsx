'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Select } from '@/components/ui/Select';

interface EntityFilterProps {
  supervisores: string[];
  vendedores: { nombre: string; equipo: string | null }[];
}

export function EntityFilter({ supervisores, vendedores }: EntityFilterProps) {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  const [supervisor, setSupervisor] = useState(searchParams.get('supervisor') ?? '');
  const [vendedor,   setVendedor]   = useState(searchParams.get('vendedor')   ?? '');

  // Cuando cambia el supervisor, limpiar el vendedor si ya no pertenece a ese equipo
  useEffect(() => {
    if (supervisor && vendedor) {
      const v = vendedores.find(v => v.nombre === vendedor);
      if (v && v.equipo !== supervisor) setVendedor('');
    }
  }, [supervisor, vendedor, vendedores]);

  const push = useCallback((sup: string, vnd: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (sup) params.set('supervisor', sup); else params.delete('supervisor');
    if (vnd) params.set('vendedor', vnd);   else params.delete('vendedor');
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams]);

  function handleSupervisor(val: string) {
    setSupervisor(val);
    setVendedor('');
    push(val, '');
  }

  function handleVendedor(val: string) {
    setVendedor(val);
    push(supervisor, val);
  }

  const vendedoresFiltrados = supervisor
    ? vendedores.filter(v => v.equipo === supervisor)
    : vendedores;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Supervisor */}
      <Select value={supervisor} onChange={e => handleSupervisor(e.target.value)}>
        <option value="">Todos los supervisores</option>
        {supervisores.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </Select>

      {/* Vendedor */}
      <Select value={vendedor} onChange={e => handleVendedor(e.target.value)}>
        <option value="">Todos los vendedores</option>
        {vendedoresFiltrados.map(v => (
          <option key={v.nombre} value={v.nombre}>{v.nombre}</option>
        ))}
      </Select>
    </div>
  );
}
