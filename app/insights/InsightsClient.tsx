'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users, UserCheck, Clock, AlertTriangle, RefreshCw, TrendingUp, TrendingDown, MapPin,
  ChevronDown, ArrowRight, Check, Building2,
} from 'lucide-react';

type CardTipo = 'RECUPERACIÓN' | 'CRECIMIENTO' | 'COBERTURA' | 'ALERTA';
interface ClienteRef { pdv_id: number; razon_social: string | null; localidad: string | null; ultima_vta: string; valor_mensual: number }
type EnfriandoseRef = ClienteRef & { cadencia_dias: number; dias_sin: number };
interface InsightCard {
  tipo: CardTipo; accion: string; metrica: string; detalle: string; pasos: string[]; cta: string; pdv_ids: number[];
}
interface InsightData {
  alcance: string;
  actividad: { total: number; activos: number; tibios: number; inactivos: number; pct_comprando: number };
  churn: { count: number; valor_total: number; top: ClienteRef[] };
  enfriandose: { count: number; valor_total: number; top: EnfriandoseRef[] };
  cross_sell: { rubro: string; n_no_compran: number; valor_estimado: number; clientes: ClienteRef[] }[];
  tendencia: { rubro: string; pct: number | null; este: number; aa: number }[];
}
interface Payload { data: InsightData; cards: InsightCard[] }

// $ compacto (es-AR): 164283 -> "$164 mil", 1500000 -> "$1,5 M"
function fmtPesos(n: number): string {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)} mil`;
  return `$${n}`;
}

// Config visual por tipo de card (paleta del proyecto).
const TIPO_CFG: Record<CardTipo, { icon: typeof RefreshCw; color: string; bg: string; border: string }> = {
  'RECUPERACIÓN': { icon: RefreshCw,     color: '#d97706', bg: 'bg-amber-50',   border: 'border-l-amber-500' },
  'CRECIMIENTO':  { icon: TrendingUp,    color: '#16a34a', bg: 'bg-green-50',   border: 'border-l-green-500' },
  'COBERTURA':    { icon: MapPin,        color: '#0c5cab', bg: 'bg-blue-50',    border: 'border-l-blue-500' },
  'ALERTA':       { icon: AlertTriangle, color: '#dc2626', bg: 'bg-red-50',     border: 'border-l-red-500' },
};

function hace(iso: string | null): string {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

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
  const esEmpresa = !vendedor;

  const kpis = d ? [
    { label: 'Total PDVs', val: d.actividad.total, icon: Users, accent: 'border-l-slate-400', num: 'text-slate-800', ic: 'text-slate-400' },
    { label: 'Activos ≤1m', val: d.actividad.activos, icon: UserCheck, accent: 'border-l-green-500', num: 'text-green-600', ic: 'text-green-500' },
    { label: 'Tibios 1-3m', val: d.actividad.tibios, icon: Clock, accent: 'border-l-yellow-500', num: 'text-yellow-600', ic: 'text-yellow-500' },
    { label: 'En riesgo +3m', val: d.actividad.inactivos, icon: AlertTriangle, accent: 'border-l-red-500', num: 'text-red-600', ic: 'text-red-500', sub: d.churn.valor_total > 0 ? `${fmtPesos(d.churn.valor_total)}/mes en juego` : undefined },
  ] as { label: string; val: number; icon: typeof Users; accent: string; num: string; ic: string; sub?: string }[] : [];

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:justify-between gap-3 mb-8">
        <div className="flex items-center gap-2 min-w-0">
          {esEmpresa && <Building2 className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600 shrink-0" />}
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 break-words">
              Insights{d ? ` — ${d.alcance}` : ''}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Acciones priorizadas por impacto.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {generatedAt && !loading && (
            <span className="text-xs text-gray-500 bg-white border border-gray-200 rounded-full px-2.5 py-1">
              {hace(generatedAt)}
            </span>
          )}
          <div className="relative flex-1 sm:flex-none min-w-[150px]">
            <select
              value={vendedor}
              onChange={(e) => setVendedor(e.target.value)}
              className="w-full appearance-none cursor-pointer pl-3 pr-8 py-2 text-sm font-medium text-gray-900 bg-white border border-gray-200 rounded-lg shadow-sm hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition"
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
                <p className={`text-3xl sm:text-4xl font-bold tabular-nums mt-1 ${c.num}`}>{c.val}</p>
                {c.sub && <p className="text-[11px] text-red-500 font-medium mt-0.5">{c.sub}</p>}
              </div>
            );
          })}
        </div>
      )}

      {/* Alerta temprana: clientes enfriándose */}
      {d && d.enfriandose?.count > 0 && (
        <div className="mb-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800 flex-1">
            <strong>{d.enfriandose.count} clientes enfriándose</strong> — todavía compran pero rompieron su frecuencia
            {d.enfriandose.valor_total > 0 && <> · <strong>{fmtPesos(d.enfriandose.valor_total)}/mes en juego</strong></>}.
            Contactalos antes de que se apaguen.
          </p>
          <a href={`/insights/enfriandose${vendedor ? `?vendedor=${encodeURIComponent(vendedor)}` : ''}`} className="shrink-0 text-sm font-semibold text-amber-800 hover:text-amber-900 whitespace-nowrap">
            Ver todos →
          </a>
        </div>
      )}

      {/* Tendencia vs año pasado (por rubro, a igual día del mes) */}
      {d && (d.tendencia ?? []).some((a) => a.pct != null) && (
        <div className="mb-6 bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-3.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tendencia vs año pasado <span className="normal-case font-normal text-gray-400">(a igual día del mes)</span></p>
          <div className="flex flex-wrap gap-2">
            {(d.tendencia ?? []).filter((a) => a.pct != null).map((a) => {
              const up = (a.pct as number) >= 0;
              const Icon = up ? TrendingUp : TrendingDown;
              return (
                <span key={a.rubro} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${up ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-gray-700">{a.rubro}</span>
                  <span className="font-semibold tabular-nums">{up ? '+' : ''}{a.pct}%</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Loading inicial */}
      {loading && !payload && (
        <div className="flex items-center gap-2.5 text-sm text-gray-500 py-10 justify-center">
          <RefreshCw className="w-4 h-4 animate-spin" />
          Generando acciones con IA…
        </div>
      )}

      {/* Action cards */}
      {payload && (
        <div className="space-y-3">
          {payload.cards.length === 0 ? (
            <p className="text-sm text-gray-400">No hay acciones sugeridas para este período.</p>
          ) : (() => {
            const clientes = new Map<number, ClienteRef>(
              [
                ...(payload.data.churn.top ?? []),
                ...(payload.data.enfriandose?.top ?? []),
                ...(payload.data.cross_sell ?? []).flatMap((o) => o.clientes ?? []),
              ].map((c) => [c.pdv_id, c])
            );
            return payload.cards.map((card, i) => (
              <ActionCard key={i} card={card} when={hace(generatedAt)} vendedor={vendedor} clientes={clientes} />
            ));
          })()}
        </div>
      )}
    </div>
  );
}

function ActionCard({ card, when, vendedor, clientes }: { card: InsightCard; when: string; vendedor: string; clientes: Map<number, ClienteRef> }) {
  const [open, setOpen] = useState(false);
  const refClientes = (card.pdv_ids ?? []).map((id) => clientes.get(id)).filter((c): c is ClienteRef => !!c);
  const [done, setDone] = useState(false);
  const cfg = TIPO_CFG[card.tipo];
  const Icon = cfg.icon;

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 ${cfg.border} overflow-hidden transition-all ${done ? 'opacity-50' : 'hover:shadow-md'}`}>
      <div className="p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg" style={{ background: cfg.color + '14' }}>
            <Icon className="w-4 h-4" style={{ color: cfg.color }} />
          </span>
          <span className="text-xs font-semibold tracking-wide" style={{ color: cfg.color }}>{card.tipo}</span>
          {when && <span className="text-xs text-gray-400">• {when}</span>}
        </div>

        <p className={`text-base font-semibold text-gray-900 ${done ? 'line-through' : ''}`}>{card.accion}</p>

        <div className="flex items-center justify-between mt-2.5">
          {card.metrica
            ? <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: cfg.color + '14', color: cfg.color }}>{card.metrica}</span>
            : <span />}
          {/* El CTA (ver detalle/clientes) solo tiene sentido por vendedor */}
          {vendedor ? (
            <button
              onClick={() => setOpen((o) => !o)}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 transition"
            >
              {card.cta}
              <ArrowRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className="text-xs text-gray-400">Seleccioná un vendedor para ver detalle</span>
          )}
        </div>
      </div>

      {/* Panel expandible (solo en vista por vendedor) */}
      <div className={`grid transition-all duration-300 ease-in-out ${open && vendedor ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-1 border-t border-gray-100">
            {card.detalle && (
              <p className="text-sm text-gray-600 mt-3">
                <span className="font-semibold text-gray-800">Por qué: </span>{card.detalle}
              </p>
            )}
            {card.pasos.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Pasos sugeridos</p>
                <ol className="space-y-1">
                  {card.pasos.map((p, j) => (
                    <li key={j} className="text-sm text-gray-700 flex gap-2">
                      <span className="font-semibold text-gray-400">{j + 1}.</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {refClientes.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Clientes ({refClientes.length})</p>
                <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {refClientes.map((c) => (
                    <div key={c.pdv_id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span className="min-w-0">
                        <span className="block text-sm text-gray-900 truncate">#{c.pdv_id} — {c.razon_social ?? 's/n'}</span>
                        <span className="block text-xs text-gray-500">
                          {c.localidad ?? '—'} · {c.ultima_vta === 'sin registro' ? 'sin compras' : `últ: ${c.ultima_vta.slice(0, 10)}`}
                        </span>
                      </span>
                      {c.valor_mensual > 0 && (
                        <span className="shrink-0 text-xs font-semibold text-gray-700" title="Facturaba por mes">
                          {fmtPesos(c.valor_mensual)}<span className="text-gray-400 font-normal">/mes</span>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {refClientes.length > 0 && (
                <a
                  href={`/mapa?pdvs=${refClientes.map((c) => c.pdv_id).join(',')}${vendedor ? `&vendedor=${encodeURIComponent(vendedor)}` : ''}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
                >
                  <MapPin className="w-4 h-4" />
                  Ver en mapa
                </a>
              )}
              <button
                onClick={() => { setDone((v) => !v); setOpen(false); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 transition"
              >
                <Check className="w-4 h-4" />
                {done ? 'Marcar como pendiente' : 'Marcar como gestionado'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
