import { CccData } from '@/lib/types';

export function CccCard({ data }: { data: CccData }) {
  const isPositive = data.variacion >= 0;
  return (
    <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] hover:border-[#d4d4d8] hover:-translate-y-0.5 transition-all duration-200 shadow-xl shadow-black/5 p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a] mb-4" style={{fontFamily: "'JetBrains Mono', monospace"}}>
        CCC — Clientes que Compraron
      </p>
      <div className="flex items-end gap-5">
        <div>
          <p className="text-[38px] font-extrabold leading-none tracking-tight text-[#09090b]">
            {data.mes_actual}
          </p>
          <p className="text-[12px] text-[#71717a] mt-1">Mes actual</p>
        </div>
        <div className="pb-0.5">
          <p className={`text-[15px] font-semibold ${isPositive ? 'text-[#16a34a]' : 'text-[#dc2626]'}`}>
            {isPositive ? '+' : ''}{data.variacion.toFixed(1)}%
          </p>
          <p className="text-[11px] text-[#71717a]">vs mes anterior ({data.mes_anterior})</p>
        </div>
      </div>
    </div>
  );
}
