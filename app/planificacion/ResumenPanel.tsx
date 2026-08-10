'use client';

import { useMemo, useState } from 'react';
import { DIAS_HABILES, DIA_NOMBRE, type Cuadrante, type PdvPlan } from './types';

const MONO = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } as const;

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
}: {
  cuadrantes: Cuadrante[];
  puntos: PdvPlan[];
}) {
  const [exportando, setExportando] = useState(false);

  const { filas, totalPlanificados, sinPlanificar } = useMemo(() => {
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
    };
  }, [cuadrantes, puntos]);

  async function exportar() {
    setExportando(true);
    try {
      const XLSX = await import('xlsx');
      const porId = new Map(puntos.map((p) => [p.pdv_id, p]));

      // Hoja 1 — una fila por PDV y cuadrante. Un PDV con dos visitas aparece
      // dos veces, que es lo que hay que salir a hacer en la semana.
      const detalle = cuadrantes.flatMap((c) =>
        c.pdv_ids.map((id) => {
          const p = porId.get(id);
          return {
            'ID':                   id,
            'Razón social':         p?.razon_social ?? '',
            'Localidad':            p?.localidad ?? '',
            'Partido':              p?.partido ?? '',
            'Cuadrante':            c.nombre,
            'Vendedor planificado': c.vendedor_nombre,
            'Día planificado':      DIA_NOMBRE[c.dia] ?? c.dia,
            'Vendedor actual':      p?.cartera ?? '',
            'Día actual':           p?.dia_visita ?? '',
            'Cambia de vendedor':   p?.cartera === c.vendedor_nombre ? 'No' : 'Sí',
            'Última venta':         p?.ultima_vta ? p.ultima_vta.slice(0, 10) : '',
          };
        })
      );

      // Hoja 2 — carga semanal por vendedor, para ver si quedó pareja.
      const resumen = filas.map((f) => ({
        'Vendedor':   f.vendedor,
        'Cuadrantes': f.cuadrantes,
        'PDVs':       f.pdvs,
        'Visitas':    f.visitas,
        ...Object.fromEntries(DIAS_HABILES.map((d) => [DIA_NOMBRE[d], f.porDia[d] ?? 0])),
      }));

      const wb = XLSX.utils.book_new();

      const wsDetalle = XLSX.utils.json_to_sheet(detalle);
      wsDetalle['!cols'] = [
        { wch: 8 }, { wch: 38 }, { wch: 22 }, { wch: 18 }, { wch: 22 },
        { wch: 22 }, { wch: 16 }, { wch: 22 }, { wch: 12 }, { wch: 18 }, { wch: 13 },
      ];
      XLSX.utils.book_append_sheet(wb, wsDetalle, 'Asignación');

      const wsResumen = XLSX.utils.json_to_sheet(resumen);
      wsResumen['!cols'] = [{ wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, ...DIAS_HABILES.map(() => ({ wch: 11 }))];
      XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

      XLSX.writeFile(wb, `planificacion-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExportando(false);
    }
  }

  if (cuadrantes.length === 0) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[12.5px] text-[#71717a] leading-relaxed">
          Todavía no hay cuadrantes.<br />
          Dibujá el primero y acá vas a ver cómo queda repartida la semana.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Cuadrantes', cuadrantes.length],
          ['PDVs con plan', totalPlanificados],
          ['Sin plan', sinPlanificar],
        ].map(([label, valor]) => (
          <div key={label as string} className="rounded-[10px] border border-[#e4e4e7] bg-white px-2.5 py-2">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[#a1a1aa]" style={MONO}>{label}</p>
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

      <button
        onClick={exportar}
        disabled={exportando}
        className="w-full px-3 py-2 text-[12.5px] font-semibold rounded-[8px] bg-[#0c5cab] text-white hover:bg-[#0a4d90] disabled:opacity-50 transition-colors"
      >
        {exportando ? 'Generando…' : 'Exportar a Excel'}
      </button>
      <p className="text-[11px] text-[#a1a1aa] leading-relaxed">
        El Excel trae el vendedor y el día planificados junto al actual del maestro, para poder comparar antes de bajar los cambios al sistema.
      </p>
    </div>
  );
}
