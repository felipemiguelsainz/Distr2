import { CoberturaItem } from '@/lib/types';
import { avanceColor, formatPctPlain } from '@/lib/calculations/dashboard';

export function CoberturaTable({ data }: { data: CoberturaItem[] }) {
  if (data.length === 0) return null;

  return (
    <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] hover:border-[#d4d4d8] transition-all duration-200 shadow-xl shadow-black/5 overflow-hidden">
      <div className="px-5 py-4 border-b border-[#e4e4e7]">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Cobertura SKUs clave</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[#e4e4e7] bg-[#f4f4f5]/60">
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>SKU</th>
              <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Artículo</th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>PDVs</th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Total</th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Cobertura</th>
              <th className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>Objetivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e4e7]">
            {data.map((row) => (
              <tr key={row.sku} className="hover:bg-[rgba(12,92,171,0.04)] transition-colors">
                <td className="px-5 py-2.5 text-[12px] text-[#71717a]" style={{fontFamily: "'JetBrains Mono', monospace"}}>{row.sku}</td>
                <td className="px-5 py-2.5 font-medium text-[#09090b]">{row.articulo}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-[#09090b]">{row.pdvs_compraron}</td>
                <td className="px-5 py-2.5 text-right tabular-nums text-[#71717a]">{row.pdvs_totales}</td>
                <td className={`px-5 py-2.5 text-right tabular-nums font-semibold ${avanceColor(row.cobertura_pct)} rounded`}>
                  {formatPctPlain(row.cobertura_pct)}
                </td>
                <td className="px-5 py-2.5 text-right tabular-nums text-[#71717a]">{row.objetivo_pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
