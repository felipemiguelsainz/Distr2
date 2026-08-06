'use client';

import { useMemo, useState } from 'react';
import type { PdvGeo } from './types';

// ---------------------------------------------------------------------------
// Listado de los PDVs que están viéndose en el mapa.
//
// Espeja exactamente lo que quedó después de los filtros (vendedor, zona,
// partido, canal, día de visita…): el mapa muestra dónde están y esta tabla
// muestra cuáles son, con búsqueda propia, orden y exportación a Excel.
//
// No pagina de verdad: renderiza de a tandas (RENDER_STEP) para no clavar el
// navegador con 8.000 filas. La exportación siempre lleva TODAS las filas
// filtradas, no sólo las visibles.
// ---------------------------------------------------------------------------

const MONO: React.CSSProperties = { fontFamily: "'JetBrains Mono', monospace" };
const RENDER_STEP = 200;

export type EstadoPdv = { label: string; color: string };

type Campo = 'razon_social' | 'cartera' | 'partido' | 'ultima_vta';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function TH({
  children,
  campo,
  orden,
  onSort,
  className = '',
}: {
  children: React.ReactNode;
  campo?: Campo;
  orden?: { campo: Campo; asc: boolean };
  onSort?: (c: Campo) => void;
  className?: string;
}) {
  const activo = campo && orden?.campo === campo;
  return (
    <th
      className={`px-3 py-2.5 text-left text-[9px] font-semibold uppercase tracking-[0.08em] text-[#71717a] whitespace-nowrap ${className}`}
      style={MONO}
    >
      {campo && onSort ? (
        <button
          onClick={() => onSort(campo)}
          className={`inline-flex items-center gap-1 hover:text-[#09090b] transition-colors ${activo ? 'text-[#0c5cab]' : ''}`}
        >
          {children}
          <span className="text-[8px]">{activo ? (orden!.asc ? '▲' : '▼') : '⇅'}</span>
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export function PdvsTable({
  pdvs,
  total,
  estado,
  onFocus,
  onClose,
}: {
  /** PDVs ya filtrados (los mismos que se ven en el mapa). */
  pdvs:    PdvGeo[];
  /** Total de PDVs cargados, sin filtrar. */
  total:   number;
  estado:  (p: PdvGeo) => EstadoPdv;
  /** Centrar el mapa en un PDV al clickear la fila. */
  onFocus: (p: PdvGeo) => void;
  onClose: () => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden]       = useState<{ campo: Campo; asc: boolean }>({ campo: 'razon_social', asc: true });
  const [aMostrar, setAMostrar] = useState(RENDER_STEP);
  const [exportando, setExportando] = useState(false);

  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q
      ? pdvs.filter((p) =>
          String(p.pdv_id).includes(q) ||
          (p.razon_social ?? '').toLowerCase().includes(q) ||
          (p.cartera      ?? '').toLowerCase().includes(q) ||
          (p.partido      ?? '').toLowerCase().includes(q) ||
          (p.zona         ?? '').toLowerCase().includes(q))
      : pdvs;

    const dir = orden.asc ? 1 : -1;
    return [...base].sort((a, b) => {
      const va = a[orden.campo] ?? '';
      const vb = b[orden.campo] ?? '';
      // Sin fecha de última venta = nunca compró: al fondo en ambos sentidos.
      if (orden.campo === 'ultima_vta') {
        if (!va && !vb) return 0;
        if (!va) return 1;
        if (!vb) return -1;
      }
      return String(va).localeCompare(String(vb), 'es') * dir;
    });
  }, [pdvs, busqueda, orden]);

  // Al cambiar filtros/búsqueda volvemos al tope inicial de filas renderizadas.
  const firma = `${pdvs.length}|${busqueda}`;
  const [firmaPrev, setFirmaPrev] = useState(firma);
  if (firma !== firmaPrev) {
    setFirmaPrev(firma);
    setAMostrar(RENDER_STEP);
  }

  function sort(campo: Campo) {
    setOrden((o) => (o.campo === campo ? { campo, asc: !o.asc } : { campo, asc: true }));
  }

  async function exportar() {
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const data = filas.map((p) => ({
        'ID':            p.pdv_id,
        'Razón social':  p.razon_social ?? '',
        'Vendedor':      p.cartera ?? '',
        'Partido':       p.partido ?? '',
        'Zona':          p.zona ?? '',
        'Canal':         p.canal_venta ?? '',
        'Día de visita': p.dia_visita ?? '',
        'Última venta':  p.ultima_vta ? p.ultima_vta.slice(0, 10) : '',
        'Estado':        estado(p).label,
        'Latitud':       p.latitud,
        'Longitud':      p.longitud,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [
        { wch: 8 }, { wch: 38 }, { wch: 22 }, { wch: 18 }, { wch: 16 },
        { wch: 16 }, { wch: 16 }, { wch: 13 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'PDVs');
      const hoy = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `pdvs-${hoy}.xlsx`);
    } finally {
      setExportando(false);
    }
  }

  const visibles = filas.slice(0, aMostrar);

  return (
    <div className="flex flex-col h-full bg-white lg:rounded-2xl lg:border border-[#e4e4e7] overflow-hidden">
      {/* ── Encabezado ── */}
      <div className="flex-shrink-0 flex items-center gap-2 flex-wrap px-4 py-2.5 border-b border-[#e4e4e7]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={MONO}>
          Listado ·{' '}
          <span className="text-[#09090b]">{filas.length.toLocaleString('es-AR')}</span>
          {filas.length !== total && <> de {total.toLocaleString('es-AR')}</>}
          {' '}PDVs
        </p>

        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar en el listado…"
          className="flex-1 min-w-[140px] max-w-[260px] px-2.5 py-1.5 text-[12.5px] bg-[rgba(0,0,0,0.02)] border border-[#e4e4e7] rounded-[8px] text-[#09090b] caret-[#0c5cab] focus:outline-none focus:border-[rgba(12,92,171,0.4)] transition-all placeholder:text-[#9f9fa9]"
        />

        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={exportar}
            disabled={exportando || filas.length === 0}
            className="px-2.5 py-1.5 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#0c5cab] hover:border-[rgba(12,92,171,0.4)] hover:bg-[rgba(12,92,171,0.04)] transition-colors disabled:opacity-50"
          >
            {exportando ? 'Generando…' : 'Exportar a Excel'}
          </button>
          <button
            onClick={onClose}
            aria-label="Cerrar listado"
            className="px-2.5 py-1.5 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#71717a] hover:text-[#09090b] hover:border-[#d4d4d8] transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="flex-1 min-h-0 overflow-auto [-webkit-overflow-scrolling:touch]">
        {filas.length === 0 ? (
          <p className="py-12 text-center text-[13px] text-[#71717a]">
            Ningún PDV coincide con los filtros.
          </p>
        ) : (
          <table className="w-full text-[12px] min-w-[560px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#f4f4f5] border-b border-[#e4e4e7]">
                <TH className="w-[70px]">ID</TH>
                <TH campo="razon_social" orden={orden} onSort={sort}>Razón social</TH>
                <TH campo="cartera"      orden={orden} onSort={sort}>Vendedor</TH>
                <TH campo="partido"      orden={orden} onSort={sort} className="hidden sm:table-cell">Partido</TH>
                <TH className="hidden lg:table-cell">Zona</TH>
                <TH className="hidden lg:table-cell">Canal</TH>
                <TH className="hidden xl:table-cell">Visita</TH>
                <TH campo="ultima_vta"   orden={orden} onSort={sort} className="hidden sm:table-cell">Última vta</TH>
                <TH>Estado</TH>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e4e4e7]">
              {visibles.map((p) => {
                const est = estado(p);
                return (
                  <tr
                    key={p.pdv_id}
                    onClick={() => onFocus(p)}
                    title="Ver en el mapa"
                    className="cursor-pointer hover:bg-[rgba(12,92,171,0.04)] transition-colors"
                  >
                    <td className="px-3 py-2 text-[11px] text-[#71717a] tabular-nums" style={MONO}>#{p.pdv_id}</td>
                    <td className="px-3 py-2 text-[#09090b] font-medium">
                      {p.razon_social ?? '—'}
                      {p.aproximada && (
                        <span className="ml-1.5 text-[9.5px] text-[#b45309]" title="Ubicación aproximada (centro del barrio)">
                          aprox.
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[#27272a] whitespace-nowrap">{p.cartera ?? '—'}</td>
                    <td className="px-3 py-2 text-[#71717a] whitespace-nowrap hidden sm:table-cell">{p.partido ?? '—'}</td>
                    <td className="px-3 py-2 text-[#71717a] whitespace-nowrap hidden lg:table-cell">{p.zona ?? '—'}</td>
                    <td className="px-3 py-2 text-[#71717a] whitespace-nowrap hidden lg:table-cell">{p.canal_venta ?? '—'}</td>
                    <td className="px-3 py-2 text-[#71717a] whitespace-nowrap hidden xl:table-cell">{p.dia_visita ?? '—'}</td>
                    <td className="px-3 py-2 text-[#71717a] whitespace-nowrap tabular-nums hidden sm:table-cell" style={MONO}>
                      {fmtDate(p.ultima_vta)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: est.color }} />
                        <span className="text-[11px] text-[#27272a]">{est.label}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {filas.length > visibles.length && (
          <div className="p-3 text-center border-t border-[#e4e4e7]">
            <button
              onClick={() => setAMostrar((n) => n + RENDER_STEP * 2)}
              className="px-3 py-1.5 text-[12px] font-medium rounded-[8px] border border-[#e4e4e7] bg-white text-[#0c5cab] hover:border-[rgba(12,92,171,0.4)] transition-colors"
            >
              Mostrar más ({(filas.length - visibles.length).toLocaleString('es-AR')} restantes)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
