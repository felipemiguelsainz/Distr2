import { ClientesRubro } from '@/lib/types';

const MONO = { fontFamily: "'JetBrains Mono', monospace" };

function signedColor(pct: number) {
  if (pct >= 5)  return 'text-[#14b8a6]';
  if (pct >= -5) return 'text-[#6b85a8]';
  return 'text-[#f87171]';
}

function pctBar(value: number, max: number) {
  return Math.min(100, max > 0 ? (value / max) * 100 : 0);
}

function fmtSigned(pct: number) {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}%`;
}

export function ClientesTable({ data }: { data: ClientesRubro[] }) {
  if (data.length === 0) return null;

  // Total row
  const total: ClientesRubro = {
    rubro: 'TOTAL',
    clientes_mes:          data.reduce((s, r) => s + r.clientes_mes, 0),
    cartera_activa_3m:     data.reduce((s, r) => s + r.cartera_activa_3m, 0),
    penetracion_pct:       0,
    clientes_mes_anterior: data.reduce((s, r) => s + r.clientes_mes_anterior, 0),
    vs_mes_anterior_pct:   0,
    clientes_aa:           data.reduce((s, r) => s + r.clientes_aa, 0),
    vs_aa_pct:             0,
  };
  total.penetracion_pct     = total.cartera_activa_3m > 0
    ? (total.clientes_mes / total.cartera_activa_3m) * 100 : 0;
  total.vs_mes_anterior_pct = total.clientes_mes_anterior > 0
    ? ((total.clientes_mes - total.clientes_mes_anterior) / total.clientes_mes_anterior) * 100 : 0;
  total.vs_aa_pct           = total.clientes_aa > 0
    ? ((total.clientes_mes - total.clientes_aa) / total.clientes_aa) * 100 : 0;

  const maxCartera = Math.max(...data.map(r => r.cartera_activa_3m), 1);

  const TH = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
    <th
      className={`px-3 py-2.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8] whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}
      style={MONO}
    >
      {children}
    </th>
  );

  const rows = [...data, total];

  return (
    <div className="bg-[#0b1528] rounded-2xl border border-[#1a2d4a] hover:border-[#213654] transition-all duration-200 shadow-xl shadow-black/30 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#1a2d4a]">
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6b85a8]"
          style={MONO}
        >
          Clientes con Compra — Por Categoría
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="table-fixed w-full text-[12px]">
          <thead>
            <tr className="border-b border-[#1a2d4a] bg-[#0f1e38]/60">
              <TH>Categoría</TH>
              <TH right>Clientes Mes</TH>
              <TH right>Cartera 3M</TH>
              <TH right>Penetración</TH>
              <TH right>vs Mes Ant.</TH>
              <TH right>vs AA</TH>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1a2d4a]">
            {rows.map((row, idx) => {
              const isTotal = row.rubro === 'TOTAL';
              const barPct  = pctBar(row.clientes_mes, isTotal ? row.cartera_activa_3m : maxCartera);

              return (
                <tr
                  key={row.rubro}
                  className={`transition-colors ${
                    isTotal
                      ? 'bg-[#0f1e38]/70 border-t-2 border-t-[#1a2d4a]'
                      : 'hover:bg-[rgba(59,130,246,0.04)]'
                  }`}
                >
                  {/* Categoría */}
                  <td className="px-3 py-2">
                    <div
                      className={`text-[11px] font-medium truncate ${isTotal ? 'text-[#f0f4ff] font-bold' : 'text-[#f0f4ff]'}`}
                      style={MONO}
                    >
                      {row.rubro}
                    </div>
                    {/* Mini progress bar */}
                    {!isTotal && (
                      <div className="mt-1 h-[3px] rounded-full overflow-hidden" style={{ background: '#0f1e38' }}>
                        <div
                          className="h-full rounded-full bg-[#3b82f6]"
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
                      className={`tabular-nums ${isTotal ? 'text-[#f0f4ff] font-bold' : 'text-[#f0f4ff]'}`}
                      style={MONO}
                    >
                      {row.clientes_mes.toLocaleString('es-AR')}
                    </span>
                  </td>

                  {/* Cartera Activa 3M */}
                  <td className="px-3 py-2 text-right">
                    <span className="text-[#6b85a8] tabular-nums" style={MONO}>
                      {row.cartera_activa_3m.toLocaleString('es-AR')}
                    </span>
                  </td>

                  {/* Penetración % */}
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`tabular-nums font-semibold ${
                        row.penetracion_pct >= 70
                          ? 'text-[#14b8a6]'
                          : row.penetracion_pct >= 40
                            ? 'text-[#f59e0b]'
                            : 'text-[#f87171]'
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
                        <span className="text-[9px] text-[#6b85a8] ml-1">
                          ({row.clientes_mes_anterior})
                        </span>
                      </span>
                    ) : (
                      <span className="text-[#6b85a8]" style={MONO}>—</span>
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
                        <span className="text-[9px] text-[#6b85a8] ml-1">
                          ({row.clientes_aa})
                        </span>
                      </span>
                    ) : (
                      <span className="text-[#6b85a8]" style={MONO}>—</span>
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
