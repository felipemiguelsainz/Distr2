/**
 * Re-geocodifica los PDV "parkeados" en el centroide de su localidad (imprecisos)
 * usando Claude para NORMALIZAR la dirección (mejor que el regex; ver piloto) y
 * Nominatim para geocodificar. El LLM nunca produce coordenadas (principio §0).
 *
 * Valida cada resultado por cercanía al centroide de la localidad:
 *   <= CONFIDENT_KM  -> alta confianza  -> se aplica (con --apply)
 *   CONFIDENT..MAX   -> dudoso          -> se marca "revisar", NO se aplica
 *   sin resultado / lejos -> se deja el centroide actual
 *
 * Uso:
 *   node scripts/regeocode-centroides.cjs             # dry-run
 *   node scripts/regeocode-centroides.cjs --apply     # aplica los de alta confianza (con backup)
 *
 * Requiere DATABASE_URL + ANTHROPIC_API_KEY en .env.local. Rate-limit Nominatim 1 req/s.
 */
const fs = require('fs');
const path = require('path');
for (const l of fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const UA = 'Distr2-regeocoder/1.0 (felipemiguelsainz@gmail.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const CONFIDENT_KM = 6;   // <= esto del centroide => aplicar
const MAX_KM = 15;        // entre CONFIDENT y esto => "revisar"; > esto => descartar
const LLM_CHUNK = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function llmNormalize(rows) {
  const system = [
    'Sos un normalizador de direcciones de comercios del Gran Buenos Aires (Argentina) para geocoding.',
    'Para cada ítem extraé calle y altura NORMALIZADAS. Reglas:',
    '- Expandí abreviaturas: AV/AV.→Avenida, GRAL→General, DR→Doctor, PJE→Pasaje, INT→Intendente, PTE→Presidente, CNEL→Coronel.',
    '- Reemplazá "#" por "Ñ" (viene mal codificado del maestro).',
    '- Separá la altura si viene pegada ("ROMA 3281" → calle "Roma", altura "3281").',
    '- Descartá aclaraciones entre paréntesis y todo lo que siga a ESQ/ENTRE/E//PISO/DPTO/LOCAL/KM.',
    '- Mantené las calles numeradas: "CALLE 413 Nº 1635" → calle "Calle 413", altura "1635".',
    '- NUNCA inventes calle ni número que no esté. Si no hay calle usable, calle:null.',
    'Devolvé SOLO un array JSON: [{"pdv_id": number, "calle": string|null, "altura": string|null}].',
  ].join('\n');
  const map = new Map();
  for (let i = 0; i < rows.length; i += LLM_CHUNK) {
    const chunk = rows.slice(i, i + LLM_CHUNK);
    const payload = chunk.map((r) => ({ pdv_id: r.pdv_id, domicilio: r.domicilio, calle: r.calle, altura: r.altura, localidad: r.localidad, partido: r.partido }));
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, temperature: 0, system, messages: [{ role: 'user', content: JSON.stringify(payload) }] }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    let t = (data.content?.[0]?.text ?? '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = t.indexOf('['), b = t.lastIndexOf(']');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
    for (const o of JSON.parse(t)) if (o && o.pdv_id != null) map.set(Number(o.pdv_id), { calle: o.calle || null, altura: o.altura || null });
    process.stdout.write(`\r  Claude ${Math.min(i + LLM_CHUNK, rows.length)}/${rows.length}…`);
  }
  console.log('');
  return map;
}

async function nominatim(query, cenLat, cenLng) {
  const vb = `${(cenLng - 0.15).toFixed(4)},${(cenLat + 0.15).toFixed(4)},${(cenLng + 0.15).toFixed(4)},${(cenLat - 0.15).toFixed(4)}`;
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=ar&bounded=1&viewbox=${vb}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const d = await res.json();
  if (!Array.isArray(d) || d.length === 0) return null;
  return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const { rows } = await pool.query(`
    SELECT g.pdv_id, p.razon_social, p.domicilio, g.calle, g.altura, p.localidad, g.partido,
           g.latitud::float AS lat, g.longitud::float AS lng, lg.lat::float AS cen_lat, lg.lng::float AS cen_lng
    FROM pdvs_geo g JOIN pdvs p ON p.id=g.pdv_id
    JOIN localidades_geo lg ON lg.localidad=norm_localidad(p.localidad)
    WHERE abs(g.latitud-lg.lat)<0.0002 AND abs(g.longitud-lg.lng)<0.0002 AND p.activo
    ORDER BY g.pdv_id`);

  console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'} | ${rows.length} PDV parkeados en centroide | modelo: ${MODEL}\n`);
  console.log('Normalizando direcciones con Claude...');
  const llm = await llmNormalize(rows);

  const apply = [], revisar = [], quedan = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lm = llm.get(r.pdv_id);
    const q = lm && lm.calle ? `${lm.calle}${lm.altura ? ' ' + lm.altura : ''}, ${r.localidad}, Buenos Aires, Argentina` : null;
    let rec = { pdv_id: r.pdv_id, calle: lm?.calle ?? '—', motivo: 'sin calle' };
    if (q) {
      try {
        const g = await nominatim(q, r.cen_lat, r.cen_lng);
        if (g) {
          const d = haversineKm(g.lat, g.lng, r.cen_lat, r.cen_lng);
          rec = { pdv_id: r.pdv_id, calle: lm.calle, altura: lm.altura, lat: g.lat, lng: g.lng, dist_km: +d.toFixed(1) };
          if (d <= CONFIDENT_KM) apply.push(rec);
          else if (d <= MAX_KM) revisar.push(rec);
          else quedan.push({ ...rec, motivo: `lejos ${d.toFixed(1)}km` });
        } else quedan.push({ ...rec, motivo: 'sin resultado' });
      } catch (e) { quedan.push({ ...rec, motivo: e.message }); }
      await sleep(1100);
    } else quedan.push(rec);
    process.stdout.write(`\r  Geocode ${i + 1}/${rows.length}…`);
  }
  console.log('\n');
  console.log(`Alta confianza (<=${CONFIDENT_KM}km, se aplican): ${apply.length}`);
  console.log(`Dudosos (${CONFIDENT_KM}-${MAX_KM}km, revisar a mano):   ${revisar.length}`);
  console.log(`Quedan en centroide (sin geocode / lejos):     ${quedan.length}`);
  if (revisar.length) { console.log('\n-- Dudosos (revisar) --'); console.table(revisar.slice(0, 20)); }
  console.log('\n-- Muestra de alta confianza --'); console.table(apply.slice(0, 15));

  if (APPLY && apply.length) {
    const backup = path.resolve(__dirname, `regeocode-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`);
    const prev = new Map(rows.map((r) => [r.pdv_id, { lat: r.lat, lng: r.lng }]));
    fs.writeFileSync(backup, JSON.stringify(apply.map((c) => ({ pdv_id: c.pdv_id, antes: prev.get(c.pdv_id), despues: { lat: c.lat, lng: c.lng } })), null, 2));
    console.log(`\nBackup: ${backup}`);
    const client = await pool.connect();
    let n = 0;
    for (const c of apply) { await client.query(`UPDATE pdvs_geo SET latitud=$1, longitud=$2, aproximada=false, geo_verificada=true, updated_at=now() WHERE pdv_id=$3`, [c.lat, c.lng, c.pdv_id]); n++; }
    client.release();
    console.log(`✓ ${n} PDV actualizados en pdvs_geo (los dudosos y sin-geocode quedaron intactos).`);
  } else {
    console.log('\nDry-run: no se escribió nada. Corré con --apply para guardar los de alta confianza.');
  }
  await pool.end();
}
main().catch((e) => { console.error('Error fatal:', e.message); process.exit(1); });
