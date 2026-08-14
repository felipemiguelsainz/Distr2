'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Desplegable de una sola opción con el mismo lenguaje visual que los filtros
 * del mapa (píldora + panel flotante), en vez del <select> nativo, que en
 * Windows se dibuja con el chrome del sistema y desentona con el resto.
 *
 * Se busca cuando hay muchas opciones: la lista de localidades pasa de 30.
 */
export function Dropdown({
  valor,
  opciones,
  onChange,
  placeholder,
  etiquetaTodas,
  buscable = false,
}: {
  valor: string;
  opciones: { valor: string; label: string; detalle?: string }[];
  onChange: (v: string) => void;
  placeholder: string;
  /** Texto de la opción vacía. Si no se pasa, no hay opción vacía. */
  etiquetaTodas?: string;
  buscable?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    function fuera(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? opciones.filter((o) => o.label.toLowerCase().includes(q)) : opciones;
  }, [opciones, query]);

  const actual = opciones.find((o) => o.valor === valor);
  const texto = actual?.label ?? etiquetaTodas ?? placeholder;

  function elegir(v: string) {
    onChange(v);
    setAbierto(false);
    setQuery('');
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setAbierto((v) => !v)}
        className={`flex w-full items-center gap-1.5 px-2.5 py-2 text-[12.5px] font-medium rounded-[8px] border transition-all text-left ${
          valor
            ? 'bg-[rgba(12,92,171,0.1)] border-[rgba(12,92,171,0.35)] text-[#09090b]'
            : 'bg-[rgba(0,0,0,0.02)] border-[#e4e4e7] text-[#52525b] hover:border-[#d4d4d8]'
        }`}
      >
        <span className="truncate flex-1">{texto}</span>
        {actual?.detalle && (
          <span className="text-[11px] text-[#71717a] shrink-0">{actual.detalle}</span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0 opacity-50">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {abierto && (
        <div className="absolute z-[1200] left-0 right-0 top-full mt-1 max-h-72 overflow-hidden flex flex-col rounded-[10px] border border-[#e4e4e7] bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
          {buscable && (
            <div className="px-2 pt-2 pb-1.5 border-b border-[#f4f4f5]">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar…"
                className="w-full px-2 py-1.5 text-[12px] rounded-[6px] border border-[#e4e4e7] bg-[rgba(0,0,0,0.02)] text-[#09090b] placeholder:text-[#71717a] focus:outline-none focus:border-[rgba(12,92,171,0.4)]"
              />
            </div>
          )}
          <div className="overflow-y-auto overscroll-contain py-1">
            {etiquetaTodas && !query && (
              <button
                onClick={() => elegir('')}
                className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-[rgba(12,92,171,0.07)] transition-colors ${
                  valor === '' ? 'text-[#0c5cab] font-semibold' : 'text-[#27272a]'
                }`}
              >
                {etiquetaTodas}
              </button>
            )}
            {visibles.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-[#71717a]">Sin resultados</p>
            ) : (
              visibles.map((o) => (
                <button
                  key={o.valor}
                  onClick={() => elegir(o.valor)}
                  className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-[12px] hover:bg-[rgba(12,92,171,0.07)] transition-colors ${
                    o.valor === valor ? 'text-[#0c5cab] font-semibold' : 'text-[#27272a]'
                  }`}
                >
                  <span className="truncate flex-1">{o.label}</span>
                  {o.detalle && <span className="text-[11px] text-[#71717a] shrink-0">{o.detalle}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Control segmentado (2-3 opciones mutuamente excluyentes). */
export function Segmentado<T extends string>({
  valor,
  opciones,
  onChange,
}: {
  valor: T;
  opciones: { valor: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-[8px] border border-[#e4e4e7] bg-[rgba(0,0,0,0.02)] p-0.5">
      {opciones.map((o) => (
        <button
          key={o.valor}
          onClick={() => onChange(o.valor)}
          className={`px-2.5 py-1 text-[11.5px] font-semibold rounded-[6px] transition-all ${
            valor === o.valor
              ? 'bg-white text-[#09090b] shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
              : 'text-[#71717a] hover:text-[#09090b]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
