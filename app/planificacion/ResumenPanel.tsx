'use client';

import { useMemo, useState } from 'react';
import {
  DIAS_HABILES, DIA_NOMBRE, canalDe, contarPorCanal,
  type CuentaCanal, type Cuadrante, type PdvPlan,
} from './types';
import { generarHojaRuta, rutaPorDia } from '@/lib/planificacion/hojaRuta';
import { TarjetaZona } from './TarjetaZona';

/** Una columna por canal para el Excel, con 0 en los que esa fila no tiene. */
function columnasPorCanal(canales: CuentaCanal[], todos: string[]) {
  const n = new Map(canales.map((c) => [c.canal, c.n]));
  return Object.fromEntries(todos.map((c) => [c, n.get(c) ?? 0]));
}

// Ver la nota en PlanificacionClient.tsx: la fuente de cifras es JetBrains Mono.
const MONO = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" } as const;

interface FilaVendedor {
  vendedor: string;
  cuadrantes: number;
  /** PDVs distintos (un PDV visitado 2 veces cuenta una sola vez). */
  pdvs: number;
  /** Visitas por día: acá sí se cuenta cada pasada. */
  porDia: Record<string, number>;
  visitas: number;
}

/**
 * Solapa de resultado: cómo quedó repartido el trabajo y el export a Excel.
 *
 * Todo se deriva de lo que ya está en memoria (cuadrantes + puntos); no hay
 * llamada al server. Los números son de la capa de planificación, nunca del
 * maestro — el maestro entra al Excel solo como columna "actual" para comparar.
 */
export function ResumenPanel({
  cuadrantes,
  puntos,
  filtroDias,
  enfocado,
  onEnfocar,
  onExportarCuadrante,
  onExportarVendedor,
  exportandoPdf,
  progresoPdf,
}: {
  /** Ya vienen filtrados por día: acá se ve lo mismo que en el mapa. */
  cuadrantes: Cuadrante[];
  puntos: PdvPlan[];
  /** El mismo control de días de la otra solapa, para poder filtrar desde acá. */
  filtroDias?: React.ReactNode;
  /** Zona a la que el mapa le hizo zoom, para marcarla también en la lista. */
  enfocado?: string | null;
  /** Clic en una zona: zoom del mapa, sin sacar al usuario del Resumen. */
  onEnfocar?: (c: Cuadrante) => void;
  /** Genera el PDF de una zona. Lo maneja PlanificacionClient, que tiene el mapa. */
  onExportarCuadrante?: (c: Cuadrante) => void;
  /** Todas las zonas de un vendedor en un PDF multipágina. */
  onExportarVendedor?: (vendedor: string) => void;
  /** Etiqueta de lo que se está generando ahora, para deshabilitar los botones. */
  exportandoPdf?: string | null;
  /** Avance del PDF en curso: sin esto, 25 segundos parecen un cuelgue. */
  progresoPdf?: { hecho: number; total: number } | null;
}) {
  const [exportando, setExportando] = useState(false);
  const [rutaDe, setRutaDe] = useState<string | null>(null);

  const porId = useMemo(() => new Map(puntos.map((p) => [p.pdv_id, p])), [puntos]);

  /** Los canales que existen hoy en el maestro, en orden de leyenda. Fija las
      columnas del Excel: si cada fila trajera las suyas, la planilla saldría
      desalineada. */
  const canalesDelMaestro = useMemo(
    () => contarPorCanal(puntos).map((c) => c.canal),
    [puntos],
  );

  /** Una fila por cuadrante con su mezcla de canales. */
  const porCuadrante = useMemo(
    () =>
      cuadrantes.map((c) => {
        const pdvs = c.pdv_ids.map((id) => porId.get(id)).filter((p): p is PdvPlan => !!p);
        return { cuadrante: c, canales: contarPorCanal(pdvs) };
      }),
    [cuadrantes, porId],
  );

  const { filas, totalPlanificados, sinPlanificar, pdvsPorVendedor } = useMemo(() => {
    const porVendedor = new Map<string, FilaVendedor>();
    const pdvsPorVendedor = new Map<string, Set<number>>();
    const planificados = new Set<number>();

    for (const c of cuadrantes) {
      let f = porVendedor.get(c.vendedor_nombre);
      if (!f) {
        f = { vendedor: c.vendedor_nombre, cuadrantes: 0, pdvs: 0, porDia: {}, visitas: 0 };
        porVendedor.set(c.vendedor_nombre, f);
        pdvsPorVendedor.set(c.vendedor_nombre, new Set());
      }
      f.cuadrantes += 1;
      f.porDia[c.dia] = (f.porDia[c.dia] ?? 0) + c.pdv_ids.length;
      f.visitas += c.pdv_ids.length;
      const set = pdvsPorVendedor.get(c.vendedor_nombre)!;
      for (const id of c.pdv_ids) {
        set.add(id);
        planificados.add(id);
      }
    }
    for (const [v, set] of pdvsPorVendedor) porVendedor.get(v)!.pdvs = set.size;

    return {
      filas: [...porVendedor.values()].sort((a, b) => a.vendedor.localeCompare(b.vendedor, 'es')),
      totalPlanificados: planificados.size,
      sinPlanificar: puntos.filter((p) => !planificados.has(p.pdv_id)).length,
      pdvsPorVendedor,
    };
  }, [cuadrantes, puntos]);

  async function exportar() {
    setExportando(true);
    try {
      const XLSX = await import('xlsx');

      // Hoja 1 — una fila por PDV y cuadrante. Un PDV con dos visitas aparece
      // dos veces, que es lo que hay que salir a hacer en la semana.
      const detalle = cuadrantes.flatMap((c) =>
        c.pdv_ids.map((id) => {
          const p = porId.get(id);
          return {
            'ID':                   id,
            'Razón social':         p?.razon_social ?? '',
            'Domicilio':            p?.domicilio ?? '',
            'Localidad':            p?.localidad ?? '',
            'Partido':              p?.partido ?? '',
            'Cuadrante':            c.nombre,
            'Vendedor planificado': c.vendedor_nombre,
            'Día planificado':      DIA_NOMBRE[c.dia] ?? c.dia,
            'Vendedor actual':      p?.cartera ?? '',
            'Día actual':           p?.dia_visita ?? '',
            'Cambia de vendedor':   p?.cartera === c.vendedor_nombre ? 'No' : 'Sí',
            // El canal tal cual el maestro (normalizado a mayúsculas).
            'Canal':                p ? canalDe(p.canal_venta) : '',
            'Última venta':         p?.ultima_vta ? p.ultima_vta.slice(0, 10) : '',
          };
        })
      );

      // Hoja 2 — carga semanal por vendedor, para ver si quedó pareja. El
      // desglose por canal va sobre PDVs distintos, no sobre visitas: la
      // pregunta es qué mezcla de clientes atiende cada uno.
      const resumen = filas.map((f) => {
        const suyos = [...pdvsPorVendedor.get(f.vendedor) ?? []]
          .map((id) => porId.get(id))
          .filter((p): p is PdvPlan => !!p);
        const canales = contarPorCanal(suyos);
        return {
          'Vendedor':      f.vendedor,
          'Cuadrantes':    f.cuadrantes,
          'PDVs':          f.pdvs,
          'Visitas':       f.visitas,
          ...columnasPorCanal(canales, canalesDelMaestro),
          ...Object.fromEntries(DIAS_HABILES.map((d) => [DIA_NOMBRE[d], f.porDia[d] ?? 0])),
        };
      });

      // Hoja 3 — una fila por zona: es la vista que Fernando mira para decidir
      // si una zona quedó muy cargada de autoservicios.
      const zonas = porCuadrante.map(({ cuadrante: c, canales }) => ({
        'Cuadrante':      c.nombre,
        'Vendedor':       c.vendedor_nombre,
        'Día':            DIA_NOMBRE[c.dia] ?? c.dia,
        'PDVs':           c.pdv_ids.length,
        ...columnasPorCanal(canales, canalesDelMaestro),
        'Localidad':      c.localidad ?? '',
      }));

      const wb = XLSX.utils.book_new();

      const wsDetalle = XLSX.utils.json_to_sheet(detalle);
      // Un ancho por columna, en el mismo orden que las claves de `detalle`.
      wsDetalle['!cols'] = [
        { wch: 8 }, { wch: 38 }, { wch: 34 }, { wch: 22 }, { wch: 18 },
        { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 22 }, { wch: 12 },
        { wch: 18 }, { wch: 16 }, { wch: 14 },
      ];
      XLSX.utils.book_append_sheet(wb, wsDetalle, 'Asignación');

      const wsResumen = XLSX.utils.json_to_sheet(resumen);
      wsResumen['!cols'] = [
        { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 10 },
        ...canalesDelMaestro.map(() => ({ wch: 15 })),
        ...DIAS_HABILES.map(() => ({ wch: 11 })),
      ];
      XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

      const wsZonas = XLSX.utils.json_to_sheet(zonas);
      wsZonas['!cols'] = [
        { wch: 24 }, { wch: 22 }, { wch: 12 }, { wch: 8 },
        ...canalesDelMaestro.map(() => ({ wch: 15 })),
        { wch: 22 },
      ];
      XLSX.utils.book_append_sheet(wb, wsZonas, 'Zonas');

      XLSX.writeFile(wb, `planificacion-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExportando(false);
    }
  }

  async function hojaDeRuta(vendedor: string) {
    setRutaDe(vendedor);
    try {
      await generarHojaRuta(vendedor, rutaPorDia(cuadrantes, porId, vendedor));
    } finally {
      setRutaDe(null);
    }
  }

  if (cuadrantes.length === 0) {
    return (
      <div className="flex flex-col gap-3 px-3 py-3">
        {filtroDias}
        <p className="px-1 py-6 text-center text-[12.5px] text-[#71717a] leading-relaxed">
          {filtroDias
            ? 'Ningún cuadrante cae en los días elegidos.'
            : <>Todavía no hay cuadrantes.<br />Dibujá el primero y acá vas a ver cómo queda repartida la semana.</>}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      {filtroDias}
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Cuadrantes', cuadrantes.length],
          ['PDVs con plan', totalPlanificados],
          ['Sin plan', sinPlanificar],
        ].map(([label, valor]) => (
          <div key={label as string} className="rounded-[10px] border border-[#e4e4e7] bg-white px-2.5 py-2">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[#71717a]" style={MONO}>{label}</p>
            <p className="text-[16px] font-bold text-[#09090b] leading-tight mt-0.5">
              {(valor as number).toLocaleString('es-AR')}
            </p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-[#e4e4e7] bg-white">
        <table className="min-w-[520px] w-full border-collapse">
          <thead>
            <tr className="border-b border-[#e4e4e7]">
              <th className="px-2.5 py-2 text-left text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[#71717a]" style={MONO}>Vendedor</th>
              <th className="px-2 py-2 text-right text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[#71717a]" style={MONO}>PDVs</th>
              {DIAS_HABILES.map((d) => (
                <th key={d} className="px-1.5 py-2 text-right text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[#71717a]" style={MONO}>{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.vendedor} className="border-b border-[#f4f4f5] last:border-0">
                <td className="px-2.5 py-1.5 text-[12px] font-medium text-[#09090b] whitespace-nowrap">{f.vendedor}</td>
                <td className="px-2 py-1.5 text-[12px] text-right font-semibold text-[#09090b]" style={MONO}>{f.pdvs}</td>
                {DIAS_HABILES.map((d) => (
                  <td key={d} className={`px-1.5 py-1.5 text-[11.5px] text-right ${f.porDia[d] ? 'text-[#27272a]' : 'text-[#d4d4d8]'}`} style={MONO}>
                    {f.porDia[d] ?? '·'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Zona por zona: la mezcla de canales y el PDF para el vendedor ── */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[#71717a]" style={MONO}>
          Zonas
        </p>
        {porCuadrante.map(({ cuadrante: c, canales }) => {
          const ocupado = exportandoPdf === c.id;
          return (
            <TarjetaZona
              key={c.id}
              c={c}
              enfocado={c.id === enfocado}
              onEnfocar={onEnfocar}
              accion={onExportarCuadrante && (
                <button
                  onClick={() => onExportarCuadrante(c)}
                  disabled={!!exportandoPdf}
                  className="px-2 py-1 text-[11px] font-semibold rounded-[6px] text-[#0c5cab] bg-[rgba(12,92,171,0.08)] border border-[rgba(12,92,171,0.2)] hover:bg-[rgba(12,92,171,0.14)] disabled:opacity-40 transition-colors"
                >
                  {ocupado ? 'Generando…' : 'PDF'}
                </button>
              )}
            >
              {/* Desglose por canal, como lo nombra el maestro. Los canales
                  que la zona no tiene no aparecen: en una zona de puro kiosco,
                  un "0 AUTOSERVICIO" es ruido. */}
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5">
                {canales.map(({ canal, color, n }) => (
                  <span key={canal} className="flex items-center gap-1 text-[11px] text-[#52525b]">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="font-semibold text-[#09090b]" style={MONO}>{n}</span>
                    {canal}
                  </span>
                ))}
              </div>
            </TarjetaZona>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        <button
          onClick={exportar}
          disabled={exportando}
          className="w-full px-3 py-2 text-[12.5px] font-semibold rounded-[8px] bg-[#0c5cab] text-white hover:bg-[#0a4d90] disabled:opacity-50 transition-colors"
        >
          {exportando ? 'Generando…' : 'Exportar a Excel'}
        </button>

        {/* Lo que se imprime y se reparte, por vendedor. Son dos papeles
            distintos: la hoja de ruta es para salir a la calle (un día por
            hoja, con la dirección) y el PDF de zonas es para revisar la
            zonificación en el mapa. */}
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-[#71717a] mt-1" style={MONO}>
          Para el vendedor
        </p>
        {filas.map((f) => (
          <div key={f.vendedor} className="rounded-[10px] border border-[#e4e4e7] bg-white px-2.5 py-2">
            <p className="text-[12px] font-semibold text-[#09090b] truncate">{f.vendedor}</p>
            <p className="text-[11px] text-[#71717a]">
              {f.pdvs} clientes · {f.visitas} visitas · {f.cuadrantes} zonas
            </p>
            <div className="flex gap-1.5 mt-1.5">
              <button
                onClick={() => hojaDeRuta(f.vendedor)}
                disabled={!!rutaDe || !!exportandoPdf}
                className="flex-1 px-2 py-1.5 text-[11.5px] font-semibold rounded-[7px] bg-[#0c5cab] text-white hover:bg-[#0a4d90] disabled:opacity-40 transition-colors"
              >
                {rutaDe === f.vendedor ? 'Generando…' : 'Hoja de ruta'}
              </button>
              {onExportarVendedor && (
                <button
                  onClick={() => onExportarVendedor(f.vendedor)}
                  disabled={!!exportandoPdf || !!rutaDe}
                  className="flex-1 px-2 py-1.5 text-[11.5px] font-medium rounded-[7px] text-[#0c5cab] bg-[rgba(12,92,171,0.06)] border border-[rgba(12,92,171,0.18)] hover:bg-[rgba(12,92,171,0.12)] disabled:opacity-40 transition-colors"
                >
                  {exportandoPdf === `v:${f.vendedor}`
                    ? `Zona ${(progresoPdf?.hecho ?? 0) + 1} de ${progresoPdf?.total ?? f.cuadrantes}…`
                    : 'Zonas con mapa'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-[#71717a] leading-relaxed">
        La <strong className="font-semibold text-[#27272a]">hoja de ruta</strong> es el papel del vendedor: un día por hoja, con la dirección y ordenada por calle. El Excel trae el vendedor y el día planificados junto al actual del maestro, para comparar antes de bajar los cambios al sistema.
      </p>
    </div>
  );
}
