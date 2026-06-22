// ---------------------------------------------------------------------------
// Insights por alcance (Módulo 3). Solo server-side.
//
// El alcance puede ser un vendedor, un equipo o toda la empresa (admin). Los
// DATOS se calculan con SQL/algoritmo (actividad, churn, avance vs meta); el
// LLM SOLO los redacta. Nunca inventa números.
// ---------------------------------------------------------------------------
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLLMProvider } from './provider';
import type { KpiRubro } from '@/lib/types';

export interface InsightAvance {
  rubro: string; avance_pct: number; acumulado: number; meta: number | null; tendencia: number | null;
}
export interface InsightData {
  alcance: string;            // etiqueta legible: nombre del vendedor o "Total Empresa"
  periodo: string;
  actividad: { total: number; activos: number; tibios: number; inactivos: number; pct_comprando: number };
  churn: { count: number; top: { pdv_id: number; razon_social: string | null; localidad: string | null; ultima_vta: string }[] };
  avance: InsightAvance[];
}

function monthsAgoISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Convierte KpiRubro[] (de fetch*Kpis) al formato de avance del insight. */
export function avanceFromKpis(kpis: KpiRubro[]): InsightAvance[] {
  return kpis.map((k) => ({
    rubro: k.rubro,
    avance_pct: Math.round(k.avance_pct),
    acumulado: Math.round(k.acumulado),
    meta: k.meta != null ? Math.round(k.meta) : null,
    tendencia: k.tendencia != null ? Math.round(k.tendencia) : null,
  }));
}

/**
 * Arma los datos del insight para un alcance (todo SQL/algoritmo).
 * `carteras`: lista de carteras a incluir, o null = todas (empresa).
 * `avance`: ya calculado por el llamador (según el rol/alcance).
 */
export async function buildInsightData(
  svc: SupabaseClient,
  opts: { label: string; carteras: string[] | null; avance: InsightAvance[]; today: Date }
): Promise<InsightData> {
  const { label, carteras, avance, today } = opts;

  // Recencia por PDV (desde ventas)
  const { data: ud } = await svc.rpc('pdvs_ultima_vta');
  const ult = new Map<number, string>();
  for (const r of (ud as { pdv_id: number; ultima: string }[] | null) ?? []) {
    if (r?.pdv_id != null && r.ultima) ult.set(r.pdv_id, r.ultima);
  }
  const m1 = monthsAgoISO(1);
  const m3 = monthsAgoISO(3);

  // Paginar para superar el límite de filas de PostgREST (la vista empresa
  // tiene ~7000 PDVs; sin paginar se cortaría en 1000 y subcontaría).
  const PAGE = 1000;
  const pdvs: { id: number; razon_social: string | null; localidad: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = svc.from('pdvs').select('id, razon_social, localidad').eq('activo', true).range(from, from + PAGE - 1);
    if (carteras !== null) q = q.in('cartera', carteras.length ? carteras : ['__none__']);
    const { data } = await q;
    if (!data || data.length === 0) break;
    pdvs.push(...data);
    if (data.length < PAGE) break;
  }

  let activos = 0, tibios = 0, inactivos = 0;
  const rojos: InsightData['churn']['top'] = [];
  for (const p of pdvs ?? []) {
    const u = ult.get(p.id) ?? null;
    const d = u?.slice(0, 10);
    if (d && d >= m1) activos++;
    else if (d && d >= m3) tibios++;
    else { inactivos++; rojos.push({ pdv_id: p.id, razon_social: p.razon_social, localidad: p.localidad, ultima_vta: u ?? 'sin registro' }); }
  }
  const total = (pdvs ?? []).length;
  const key = (s: string) => (s === 'sin registro' ? '0' : s);
  rojos.sort((a, b) => key(a.ultima_vta).localeCompare(key(b.ultima_vta)));

  return {
    alcance: label,
    periodo: today.toISOString().slice(0, 7),
    actividad: { total, activos, tibios, inactivos, pct_comprando: total > 0 ? Math.round(((activos + tibios) / total) * 100) : 0 },
    churn: { count: inactivos, top: rojos.slice(0, 15) },
    avance,
  };
}

/** El LLM redacta el informe a partir de los datos (no calcula nada). */
export async function redactInsight(data: InsightData): Promise<string> {
  const provider = getLLMProvider();
  const system = [
    'Sos analista de ventas de Candysur (distribuidora de Mondelez en el GBA).',
    `El informe corresponde a: «${data.alcance}» (puede ser un vendedor puntual o el total de la empresa).`,
    'Redactá un informe BREVE en español rioplatense a partir del JSON de datos.',
    'Usá SOLO los números del JSON; no inventes ni estimes nada que no esté.',
    'Estructura en markdown con estas secciones y bullets concisos:',
    '## Resumen de actividad',
    '## Clientes en riesgo (cuántos y a cuáles priorizar)',
    '## Avance vs meta (si hay datos)',
    '## Acciones sugeridas para la semana',
    'Si una sección no tiene datos, decilo en una línea en vez de inventar.',
  ].join('\n');
  const res = await provider.chat({
    system,
    messages: [{ role: 'user', content: JSON.stringify(data) }],
    maxTokens: 700,
    temperature: 0.3,
  });
  return res.text ?? '';
}

export interface InsightPayload { data: InsightData; narrative: string }

/** Lee del cache o regenera (force). */
export async function getOrCreateInsight(
  svc: SupabaseClient,
  opts: { scopeKey: string; label: string; carteras: string[] | null; avance: InsightAvance[]; today: Date; force?: boolean }
): Promise<{ payload: InsightPayload; generated_at: string }> {
  const periodo = opts.today.toISOString().slice(0, 7);

  if (!opts.force) {
    const { data: row } = await svc
      .from('ai_insights')
      .select('payload, generated_at')
      .eq('scope_key', opts.scopeKey)
      .eq('periodo', periodo)
      .single();
    if (row) return { payload: row.payload as InsightPayload, generated_at: row.generated_at };
  }

  const data = await buildInsightData(svc, opts);
  const narrative = await redactInsight(data);
  const payload: InsightPayload = { data, narrative };
  const generated_at = new Date().toISOString();
  await svc.from('ai_insights').upsert({ scope_key: opts.scopeKey, periodo, payload, generated_at });
  return { payload, generated_at };
}
