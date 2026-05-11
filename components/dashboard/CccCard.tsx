import { CccData } from '@/lib/types';

export function CccCard({ data }: { data: CccData }) {
  const isPositive = data.variacion >= 0;
  return (
    <div className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] hover:border-[#213654] hover:-translate-y-0.5 transition-all duration-200 shadow-xl shadow-black/30 p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8] mb-4" style={{fontFamily: "'JetBrains Mono', monospace"}}>
        CCC — Clientes que Compraron
      </p>
      <div className="flex items-end gap-5">
        <div>
          <p className="text-[38px] font-extrabold leading-none tracking-tight text-[#f0f4ff]">
            {data.mes_actual}
          </p>
          <p className="text-[12px] text-[#6b85a8] mt-1">Mes actual</p>
        </div>
        <div className="pb-0.5">
          <p className={`text-[15px] font-semibold ${isPositive ? 'text-[#14b8a6]' : 'text-[#f87171]'}`}>
            {isPositive ? '+' : ''}{data.variacion.toFixed(1)}%
          </p>
          <p className="text-[11px] text-[#6b85a8]">vs mes anterior ({data.mes_anterior})</p>
        </div>
      </div>
    </div>
  );
}
