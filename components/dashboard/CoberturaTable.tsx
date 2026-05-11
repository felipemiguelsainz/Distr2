import { CoberturaItem } from '@/lib/types';
import { avanceColor, formatPctPlain } from '@/lib/calculations/dashboard';

export function CoberturaTable({ data }: { data: CoberturaItem[] }) {
  if (data.length === 0) return null;

  return (
    <div className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] hover:border-[#213654] transition-all duration-200 shadow-xl shadow-black/30 overflow-hidden">
      <div className="px-5 py-4 border-b border-[#1a2d4a]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Cobertura SKUs clave</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[#1a2d4a] bg-[#0f1e38]/60">
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>SKU</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Artículo</th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>PDVs</th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Total</th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Cobertura</th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Objetivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1a2d4a]">
            {data.map((row) => (
              <tr key={row.sku} className="hover:bg-[rgba(59,130,246,0.04)] transition-colors">
                <td className="px-5 py-2.5 text-[12px] text-[#6b85a8]" style={{fontFamily: "'JetBrains Mono', monospace"}}>{row.sku}</td>
                <td className="px-5 py-2.5 font-medium text-[#f0f4ff]">{row.articulo}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-[#f0f4ff]">{row.pdvs_compraron}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-[#6b85a8]">{row.pdvs_totales}</td>
                <td className={`px-5 py-2.5 text-right tabular-nums font-semibold ${avanceColor(row.cobertura_pct)} rounded`}>
                  {formatPctPlain(row.cobertura_pct)}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums text-[#6b85a8]">{row.objetivo_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
