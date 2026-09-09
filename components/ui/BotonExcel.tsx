'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import type { ColExcel, FilaExcel } from '@/lib/excel/exportar';

/**
 * Botón de "bajar esta tabla a Excel".
 *
 * Recibe las filas YA filtradas —las mismas que se están dibujando— así que lo
 * que sale es exactamente lo que se ve. Como las columnas se declaran con datos
 * (sin funciones), también se puede usar desde un Server Component.
 */
export function BotonExcel({
  archivo,
  hoja,
  cols,
  filas,
  className = '',
}: {
  /** Base del nombre del archivo; los filtros de la URL se agregan solos. */
  archivo: string;
  /** Nombre de la hoja dentro del libro. */
  hoja:    string;
  cols:    ColExcel[];
  filas:   FilaExcel[];
  className?: string;
}) {
  const [ocupado, setOcupado] = useState(false);

  async function bajar() {
    setOcupado(true);
    try {
      const { exportarExcel } = await import('@/lib/excel/exportar');
      await exportarExcel(archivo, hoja, cols, filas);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <button
      type="button"
      onClick={bajar}
      disabled={ocupado || filas.length === 0}
      title={filas.length === 0 ? 'Sin datos para exportar' : 'Exportar a Excel'}
      className={`inline-flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 text-[11.5px] font-semibold rounded-[8px] border border-[#e4e4e7] bg-white text-[#0c5cab] hover:border-[rgba(12,92,171,0.4)] hover:bg-[rgba(12,92,171,0.05)] disabled:opacity-40 disabled:hover:bg-white transition-colors ${className}`}
    >
      <Download className="w-3.5 h-3.5" />
      {ocupado ? 'Generando…' : 'Excel'}
    </button>
  );
}
