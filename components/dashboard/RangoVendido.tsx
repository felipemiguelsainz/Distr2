import { fetchVentasRango } from '@/lib/calculations/queries';
import { formatKg } from '@/lib/calculations/dashboard';

const MONO = { fontFamily: "'JetBrains Mono', monospace" } as const;

function fmtPesos(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-AR');
}
function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Panel ADITIVO: muestra SOLO lo vendido (kilos/$) entre dos fechas, sin metas ni
// proyección (que son mensuales). El scope lo define quien lo usa (equipo/vendedor).
export async function RangoVendido({
  desde, hasta, equipo, vendedor,
}: {
  desde: string;
  hasta: string;
  equipo?: string;
  vendedor?: string;
}) {
  const data = await fetchVentasRango(desde, hasta, equipo, vendedor);

  return (
    <section className="bg-[#ffffff] rounded-2xl border border-[rgba(12,92,171,0.25)] shadow-xl shadow-black/5 overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e4e4e7] bg-[rgba(12,92,171,0.03)]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0c5cab]" style={MONO}>
          Vendido en el rango
        </p>
        <p className="text-[14px] font-bold text-[#09090b] mt-0.5">
          {fmtFecha(desde)} → {fmtFecha(hasta)}
        </p>
      </div>

      {data.porRubro.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13px] text-[#71717a]">No hubo ventas en ese rango.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 divide-x divide-[#e4e4e7] border-b border-[#e4e4e7]">
            <div className="px-5 py-3">
              <p className="text-[11px] text-[#71717a]">Kilos</p>
              <p className="text-[22px] font-bold tabular-nums text-[#09090b]">{formatKg(data.totalKilos)}</p>
            </div>
            <div className="px-5 py-3">
              <p className="text-[11px] text-[#71717a]">Neto $</p>
              <p className="text-[22px] font-bold tabular-nums text-[#09090b]">{fmtPesos(data.totalNeto)}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead>
                <tr className="bg-[#f4f4f5]/80 border-b border-[#e4e4e7]">
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={MONO}>Rubro</th>
                  <th className="px-5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={MONO}>Kilos</th>
                  <th className="px-5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={MONO}>Neto $</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e4e4e7]">
                {data.porRubro.map((r) => (
                  <tr key={r.rubro} className="hover:bg-[rgba(12,92,171,0.04)]">
                    <td className="px-5 py-2 font-medium text-[#27272a]">{r.rubro}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-[#27272a]">{formatKg(r.kilos)}</td>
                    <td className="px-5 py-2 text-right tabular-nums text-[#27272a]">{fmtPesos(r.neto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
