'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Clock, ChevronDown, RefreshCw, MapPin, ClipboardList } from 'lucide-react';

interface Cliente {
  pdv_id: number; razon_social: string | null; localidad: string | null; cartera: string | null;
  ultima_vta: string; valor_mensual: number; kg_mensual?: number; cadencia_dias: number; dias_sin: number;
}

function fmtPesos(n: number): string {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)} mil`;
  return `$${n}`;
}
const fmtKg = (n: number) => `${(n || 0).toLocaleString('es-AR')} kg`;

// Color semántico según los días que faltan para entrar en zona roja (inactivo).
function zonaRojaStyle(diasRestantes: number) {
  if (diasRestantes <= 0) return { text: 'text-red-700', bg: 'bg-red-100', pulse: false, label: 'En zona roja' };
  if (diasRestantes < 15) return { text: 'text-red-700', bg: 'bg-red-100', pulse: true, label: `${diasRestantes} días` };
  if (diasRestantes <= 30) return { text: 'text-yellow-700', bg: 'bg-yellow-100', pulse: false, label: `${diasRestantes} días` };
  return { text: 'text-green-700', bg: 'bg-green-100', pulse: false, label: `${diasRestantes} días` };
}

export function EnfriandoseClient({ vendedores, mostrarVendedor }: { vendedores: string[]; mostrarVendedor: boolean }) {
  // El vendedor vive en la URL (?vendedor=X): así respeta el filtro con el que se
  // llegó desde Insights y sobrevive a recargas y al botón atrás.
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const vendedor = searchParams.get('vendedor') ?? '';

  const setVendedor = useCallback((v: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (v) params.set('vendedor', v); else params.delete('vendedor');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [valorTotal, setValorTotal] = useState(0);
  const [kgTotal, setKgTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights/enfriandose${vendedor ? `?vendedor=${encodeURIComponent(vendedor)}` : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error cargando clientes.');
      setClientes(data.clientes ?? []);
      setValorTotal(data.valor_total ?? 0);
      setKgTotal(data.kg_total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [vendedor]);

  // Fetch al montar y al cambiar de vendedor (no es sync de estado).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const mapsHref = clientes.length
    ? `/mapa?pdvs=${clientes.slice(0, 200).map((c) => c.pdv_id).join(',')}${vendedor ? `&vendedor=${encodeURIComponent(vendedor)}` : ''}`
    : '';

  return (
    <div className="mt-2">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-2 min-w-0">
          <Clock className="w-6 h-6 sm:w-7 sm:h-7 text-amber-500 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">Clientes enfriándose</h1>
            <p className="text-sm text-gray-500 mt-0.5">Todavía compran pero rompieron su frecuencia habitual. Contactalos antes de que se apaguen.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {vendedores.length > 1 && (
            <div className="relative flex-1 sm:flex-none min-w-[150px]">
              <select
                value={vendedor}
                onChange={(e) => setVendedor(e.target.value)}
                className="w-full appearance-none cursor-pointer pl-3 pr-8 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg shadow-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition"
              >
                <option value="">Todos los vendedores</option>
                {vendedores.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          )}
          {mapsHref && (
            <a href={mapsHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              <MapPin className="w-4 h-4" /> Ver en mapa
            </a>
          )}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-amber-500 px-4 py-3">
          <p className="text-xs text-gray-500">Clientes enfriándose</p>
          <p className="text-3xl font-bold text-amber-600 tabular-nums">{clientes.length}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-red-500 px-4 py-3">
          <p className="text-xs text-gray-500">$/mes en juego</p>
          <p className="text-3xl font-bold text-red-600 tabular-nums">{fmtPesos(valorTotal)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 border-l-slate-400 px-4 py-3">
          <p className="text-xs text-gray-500">Kg/mes en juego</p>
          <p className="text-3xl font-bold text-slate-700 tabular-nums">{fmtKg(kgTotal)}</p>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2.5 text-sm text-gray-500 py-10 justify-center">
          <RefreshCw className="w-4 h-4 animate-spin" /> Calculando…
        </div>
      ) : clientes.length === 0 ? (
        <p className="text-sm text-gray-400 py-6">No hay clientes enfriándose en este alcance.</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">Localidad</th>
                  {mostrarVendedor && <th className="px-4 py-2.5 font-medium hidden md:table-cell">Vendedor</th>}
                  <th className="px-4 py-2.5 font-medium text-right hidden md:table-cell">Compra cada</th>
                  <th className="px-4 py-2.5 font-medium text-right">Hace</th>
                  <th className="px-4 py-2.5 font-medium text-center">Zona roja en</th>
                  <th className="px-4 py-2.5 font-medium text-right">$/mes</th>
                  <th className="px-4 py-2.5 font-medium text-right">Kg/mes</th>
                  <th className="px-4 py-2.5 font-medium text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clientes.map((c) => {
                  const zr = 90 - c.dias_sin;
                  const s = zonaRojaStyle(zr);
                  return (
                    <tr key={c.pdv_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-900">#{c.pdv_id} — {c.razon_social ?? 's/n'}</td>
                      <td className="px-4 py-2.5 text-gray-500">{c.localidad ?? '—'}</td>
                      {mostrarVendedor && <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell">{c.cartera ?? '—'}</td>}
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 hidden md:table-cell">{c.cadencia_dias} d</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${s.text}`}>{c.dias_sin} d</td>
                      <td className="px-4 py-2.5 text-center">
                        <span
                          title={zr > 0 ? `Si no compra antes de ${zr} días, pasa a inactivo` : 'Ya superó su umbral de inactividad'}
                          // El latido es sólo énfasis: el estado ya se lee por
                          // el color y por la etiqueta, así que con movimiento
                          // reducido se apaga sin perder información.
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.text} ${s.pulse ? 'animate-pulse motion-reduce:animate-none' : ''}`}
                        >
                          {s.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900">{fmtPesos(c.valor_mensual)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmtKg(c.kg_mensual ?? 0)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          <a
                            href={`/mapa?pdvs=${c.pdv_id}${c.cartera ? `&vendedor=${encodeURIComponent(c.cartera)}` : ''}`}
                            title="Ver en el mapa"
                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition"
                          >
                            <MapPin className="w-4 h-4" />
                          </a>
                          <button
                            type="button"
                            title="Registrar visita (próximamente)"
                            disabled
                            className="p-1.5 rounded-lg text-gray-400 cursor-not-allowed"
                          >
                            <ClipboardList className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
