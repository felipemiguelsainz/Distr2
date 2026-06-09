import { ClientesRubro } from '@/lib/types';
import { avanceColor, formatPctPlain } from '@/lib/calculations/dashboard';

const MONO = { fontFamily: "'JetBrains Mono', monospace" };

function signedColor(pct: number) {
  if (pct >= 5)  return 'text-[#16a34a]';
  if (pct >= -5) return 'text-[#71717a]';
  return 'text-[#dc2626]';
}

function pctBar(value: number, max: number) {
  return Math.min(100, max > 0 ? (value / max) * 100 : 0);
}

function fmtSigned(pct: number) {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

function TH({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-3 py-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#71717a] whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={MONO}
    >
      {children}
    </th>
  );
}

export function ClientesTable({
  data,
  cartera3mTotal,
  cccMesTotal,
  cccPrevTotal,
  cccAaTotal,
  metaPorRubro = {},
  metaTotal = 0,
}: {
  data: ClientesRubro[];
  cartera3mTotal: number;
  cccMesTotal:  number;
  cccPrevTotal: number;
  cccAaTotal:   number;
  metaPorRubro?: Record<string, number>;
  metaTotal?:    number;
}) {
  if (data.length === 0) return null;

  const metaFor  = (rubro: string) => (rubro === 'TOTAL' ? metaTotal : (metaPorRubro[rubro] ?? 0));
  const cumplFor = (clientes: number, meta: number) => (meta > 0 ? (clientes / meta) * 100 : null);

  // Total row — uses true COUNT(DISTINCT pdv_id) across all rubros (no double-counting)
  const total: ClientesRubro = {
    rubro: 'TOTAL',
    clientes_mes:          cccMesTotal,
    cartera_activa_3m:     cartera3mTotal,
    penetracion_pct:       0,
    clientes_mes_anterior: cccPrevTotal,
    vs_mes_anterior_pct:   0,
    clientes_aa:           cccAaTotal,
    vs_aa_pct:             0,
  };
  total.penetracion_pct     = total.cartera_activa_3m > 0
    ? (total.clientes_mes / total.cartera_activa_3m) * 100 : 0;
  total.vs_mes_anterior_pct = total.clientes_mes_anterior > 0
    ? ((total.clientes_mes - total.clientes_mes_anterior) / total.clientes_mes_anterior) * 100 : 0;
  total.vs_aa_pct           = total.clientes_aa > 0
    ? ((total.clientes_mes - total.clientes_aa) / total.clientes_aa) * 100 : 0;

  const maxCartera = Math.max(...data.map(r => r.cartera_activa_3m), 1);

  const rows = [...data, total];

  return (
    <div className="bg-[#ffffff] rounded-2xl border border-[#e4e4e7] hover:border-[#d4d4d8] transition-all duration-200 shadow-xl shadow-black/5 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#e4e4e7]">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#71717a]"
          style={MONO}
        >
          Clientes con Compra — Por Categoría
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="table-fixed w-full text-[12px] min-w-[640px]">
          <thead>
            <tr className="border-b border-[#e4e4e7] bg-[#f4f4f5]/60">
              <TH>Categoría</TH>
              <TH right>Clientes Mes</TH>
              <TH right>Meta</TH>
              <TH right>Cumpl.</TH>
              <TH right>Cartera 3M</TH>
              <TH right>Penetración</TH>
              <TH right>vs Mes Ant.</TH>
              <TH right>vs AA</TH>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e4e4e7]">
            {rows.map((row, idx) => {
              const isTotal = row.rubro === 'TOTAL';
              const barPct  = pctBar(row.clientes_mes, isTotal ? row.cartera_activa_3m : maxCartera);

              return (
                <tr
                  key={row.rubro}
                  className={`transition-colors ${
                    isTotal
                      ? 'bg-[#f4f4f5]/70 border-t-2 border-t-[#e4e4e7]'
                      : 'hover:bg-[rgba(12,92,171,0.04)]'
                  }`}
                >
                  {/* Categoría */}
                  <td className="px-3 py-2">
                    <div
                      className={`text-[11px] font-medium truncate ${isTotal ? 'text-[#09090b] font-bold' : 'text-[#09090b]'}`}
                      style={MONO}
                    >
                      {row.rubro}
                    </div>
                    {/* Mini progress bar */}
                    {!isTotal && (
                      <div className="mt-1 h-[3px] rounded-full overflow-hidden" style={{ background: '#f4f4f5' }}>
                        <div
                          className="h-full rounded-full bg-[#0c5cab]"
                          style={{
                            width: `${barPct}%`,
                            transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
                          }}
                        />
                      </div>
                    )}
                  </td>

                  {/* Clientes Mes */}
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`tabular-nums ${isTotal ? 'text-[#09090b] font-bold' : 'text-[#09090b]'}`}
                      style={MONO}
                    >
                      {row.clientes_mes.toLocaleString('es-AR')}
                    </span>
                  </td>

                  {/* Meta CCC */}
                  <td className="px-3 py-2 text-right">
                    {(() => {
                      const meta = metaFor(row.rubro);
                      return meta > 0 ? (
                        <span className={`tabular-nums ${isTotal ? 'text-[#09090b] font-bold' : 'text-[#27272a]'}`} style={MONO}>
                          {meta.toLocaleString('es-AR')}
                        </span>
                      ) : (
                        <span className="text-[#71717a]" style={MONO}>—</span>
                      );
                    })()}
                  </td>

                  {/* Cumplimiento % */}
                  <td className="px-3 py-2 text-right">
                    {(() => {
                      const cumpl = cumplFor(row.clientes_mes, metaFor(row.rubro));
                      return cumpl !== null ? (
                        <span
                          className={`tabular-nums font-semibold rounded-lg px-1.5 py-0.5 ${avanceColor(cumpl)}`}
                          style={MONO}
                        >
                          {formatPctPlain(cumpl)}
                        </span>
                      ) : (
                        <span className="text-[#71717a]" style={MONO}>—</span>
                      );
                    })()}
                  </td>

                  {/* Cartera Activa 3M */}
                  <td className="px-3 py-2 text-right">
                    <span className="text-[#71717a] tabular-nums" style={MONO}>
                      {row.cartera_activa_3m.toLocaleString('es-AR')}
                    </span>
                  </td>

                  {/* Penetración % */}
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`tabular-nums font-semibold ${
                        row.penetracion_pct >= 70
                          ? 'text-[#16a34a]'
                          : row.penetracion_pct >= 40
                            ? 'text-[#d97706]'
                            : 'text-[#dc2626]'
                      }`}
                      style={MONO}
                    >
                      {row.penetracion_pct.toFixed(1)}%
                    </span>
                  </td>

                  {/* vs Mes Anterior */}
                  <td className="px-3 py-2 text-right">
                    {row.clientes_mes_anterior > 0 ? (
                      <span
                        className={`tabular-nums text-[11px] ${signedColor(row.vs_mes_anterior_pct)}`}
                        style={MONO}
                      >
                        {fmtSigned(row.vs_mes_anterior_pct)}
                        <span className="text-[9px] text-[#71717a] ml-1">
                          ({row.clientes_mes_anterior})
                        </span>
                      </span>
                    ) : (
                      <span className="text-[#71717a]" style={MONO}>—</span>
                    )}
                  </td>

                  {/* vs AA */}
                  <td className="px-3 py-2 text-right">
                    {row.clientes_aa > 0 ? (
                      <span
                        className={`tabular-nums text-[11px] ${signedColor(row.vs_aa_pct)}`}
                        style={MONO}
                      >
                        {fmtSigned(row.vs_aa_pct)}
                        <span className="text-[9px] text-[#71717a] ml-1">
                          ({row.clientes_aa})
                        </span>
                      </span>
                    ) : (
                      <span className="text-[#71717a]" style={MONO}>—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
