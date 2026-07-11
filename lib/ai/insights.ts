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
export interface TendenciaRubro {
  rubro: string; pct: number | null; este: number; aa: number; // vs año pasado, a igual día del mes
}
export interface ChurnCliente {
  pdv_id: number; razon_social: string | null; localidad: string | null; ultima_vta: string;
  valor_mensual: number; // $ que facturaba por mes cuando compraba (últ. 12m)
  kg_mensual?: number;   // kg/mes (solo lo puebla computeEnfriandose)
}
export interface EnfriandoseCliente extends ChurnCliente {
  cadencia_dias: number; // cada cuántos días compra habitualmente
  dias_sin: number;      // días desde la última compra
}
export interface InsightData {
  alcance: string;            // etiqueta legible: nombre del vendedor o "Total Empresa"
  periodo: string;
  actividad: { total: number; activos: number; tibios: number; inactivos: number; pct_comprando: number };
  churn: { count: number; valor_total: number; top: ChurnCliente[] }; // valor_total = $/mes en juego
  // Clientes que rompieron su frecuencia (todavía "activos" pero se enfrían):
  enfriandose: { count: number; valor_total: number; top: EnfriandoseCliente[] };
  // Cross-sell: rubros fuertes que clientes activos no compran (oportunidad).
  cross_sell: { rubro: string; n_no_compran: number; valor_estimado: number; clientes: ChurnCliente[] }[];
  tendencia: TendenciaRubro[]; // vs año pasado, a igual día del mes
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
  const m1 = monthsAgoISO(1);
  const m3 = monthsAgoISO(3);
  const diasDesde = (iso: string) => Math.round((today.getTime() - new Date(iso).getTime()) / 86_400_000);

  // Paginado de PDVs del scope (supera el límite de 1000 de PostgREST).
  const fetchPdvs = async () => {
    const PAGE = 1000;
    const acc: { id: number; razon_social: string | null; localidad: string | null }[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = svc.from('pdvs').select('id, razon_social, localidad').eq('activo', true).range(from, from + PAGE - 1);
      if (carteras !== null) q = q.in('cartera', carteras.length ? carteras : ['__none__']);
      const { data } = await q;
      if (!data || data.length === 0) break;
      acc.push(...data);
      if (data.length < PAGE) break;
    }
    return acc;
  };

  // Todas las fuentes son independientes → en paralelo (la generación es pesada).
  const [udRes, vdRes, cdRes, csRes, tdRes, pdvs] = await Promise.all([
    svc.rpc('pdvs_ultima_vta'),
    svc.rpc('pdvs_valor_12m'),
    svc.rpc('pdvs_cadencia'),
    svc.rpc('cross_sell', { p_carteras: carteras }),
    svc.rpc('tendencia_anual', { p_carteras: carteras }),
    fetchPdvs(),
  ]);

  // Si la recencia falla (timeout), TODO caería como "en riesgo": abortar para
  // no cachear un insight roto (el endpoint devuelve error y se puede reintentar).
  if (udRes.error) throw new Error(`Recencia no disponible: ${udRes.error.message}`);

  const ult = new Map<number, string>();
  for (const r of (udRes.data as { pdv_id: number; ultima: string }[] | null) ?? []) {
    if (r?.pdv_id != null && r.ultima) ult.set(r.pdv_id, r.ultima);
  }
  const valor = new Map<number, number>();
  for (const r of (vdRes.data as { pdv_id: number; neto_12m: number; meses: number }[] | null) ?? []) {
    if (r?.pdv_id != null) valor.set(r.pdv_id, Math.round(Number(r.neto_12m) / Math.max(1, Number(r.meses))));
  }
  const cad = new Map<number, { cadencia: number; ultima: string }>();
  for (const r of (cdRes.data as { pdv_id: number; cadencia: number; ultima: string }[] | null) ?? []) {
    if (r?.pdv_id != null && r.cadencia) cad.set(r.pdv_id, { cadencia: Number(r.cadencia), ultima: r.ultima });
  }

  let activos = 0, tibios = 0, inactivos = 0;
  const rojos: ChurnCliente[] = [];
  const enfri: EnfriandoseCliente[] = [];
  for (const p of pdvs ?? []) {
    const u = ult.get(p.id) ?? null;
    const d = u?.slice(0, 10);
    if (d && d >= m1) activos++;
    else if (d && d >= m3) tibios++;
    else {
      inactivos++;
      rojos.push({ pdv_id: p.id, razon_social: p.razon_social, localidad: p.localidad, ultima_vta: u ?? 'sin registro', valor_mensual: valor.get(p.id) ?? 0 });
    }
    // Enfriándose: alerta temprana (ver esEnfriandose).
    const c = cad.get(p.id);
    if (c) {
      const ds = diasDesde(c.ultima);
      if (esEnfriandose(c.cadencia, ds)) {
        enfri.push({ pdv_id: p.id, razon_social: p.razon_social, localidad: p.localidad, ultima_vta: c.ultima, valor_mensual: valor.get(p.id) ?? 0, cadencia_dias: c.cadencia, dias_sin: ds });
      }
    }
  }
  const total = (pdvs ?? []).length;
  // Ordenar por PLATA EN JUEGO (valor mensual histórico), no por fecha.
  rojos.sort((a, b) => b.valor_mensual - a.valor_mensual);
  enfri.sort((a, b) => b.valor_mensual - a.valor_mensual);

  // Cross-sell: enriquecer los pdv_ids del RPC con nombre/localidad/valor.
  const nameMap = new Map((pdvs ?? []).map((p) => [p.id, p]));
  const cross_sell = ((csRes.data as { rubro: string; n_no_compran: number; valor_estimado: number; pdv_ids: number[] }[] | null) ?? [])
    .map((o) => ({
      rubro: o.rubro,
      n_no_compran: o.n_no_compran,
      valor_estimado: o.valor_estimado,
      clientes: (o.pdv_ids ?? [])
        .map((id) => {
          const p = nameMap.get(id);
          return p ? { pdv_id: id, razon_social: p.razon_social, localidad: p.localidad, ultima_vta: ult.get(id) ?? 'sin registro', valor_mensual: valor.get(id) ?? 0 } : null;
        })
        .filter((c): c is ChurnCliente => c !== null),
    }));

  const tendencia = ((tdRes.data as { rubro: string; pct: number | null; este: number; aa: number }[] | null) ?? [])
    .map((t) => ({ rubro: t.rubro, pct: t.pct, este: Number(t.este), aa: Number(t.aa) }));

  return {
    alcance: label,
    periodo: today.toISOString().slice(0, 7),
    actividad: { total, activos, tibios, inactivos, pct_comprando: total > 0 ? Math.round(((activos + tibios) / total) * 100) : 0 },
    churn: { count: inactivos, valor_total: rojos.reduce((a, r) => a + r.valor_mensual, 0), top: rojos.slice(0, 15) },
    enfriandose: { count: enfri.length, valor_total: enfri.reduce((a, r) => a + r.valor_mensual, 0), top: enfri.slice(0, 15) },
    cross_sell,
    tendencia,
    avance,
  };
}

// --- Action cards (salida estructurada del LLM) ----------------------------
export type CardTipo = 'RECUPERACIÓN' | 'CRECIMIENTO' | 'COBERTURA' | 'ALERTA';
export interface InsightCard {
  tipo: CardTipo;
  accion: string;       // acción concreta, imperativa, 1 línea
  metrica: string;      // etiqueta corta para el badge
  detalle: string;      // por qué (1-2 oraciones)
  pasos: string[];      // pasos sugeridos
  cta: string;          // "Ver clientes" | "Ver productos" | "Ver ruta" | "Ver detalle"
  pdv_ids: number[];    // PDVs concretos a los que se refiere (del churn.top)
}

const CARD_TIPOS: CardTipo[] = ['RECUPERACIÓN', 'CRECIMIENTO', 'COBERTURA', 'ALERTA'];

// Parseo defensivo: el modelo puede envolver el JSON en ```...``` o agregar texto.
function parseCards(raw: string): InsightCard[] {
  let s = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  let arr: unknown;
  try { arr = JSON.parse(s); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c): c is Record<string, unknown> => !!c && typeof (c as Record<string, unknown>).accion === 'string')
    .slice(0, 5)
    .map((c) => ({
      tipo: CARD_TIPOS.includes(c.tipo as CardTipo) ? (c.tipo as CardTipo) : 'ALERTA',
      accion: String(c.accion),
      metrica: String(c.metrica ?? ''),
      detalle: String(c.detalle ?? ''),
      pasos: Array.isArray(c.pasos) ? c.pasos.map((p) => String(p)).slice(0, 6) : [],
      cta: String(c.cta ?? 'Ver detalle'),
      pdv_ids: Array.isArray(c.pdv_ids)
        ? (c.pdv_ids as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0).slice(0, 8)
        : [],
    }));
}

/** El LLM genera action cards (JSON) a partir de los datos. No calcula números. */
export async function generateCards(data: InsightData): Promise<InsightCard[]> {
  const provider = getLLMProvider();
  const system = [
    'Sos un asistente comercial para un equipo de ventas de distribución (Candysur / Mondelez, GBA).',
    `Los datos corresponden a: «${data.alcance}».`,
    'Analizá los datos y generá insights ACCIONABLES en español rioplatense.',
    'Usá SOLO los números del JSON; no inventes ni estimes nada que no esté.',
    'PRIORIZÁ POR PLATA: churn.top viene ordenado por valor_mensual ($/mes que',
    'facturaba cada cliente apagado). Enfocá las acciones en los de mayor valor y',
    'cuantificá en $ (usá valor_mensual y churn.valor_total como "$/mes en juego").',
    'ALERTA TEMPRANA: enfriandose.top son clientes que TODAVÍA compran pero',
    'rompieron su frecuencia (compran cada cadencia_dias y hace dias_sin que no).',
    'Generá una card para contactarlos YA y NO perderlos (es más fácil que recuperar',
    'un apagado); priorizá por valor_mensual y mencioná el $/mes en juego.',
    'CROSS-SELL (CRECIMIENTO): cross_sell lista rubros fuertes que clientes activos',
    'NO compran (n_no_compran clientes, valor_estimado de oportunidad mensual, y',
    'clientes ejemplo). Generá cards de venta nueva: "X clientes no te compran',
    '<rubro> → ~$Y/mes"; poné sus pdv_ids en la card.',
    'TENDENCIA: tendencia[] trae pct (variación vs el año pasado por rubro, a',
    'igual día del mes). Si un rubro cae fuerte (pct muy negativo) generá una',
    'ALERTA; si crece fuerte, una de CRECIMIENTO. Mencioná el % vs año pasado.',
    'Respondé SOLO con un array JSON válido (sin markdown, sin texto extra) con este schema por item:',
    '{ "tipo": "RECUPERACIÓN" | "CRECIMIENTO" | "COBERTURA" | "ALERTA", "accion": string, "metrica": string, "detalle": string, "pasos": string[], "cta": "Ver clientes" | "Ver productos" | "Ver ruta" | "Ver detalle", "pdv_ids": number[] }',
    '- accion: imperativa, 1 línea. metrica: etiqueta corta para un badge (ej: "5 clientes", "28 en riesgo").',
    '- detalle: 1-2 oraciones del porqué. pasos: 2 a 4 pasos concretos.',
    '- pdv_ids: si la acción se refiere a clientes puntuales, listá los pdv_id EXACTOS tomados del churn.top de los datos (máximo 8). Si no aplica, dejá [].',
    'Máximo 5 insights, ordenados por impacto. Si no hay datos para algo, no lo incluyas.',
  ].join('\n');
  const res = await provider.chat({
    system,
    messages: [{ role: 'user', content: JSON.stringify(data) }],
    maxTokens: 4000, // 5 cards con pasos + pdv_ids; a 1400 Haiku truncaba el JSON (→ 0 cards)
    temperature: 0.3,
  });
  return parseCards(res.text ?? '');
}

export interface InsightPayload { data: InsightData; cards: InsightCard[] }

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
  const cards = await generateCards(data);
  const payload: InsightPayload = { data, cards };
  const generated_at = new Date().toISOString();
  await svc.from('ai_insights').upsert({ scope_key: opts.scopeKey, periodo, payload, generated_at });
  return { payload, generated_at };
}

// --- Enfriándose: predicado + cómputo de la lista completa (para su página) --
// Compra regular (cadencia 3–35 días), pero hace >2x su cadencia que no compra
// y sigue dentro de 90 días (aún "activo" por el corte plano) → alerta temprana.
export function esEnfriandose(cadencia: number, diasSin: number): boolean {
  return cadencia >= 3 && cadencia <= 35 && diasSin >= 2 * cadencia && diasSin <= 90;
}

export type EnfriandoseConCartera = EnfriandoseCliente & { cartera: string | null };

/** Lista COMPLETA de clientes enfriándose del scope (carteras=null = todas). */
export async function computeEnfriandose(
  svc: SupabaseClient,
  carteras: string[] | null,
  today: Date
): Promise<EnfriandoseConCartera[]> {
  const PAGE = 1000;
  const pdvs: { id: number; razon_social: string | null; localidad: string | null; cartera: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = svc.from('pdvs').select('id, razon_social, localidad, cartera').eq('activo', true).range(from, from + PAGE - 1);
    if (carteras !== null) q = q.in('cartera', carteras.length ? carteras : ['__none__']);
    const { data } = await q;
    if (!data || data.length === 0) break;
    pdvs.push(...data);
    if (data.length < PAGE) break;
  }

  const [vdRes, cdRes] = await Promise.all([svc.rpc('pdvs_valor_12m'), svc.rpc('pdvs_cadencia')]);
  const valor = new Map<number, number>();
  const kilos = new Map<number, number>();
  for (const r of (vdRes.data as { pdv_id: number; neto_12m: number; kilos_12m: number; meses: number }[] | null) ?? []) {
    if (r?.pdv_id != null) {
      const meses = Math.max(1, Number(r.meses));
      valor.set(r.pdv_id, Math.round(Number(r.neto_12m) / meses));
      kilos.set(r.pdv_id, Math.round(Number(r.kilos_12m ?? 0) / meses));
    }
  }
  const cad = new Map<number, { cadencia: number; ultima: string }>();
  for (const r of (cdRes.data as { pdv_id: number; cadencia: number; ultima: string }[] | null) ?? []) {
    if (r?.pdv_id != null && r.cadencia) cad.set(r.pdv_id, { cadencia: Number(r.cadencia), ultima: r.ultima });
  }
  const diasDesde = (iso: string) => Math.round((today.getTime() - new Date(iso).getTime()) / 86_400_000);

  const out: EnfriandoseConCartera[] = [];
  for (const p of pdvs) {
    const c = cad.get(p.id);
    if (!c) continue;
    const ds = diasDesde(c.ultima);
    if (esEnfriandose(c.cadencia, ds)) {
      out.push({ pdv_id: p.id, razon_social: p.razon_social, localidad: p.localidad, cartera: p.cartera, ultima_vta: c.ultima, valor_mensual: valor.get(p.id) ?? 0, kg_mensual: kilos.get(p.id) ?? 0, cadencia_dias: c.cadencia, dias_sin: ds });
    }
  }
  out.sort((a, b) => b.valor_mensual - a.valor_mensual);
  return out;
}
