// ---------------------------------------------------------------------------
// Re-geocodificación asistida por IA de los PDV imprecisos (server-side).
//
// El LLM SOLO normaliza el texto de la dirección (su fuerza), nunca produce
// coordenadas (principio §0). Las coords las da Nominatim. Procesa de a lotes
// chicos por el rate-limit de Nominatim (1 req/seg); pensado para el cron.
// ---------------------------------------------------------------------------
import type { SupabaseClient } from '@supabase/supabase-js';
import { getLLMProvider, llmAvailable } from '@/lib/ai/provider';

const UA = 'Distr2-regeocoder/1.0 (felipemiguelsainz@gmail.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CONFIDENT_KM = 6; // el geocode reemplaza al centroide si cae a <= esto de él

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface Pendiente {
  pdv_id: number; domicilio: string | null; calle: string | null; altura: string | null;
  localidad: string | null; partido: string | null; cen_lat: number; cen_lng: number;
}

async function llmNormalize(rows: Pendiente[]): Promise<Map<number, { calle: string | null; altura: string | null }>> {
  const system = [
    'Sos un normalizador de direcciones de comercios del Gran Buenos Aires (Argentina) para geocoding.',
    'Extraé calle y altura NORMALIZADAS. Expandí abreviaturas (AV→Avenida, GRAL→General, DR→Doctor, PJE→Pasaje).',
    'Reemplazá "#" por "Ñ". Separá la altura pegada. Descartá paréntesis y lo que siga a ESQ/ENTRE/PISO/DPTO/LOCAL.',
    'Mantené "Calle N" para calles numeradas. NUNCA inventes. Si no hay calle, calle:null.',
    'Devolvé SOLO un array JSON: [{"pdv_id": number, "calle": string|null, "altura": string|null}].',
  ].join('\n');
  const payload = rows.map((r) => ({ pdv_id: r.pdv_id, domicilio: r.domicilio, calle: r.calle, altura: r.altura, localidad: r.localidad, partido: r.partido }));
  const res = await getLLMProvider().chat({
    system, messages: [{ role: 'user', content: JSON.stringify(payload) }], maxTokens: 4000, temperature: 0,
  });
  let t = (res.text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('['), b = t.lastIndexOf(']');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  const map = new Map<number, { calle: string | null; altura: string | null }>();
  try {
    for (const o of JSON.parse(t) as { pdv_id: number; calle: string | null; altura: string | null }[]) {
      if (o && o.pdv_id != null) map.set(Number(o.pdv_id), { calle: o.calle || null, altura: o.altura || null });
    }
  } catch { /* respuesta no parseable → todos caen al centroide */ }
  return map;
}

async function geocode(query: string, cenLat: number, cenLng: number): Promise<{ lat: number; lng: number } | null> {
  const vb = `${(cenLng - 0.15).toFixed(4)},${(cenLat + 0.15).toFixed(4)},${(cenLng + 0.15).toFixed(4)},${(cenLat - 0.15).toFixed(4)}`;
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=ar&bounded=1&viewbox=${vb}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } });
  if (!res.ok) return null;
  const d = await res.json();
  return Array.isArray(d) && d[0] ? { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) } : null;
}

export interface FixResult { procesados: number; precisos: number; aproximados: number; pendientes_restantes: number }

/**
 * Arregla hasta `limit` PDV imprecisos (aproximados, no verificados). Cada uno
 * queda geo_verificada=true (se resuelva a calle o quede en el barrio) para no
 * reintentarlo y para que un re-upload no lo pise.
 */
export async function fixParkedGeo(svc: SupabaseClient, limit = 15): Promise<FixResult> {
  if (!llmAvailable()) return { procesados: 0, precisos: 0, aproximados: 0, pendientes_restantes: -1 };

  const { data: rows } = await svc.rpc('pdvs_geo_pendientes', { p_limit: limit });
  const pend = (rows ?? []) as Pendiente[];
  if (pend.length === 0) return { procesados: 0, precisos: 0, aproximados: 0, pendientes_restantes: 0 };

  const llm = await llmNormalize(pend);
  let precisos = 0, aproximados = 0;
  for (const r of pend) {
    const lm = llm.get(r.pdv_id);
    let lat = r.cen_lat, lng = r.cen_lng, aproximada = true;
    if (lm && lm.calle) {
      const q = `${lm.calle}${lm.altura ? ' ' + lm.altura : ''}, ${r.localidad}, Buenos Aires, Argentina`;
      const g = await geocode(q, r.cen_lat, r.cen_lng);
      await sleep(1100); // rate-limit Nominatim
      if (g && haversineKm(g.lat, g.lng, r.cen_lat, r.cen_lng) <= CONFIDENT_KM) {
        lat = g.lat; lng = g.lng; aproximada = false;
      }
    }
    await svc.from('pdvs_geo').update({ latitud: lat, longitud: lng, aproximada, geo_verificada: true, updated_at: new Date().toISOString() }).eq('pdv_id', r.pdv_id);
    if (aproximada) aproximados++; else precisos++;
  }

  const { count } = await svc.from('pdvs_geo').select('pdv_id', { count: 'exact', head: true }).eq('aproximada', true).eq('geo_verificada', false);
  return { procesados: pend.length, precisos, aproximados, pendientes_restantes: count ?? 0 };
}
