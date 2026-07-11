/**
 * Arregla los PDV cuya coord actual cae FUERA de su partido (mal ubicados).
 * Valida con point-in-polygon del límite real del partido (partido = la verdad, §4).
 *
 * Por cada uno: Claude normaliza la dirección → Nominatim geocodifica →
 *   - si el nuevo punto cae DENTRO del partido  -> coord precisa (aproximada=false)
 *   - si no                                       -> centroide de su localidad (aproximada=true)
 * Ambos casos mejoran sobre la coord actual (que está fuera del partido).
 * El LLM nunca produce coords (principio §0).
 *
 * Uso: node scripts/fix-geo-outliers-ai.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');
for (const l of fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');
const UA = 'Distr2-regeocoder/1.0 (felipemiguelsainz@gmail.com)';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- geometría: point-in-polygon ---
function pir(lat, lng, ring) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if (((yi > lat) != (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside; } return inside; }
function pip(lat, lng, gj) { if (!gj) return null; const polys = gj.type === 'MultiPolygon' ? gj.coordinates : [gj.coordinates]; for (const poly of polys) { if (pir(lat, lng, poly[0])) { let hole = false; for (let h = 1; h < poly.length; h++) if (pir(lat, lng, poly[h])) { hole = true; break; } if (!hole) return true; } } return false; }

async function partidoPoly(partido, provincia) {
  const name = partido === 'CAPITAL FEDERAL' ? 'Ciudad Autónoma de Buenos Aires' : `Partido de ${partido}`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&polygon_geojson=1&countrycodes=ar&q=${encodeURIComponent(name + ', ' + (provincia || 'Buenos Aires') + ', Argentina')}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } });
  if (!res.ok) return null; const d = await res.json(); return d[0]?.geojson || null;
}
async function geocode(query, cenLat, cenLng) {
  const vb = `${(cenLng - 0.15).toFixed(4)},${(cenLat + 0.15).toFixed(4)},${(cenLng + 0.15).toFixed(4)},${(cenLat - 0.15).toFixed(4)}`;
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&bounded=1&viewbox=${vb}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } });
  if (!res.ok) return null; const d = await res.json();
  return Array.isArray(d) && d[0] ? { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) } : null;
}
async function llmNormalize(rows) {
  const system = [
    'Sos un normalizador de direcciones de comercios del Gran Buenos Aires (Argentina) para geocoding.',
    'Extraé calle y altura NORMALIZADAS. Expandí abreviaturas (AV→Avenida, GRAL→General, DR→Doctor, PJE→Pasaje).',
    'Reemplazá "#" por "Ñ". Separá la altura pegada. Descartá paréntesis y lo que siga a ESQ/ENTRE/PISO/DPTO/LOCAL.',
    'Mantené "Calle N" para calles numeradas. NUNCA inventes. Si no hay calle, calle:null.',
    'Devolvé SOLO un array JSON: [{"pdv_id": number, "calle": string|null, "altura": string|null}].',
  ].join('\n');
  const map = new Map();
  for (let i = 0; i < rows.length; i += 30) {
    const chunk = rows.slice(i, i + 30).map((r) => ({ pdv_id: r.pdv_id, domicilio: r.domicilio, calle: r.calle, altura: r.altura, localidad: r.localidad, partido: r.partido }));
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, temperature: 0, system, messages: [{ role: 'user', content: JSON.stringify(chunk) }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    let t = ((await res.json()).content?.[0]?.text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('['), b = t.lastIndexOf(']'); if (a >= 0 && b > a) t = t.slice(a, b + 1);
    for (const o of JSON.parse(t)) if (o && o.pdv_id != null) map.set(Number(o.pdv_id), { calle: o.calle || null, altura: o.altura || null });
  }
  return map;
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query(`
    SELECT g.pdv_id, g.latitud::float lat, g.longitud::float lng, g.aproximada, g.partido, g.provincia,
           p.domicilio, g.calle, g.altura, p.localidad, lg.lat::float cen_lat, lg.lng::float cen_lng
    FROM pdvs_geo g JOIN pdvs p ON p.id=g.pdv_id AND p.activo
    JOIN localidades_geo lg ON lg.localidad=norm_localidad(p.localidad)
    WHERE haversine_km(g.latitud,g.longitud,lg.lat,lg.lng)>=6 AND g.partido IS NOT NULL`);

  const partidos = [...new Set(rows.map((r) => r.partido))];
  console.log(`${rows.length} outliers | bajando ${partidos.length} polígonos de partido...`);
  const poly = new Map();
  for (const pt of partidos) { poly.set(pt, await partidoPoly(pt, rows.find((r) => r.partido === pt)?.provincia)); await sleep(1100); }

  const malos = rows.filter((r) => { const gj = poly.get(r.partido); return gj && pip(r.lat, r.lng, gj) === false; });
  console.log(`Fuera de su partido (a arreglar): ${malos.length}\nNormalizando con Claude...`);
  const llm = await llmNormalize(malos);

  const cambios = [];
  for (let i = 0; i < malos.length; i++) {
    const r = malos[i]; const lm = llm.get(r.pdv_id);
    const q = lm && lm.calle ? `${lm.calle}${lm.altura ? ' ' + lm.altura : ''}, ${r.localidad}, Buenos Aires, Argentina` : null;
    let dest = { lat: r.cen_lat, lng: r.cen_lng, aproximada: true, fuente: 'centroide-localidad' };
    if (q) {
      const g = await geocode(q, r.cen_lat, r.cen_lng); await sleep(1100);
      if (g && pip(g.lat, g.lng, poly.get(r.partido))) dest = { lat: g.lat, lng: g.lng, aproximada: false, fuente: 'geocode' };
    }
    cambios.push({ pdv_id: r.pdv_id, antes: { lat: r.lat, lng: r.lng, aproximada: r.aproximada }, despues: dest, calle: lm?.calle ?? '—' });
    process.stdout.write(`\r  ${i + 1}/${malos.length}…`);
  }
  console.log('\n');
  const geo = cambios.filter((c) => c.despues.fuente === 'geocode').length;
  console.log(`Arreglados a nivel calle (in-partido): ${geo} | al centroide de barrio (aproximada): ${cambios.length - geo}`);
  console.table(cambios.slice(0, 20).map((c) => ({ pdv: c.pdv_id, calle: c.calle, fuente: c.despues.fuente, aprox: c.despues.aproximada })));

  if (APPLY && cambios.length) {
    const backup = path.resolve(__dirname, `regeocode-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`);
    fs.writeFileSync(backup, JSON.stringify(cambios, null, 2));
    console.log(`\nBackup: ${backup}`);
    const c = await pool.connect(); let n = 0;
    for (const ch of cambios) { await c.query(`UPDATE pdvs_geo SET latitud=$1, longitud=$2, aproximada=$3, updated_at=now() WHERE pdv_id=$4`, [ch.despues.lat, ch.despues.lng, ch.despues.aproximada, ch.pdv_id]); n++; }
    c.release(); console.log(`✓ ${n} PDV actualizados (fuera-de-partido corregidos).`);
  } else console.log('\nDry-run: no se escribió nada. Corré con --apply.');
  await pool.end();
}
main().catch((e) => { console.error('Error fatal:', e.message); process.exit(1); });
