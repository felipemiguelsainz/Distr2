'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, UserCheck, Clock, AlertTriangle, RefreshCw, Building2, ChevronDown } from 'lucide-react';

interface Avance { rubro: string; avance_pct: number; acumulado: number; meta: number | null; tendencia: number | null }
interface InsightData {
  alcance: string;
  periodo: string;
  actividad: { total: number; activos: number; tibios: number; inactivos: number; pct_comprando: number };
  churn: { count: number; top: { pdv_id: number; razon_social: string | null; localidad: string | null; ultima_vta: string }[] };
  avance: Avance[];
}
interface Payload { data: InsightData; narrative: string }

// --- Helpers ---------------------------------------------------------------
function parseSections(md: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let cur = '';
  for (const ln of md.split('\n')) {
    if (ln.startsWith('## ')) { cur = ln.slice(3).trim().toLowerCase(); out[cur] = []; }
    else if (cur) out[cur].push(ln);
  }
  return out;
}
function sectionText(sections: Record<string, string[]>, includes: string): string[] {
  const k = Object.keys(sections).find((x) => x.includes(includes));
  return k ? sections[k].filter((l) => l.trim() !== '') : [];
}
function inlineBold(s: string, base = 'text-gray-700') {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={j} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>
      : <span key={j} className={base}>{part}</span>);
}
function Prose({ lines }: { lines: string[] }) {
  if (lines.length === 0) return <p className="text-sm text-gray-400">Sin datos para este período.</p>;
  return (
    <ul className="space-y-1.5">
      {lines.map((ln, i) => (
        <li key={i} className="text-sm leading-relaxed flex gap-2">
          <span className="text-blue-400 mt-0.5">•</span>
          <span>{inlineBold(ln.replace(/^[-*]\s*/, ''))}</span>
        </li>
      ))}
    </ul>
  );
}
function avanceColor(pct: number) {
  if (pct < 50) return { bar: '#dc2626', text: 'text-red-600' };
  if (pct < 80) return { bar: '#eab308', text: 'text-yellow-600' };
  return { bar: '#16a34a', text: 'text-green-600' };
}

// --- Componente ------------------------------------------------------------
export function InsightsClient({ vendedores }: { vendedores: string[] }) {
  const [vendedor, setVendedor] = useState(''); // '' = vista agregada (empresa/equipo)
  const [payload, setPayload] = useState<Payload | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (regenerar = false) => {
    setLoading(true);
    setError(null);
    if (regenerar) setPayload(null);
    try {
      const res = regenerar
        ? await fetch('/api/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendedor: vendedor || undefined }) })
        : await fetch(`/api/insights${vendedor ? `?vendedor=${encodeURIComponent(vendedor)}` : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Error generando insights.');
      setPayload(data.payload);
      setGeneratedAt(data.generated_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [vendedor]);

  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [vendedor]);

  const d = payload?.data;
  const sections = payload ? parseSections(payload.narrative) : {};
  const esEmpresa = !vendedor;

  const kpis = d ? [
    { label: 'Total PDVs', val: d.actividad.total, icon: Users, accent: 'border-l-slate-400', num: 'text-slate-800', ic: 'text-slate-400' },
    { label: 'Activos ≤1m', val: d.actividad.activos, icon: UserCheck, accent: 'border-l-green-500', num: 'text-green-600', ic: 'text-green-500' },
    { label: 'Tibios 1-3m', val: d.actividad.tibios, icon: Clock, accent: 'border-l-yellow-500', num: 'text-yellow-600', ic: 'text-yellow-500' },
    { label: 'En riesgo +3m', val: d.actividad.inactivos, icon: AlertTriangle, accent: 'border-l-red-500', num: 'text-red-600', ic: 'text-red-500' },
  ] : [];

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-8">
        <div className="flex items-center gap-2">
          {esEmpresa && <Building2 className="w-7 h-7 text-blue-600" />}
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Insights{d ? ` — ${d.alcance}` : ''}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Resumen del mes, clientes en riesgo y acciones sugeridas.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {generatedAt && !loading && (
            <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded-full px-2.5 py-1">
              {new Date(generatedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {/* Selector de vendedor (neutro por default) */}
          <div className="relative">
            <select
              value={vendedor}
              onChange={(e) => setVendedor(e.target.value)}
              className="appearance-none cursor-pointer pl-3 pr-8 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg shadow-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition"
            >
              <option value="">Filtrar por vendedor…</option>
              {vendedores.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 transition"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Regenerar
          </button>
        </div>
      </div>

      {error && <p className="mb-6 text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{error}</p>}

      {/* KPI cards */}
      {d && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {kpis.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.label} className={`bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 ${c.accent} p-4 hover:shadow-md transition-shadow`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{c.label}</span>
                  <Icon className={`w-4 h-4 ${c.ic}`} />
                </div>
                <p className={`text-4xl font-bold tabular-nums mt-1 ${c.num}`}>{c.val}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Loading inicial */}
      {loading && !payload && (
        <div className="flex items-center gap-2.5 text-sm text-gray-500 py-10 justify-center">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Generando informe con IA…
        </div>
      )}

      {/* Cuerpo del insight */}
      {d && (
        <div className="space-y-6">
          {/* Resumen de actividad */}
          <SectionCard title="Resumen de actividad">
            <Prose lines={sectionText(sections, 'actividad')} />
          </SectionCard>

          {/* Clientes en riesgo → chips */}
          <SectionCard title={`Clientes en riesgo (${d.churn.count})`}>
            {d.churn.top.length === 0 ? (
              <p className="text-sm text-gray-400">Sin clientes en riesgo. 🎉</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {d.churn.top.map((c) => (
                  <span key={c.pdv_id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-xs border border-red-100">
                    <span className="font-medium">{c.razon_social ?? `#${c.pdv_id}`}</span>
                    {c.localidad && <span className="text-red-400">· {c.localidad}</span>}
                  </span>
                ))}
                {d.churn.count > d.churn.top.length && (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs">
                    +{d.churn.count - d.churn.top.length} más
                  </span>
                )}
              </div>
            )}
          </SectionCard>

          {/* Avance vs meta → progress bars */}
          <SectionCard title="Avance vs meta">
            {d.avance.length === 0 ? (
              <p className="text-sm text-gray-400">Sin metas cargadas para este período.</p>
            ) : (
              <div className="space-y-3.5">
                {d.avance.map((a) => {
                  const col = avanceColor(a.avance_pct);
                  return (
                    <div key={a.rubro}>
                      <div className="flex justify-between items-baseline text-sm mb-1">
                        <span className="font-medium text-gray-800">{a.rubro}</span>
                        <span className={`font-semibold tabular-nums ${col.text}`}>{a.avance_pct}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, a.avance_pct))}%`, background: col.bar }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

          {/* Acciones sugeridas */}
          <SectionCard title="Acciones sugeridas para la semana">
            <Prose lines={sectionText(sections, 'acci')} />
          </SectionCard>
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}
