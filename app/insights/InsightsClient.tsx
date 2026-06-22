'use client';

import { useState, useEffect, useCallback } from 'react';

interface InsightData {
  vendedor: string;
  periodo: string;
  actividad: { total: number; activos: number; tibios: number; inactivos: number; pct_comprando: number };
  churn: { count: number; top: { pdv_id: number; razon_social: string | null; localidad: string | null; ultima_vta: string }[] };
  avance: { rubro: string; avance_pct: number; acumulado: number; meta: number | null; tendencia: number | null }[];
}
interface Payload { data: InsightData; narrative: string }

// Render mínimo de markdown (encabezados ##, bullets -, **negrita**).
function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5">
      {lines.map((ln, i) => {
        const bold = (s: string) =>
          s.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith('**') && part.endsWith('**')
              ? <strong key={j} className="font-semibold text-[#09090b]">{part.slice(2, -2)}</strong>
              : <span key={j}>{part}</span>);
        if (ln.startsWith('## ')) return <h3 key={i} className="text-[14px] font-bold text-[#09090b] mt-3">{ln.slice(3)}</h3>;
        if (/^[-*]\s/.test(ln)) return <li key={i} className="ml-4 list-disc text-[13px] text-[#27272a]">{bold(ln.replace(/^[-*]\s/, ''))}</li>;
        if (ln.trim() === '') return null;
        return <p key={i} className="text-[13px] text-[#27272a]">{bold(ln)}</p>;
      })}
    </div>
  );
}

export function InsightsClient({ vendedores }: { vendedores: string[] }) {
  const [vendedor, setVendedor] = useState(vendedores[0] ?? '');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (regenerar = false) => {
    if (!vendedor) return;
    setLoading(true);
    setError(null);
    if (regenerar) setPayload(null);
    try {
      const res = regenerar
        ? await fetch('/api/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendedor }) })
        : await fetch(`/api/insights?vendedor=${encodeURIComponent(vendedor)}`);
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

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-2">
        {vendedores.length > 1 && (
          <select
            value={vendedor}
            onChange={(e) => setVendedor(e.target.value)}
            className="px-3 py-1.5 text-[12px] rounded-[8px] border border-[#e4e4e7] bg-white text-[#09090b] min-w-[200px]"
          >
            {vendedores.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="px-3 py-1.5 text-[12px] font-semibold rounded-[8px] bg-[#0c5cab] text-white hover:bg-[#0a4f95] transition-colors disabled:opacity-60"
        >
          {loading ? 'Generando…' : 'Regenerar'}
        </button>
        {generatedAt && !loading && (
          <span className="text-[11px] text-[#a1a1aa]">Generado {new Date(generatedAt).toLocaleString('es-AR')}</span>
        )}
      </div>

      {error && <p className="text-[13px] text-[#dc2626] bg-[#dc2626]/[0.08] border border-[#dc2626]/20 px-3 py-2 rounded-[10px]">{error}</p>}

      {/* Tarjetas de actividad (datos exactos, calculados por SQL) */}
      {d && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {[
            { label: 'PDVs', val: d.actividad.total, color: '#09090b' },
            { label: 'Activos (≤1m)', val: d.actividad.activos, color: '#16a34a' },
            { label: 'Tibios (1-3m)', val: d.actividad.tibios, color: '#eab308' },
            { label: 'En riesgo (+3m)', val: d.actividad.inactivos, color: '#dc2626' },
          ].map((c) => (
            <div key={c.label} className="rounded-[12px] border border-[#e4e4e7] bg-white px-3 py-2.5">
              <p className="text-[20px] font-bold tabular-nums" style={{ color: c.color }}>{c.val}</p>
              <p className="text-[11px] text-[#71717a]">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Informe redactado por IA */}
      {loading && !payload && (
        <div className="flex items-center gap-2.5 text-[13px] text-[#71717a] py-6">
          <span className="w-4 h-4 rounded-full border-2 border-[#e4e4e7] border-t-[#0c5cab] animate-spin" />
          Generando informe con IA…
        </div>
      )}
      {payload?.narrative && (
        <div className="rounded-[14px] border border-[#e4e4e7] bg-white px-4 py-3.5">
          <Markdown text={payload.narrative} />
        </div>
      )}
    </div>
  );
}
