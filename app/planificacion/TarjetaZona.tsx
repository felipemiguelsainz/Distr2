'use client';

import { DIA_COLOR, DIA_NOMBRE, type Cuadrante } from './types';

/**
 * La tarjeta de una zona. Es la misma en las dos solapas: antes Cuadrantes
 * eran renglones separados por una línea y Resumen tarjetas con borde, y la
 * misma zona listada de dos formas distintas costaba reconocerla.
 *
 * Toda la superficie lleva al mapa. Clickear el nombre y que enfocara, pero
 * clickear el renglón de al lado y que no hiciera nada, era el peor de los dos
 * mundos: el único filtro es no robarle el clic a un control de adentro.
 */
export function TarjetaZona({
  c, enfocado, apagada, onEnfocar, accion, children,
}: {
  c: Cuadrante;
  enfocado?: boolean;
  /** Cuadrante ocultado del mapa: se ve atenuado, pero se sigue pudiendo tocar. */
  apagada?: boolean;
  onEnfocar?: (c: Cuadrante) => void;
  /** Lo que va arriba a la derecha (el botón PDF del Resumen). */
  accion?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const enfocar = onEnfocar && (() => onEnfocar(c));
  return (
    <div
      role={enfocar ? 'button' : undefined}
      tabIndex={enfocar ? 0 : undefined}
      title={enfocar ? 'Ver esta zona en el mapa' : undefined}
      onClick={(e) => {
        // Los controles de adentro (Editar, Borrar, PDF…) hacen lo suyo y no
        // además el zoom.
        if ((e.target as HTMLElement).closest('button, a, input, select')) return;
        enfocar?.();
      }}
      onKeyDown={(e) => {
        if (!enfocar || e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enfocar(); }
      }}
      className={`rounded-[10px] border bg-white px-2.5 py-2 transition-colors ${
        enfocado ? 'border-[#0c5cab] bg-[rgba(12,92,171,0.04)]' : 'border-[#e4e4e7]'
      } ${enfocar ? 'cursor-pointer hover:border-[#d4d4d8]' : ''} ${apagada ? 'opacity-45' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[#09090b] truncate">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color }} />
            {c.nombre}
          </p>
          <p className="text-[11px] text-[#71717a] truncate">
            {c.vendedor_nombre} · {DIA_NOMBRE[c.dia] ?? c.dia} · {c.pdv_ids.length} PDV
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* El día también como chip de color: es como se escanea la lista
              cuando hay cuarenta y seis. */}
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-[5px]"
            style={{ background: `${DIA_COLOR[c.dia]}1a`, color: DIA_COLOR[c.dia] }}
          >
            {c.dia}
          </span>
          {accion}
        </div>
      </div>
      {children}
    </div>
  );
}
