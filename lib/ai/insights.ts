// ---------------------------------------------------------------------------
// Insights por vendedor (Módulo 3). Solo server-side.
//
// Los DATOS se calculan con SQL/algoritmo (actividad, churn, avance vs meta);
// el LLM SOLO los redacta en un informe. Nunca inventa números.
// ---------------------------------------------------------------------------
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLLMProvider } from './provider';
import { fetchVendedorKpis } from '@/lib/calculations/queries/kpis';

export interface InsightData {
  vendedor: string;
  periodo: string;
  actividad: { total: number; activos: number; tibios: number; inactivos: number; pct_comprando: number };
  churn: { count: number; top: { pdv_id: number; razon_social: string | null; localidad: string | null; ultima_vta: string }[] };
  avance: { rubro: string; avance_pct: number; acumulado: number; meta: number | null; tendencia: number | null }[];
}

function monthsAgoISO(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Arma los datos crudos del insight de un vendedor (todo SQL/algoritmo). */
export async function buildVendedorInsightData(
  svc: SupabaseClient,
  vendedor: string,
  today: Date
): Promise<InsightData> {
  // Recencia por PDV (desde ventas)
  const { data: ud } = await svc.rpc('pdvs_ultima_vta');
  const ult = new Map<number, string>();
  for (const r of (ud as { pdv_id: number; ultima: string }[] | null) ?? []) {
    if (r?.pdv_id != null && r.ultima) ult.set(r.pdv_id, r.ultima);
  }
  const m1 = monthsAgoISO(1);
  const m3 = monthsAgoISO(3);

  const { data: pdvs } = await svc
    .from('pdvs')
    .select('id, razon_social, localidad')
    .eq('activo', true)
    .eq('cartera', vendedor);

  let activos = 0, tibios = 0, inactivos = 0;
  const rojos: { pdv_id: number; razon_social: string | null; localidad: string | null; ultima_vta: string }[] = [];
  for (const p of pdvs ?? []) {
    const u = ult.get(p.id) ?? null;
    const d = u?.slice(0, 10);
    if (d && d >= m1) activos++;
    else if (d && d >= m3) tibios++;
    else { inactivos++; rojos.push({ pdv_id: p.id, razon_social: p.razon_social, localidad: p.localidad, ultima_vta: u ?? 'sin registro' }); }
  }
  const total = (pdvs ?? []).length;
  rojos.sort((a, b) => (a.ultima_vta === 'sin registro' ? '0' : a.ultima_vta).localeCompare(b.ultima_vta === 'sin registro' ? '0' : b.ultima_vta));

  // Avance vs meta (reutiliza la lógica existente)
  let avance: InsightData['avance'] = [];
  try {
    const kpis = await fetchVendedorKpis(vendedor, today.getFullYear(), today.getMonth() + 1, today);
    avance = kpis.map((k) => ({
      rubro: k.rubro,
      avance_pct: Math.round(k.avance_pct),
      acumulado: Math.round(k.acumulado),
      meta: k.meta != null ? Math.round(k.meta) : null,
      tendencia: k.tendencia != null ? Math.round(k.tendencia) : null,
    }));
  } catch { /* sin metas/kpis: el informe lo omite */ }

  return {
    vendedor,
    periodo: today.toISOString().slice(0, 7),
    actividad: {
      total, activos, tibios, inactivos,
      pct_comprando: total > 0 ? Math.round(((activos + tibios) / total) * 100) : 0,
    },
    churn: { count: inactivos, top: rojos.slice(0, 15) },
    avance,
  };
}

/** El LLM redacta el informe a partir de los datos (no calcula nada). */
export async function redactInsight(data: InsightData): Promise<string> {
  const provider = getLLMProvider();
  const system = [
    'Sos analista de ventas de Candysur (distribuidora de Mondelez en el GBA).',
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

/** Lee del cache o regenera (force). Devuelve payload + cuándo se generó. */
export async function getOrCreateInsight(
  svc: SupabaseClient,
  vendedor: string,
  today: Date,
  force = false
): Promise<{ payload: InsightPayload; generated_at: string }> {
  const periodo = today.toISOString().slice(0, 7);
  const scope_key = `vendedor:${vendedor}`;

  if (!force) {
    const { data: row } = await svc
      .from('ai_insights')
      .select('payload, generated_at')
      .eq('scope_key', scope_key)
      .eq('periodo', periodo)
      .single();
    if (row) return { payload: row.payload as InsightPayload, generated_at: row.generated_at };
  }

  const data = await buildVendedorInsightData(svc, vendedor, today);
  const narrative = await redactInsight(data);
  const payload: InsightPayload = { data, narrative };
  const generated_at = new Date().toISOString();
  await svc.from('ai_insights').upsert({ scope_key, periodo, payload, generated_at });
  return { payload, generated_at };
}
