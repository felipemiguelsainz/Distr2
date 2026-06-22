/**
 * Corrige PDVs mal geolocalizados en pdvs_geo usando la LOCALIDAD como verdad.
 *
 * Contexto: el re-upload de PDVs pisa pdvs_geo con las coords crudas del CSV
 * (que traen errores de geocoding: puntos en otras provincias, centroides, etc.)
 * y deja pdvs_geo.partido vacío. La fuente de verdad usable es pdvs.localidad
 * (lleno casi al 100%). Este script:
 *
 *   1. Calcula la mediana de los puntos SANOS (dentro del GBA) por localidad.
 *   2. Para localidades sin suficientes puntos sanos, geocodifica el nombre de
 *      la localidad una vez (Nominatim, sesgado al GBA).
 *   3. Marca como outlier todo punto fuera del GBA o a > UMBRAL km de la
 *      referencia de su localidad, y lo mueve a esa referencia.
 *
 * No usa la dirección (calle/altura) porque está vacía en los registros malos.
 * El resultado deja cada PDV en el barrio correcto (centro de su localidad);
 * la precisión a nivel calle requeriría direcciones, que hoy no tenemos.
 *
 * Uso:
 *   node scripts/fix-geo-outliers.cjs            # dry-run (no escribe)
 *   node scripts/fix-geo-outliers.cjs --apply    # aplica y deja backup JSON
 *   node scripts/fix-geo-outliers.cjs --km 8     # umbral de outlier (default 8)
 *
 * Requiere DATABASE_URL en .env.local.
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const kmIdx = process.argv.indexOf('--km');
const OUTLIER_KM = kmIdx > -1 ? Number(process.argv[kmIdx + 1]) : 8;
const MIN_SANE = 3; // puntos sanos mínimos para confiar en la mediana de la localidad
const UA = 'Distr2-geofix/1.0 (felipemiguelsainz@gmail.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Bounding box del Gran Buenos Aires (todos los partidos del padrón caen acá).
const GBA = { latMax: -34.2, latMin: -35.6, lngMin: -59.2, lngMax: -57.7 };
const GBA_VIEWBOX = `${GBA.lngMin},${GBA.latMax},${GBA.lngMax},${GBA.latMin}`;
const inGBA = (la, ln) => la <= GBA.latMax && la >= GBA.latMin && ln >= GBA.lngMin && ln <= GBA.lngMax;

function loadDbUrl() {
  const env = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL no encontrada en .env.local');
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}
function hv(a, b, c, d) {
  const R = 6371, r = (x) => (x * Math.PI) / 180;
  const dla = r(c - a), dln = r(d - b);
  const h = Math.sin(dla / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dln / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const median = (ns) => { const s = [...ns].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const norm = (s) => (s || '').trim().toUpperCase().replace(/#/g, 'Ñ'); // "#" = Ñ mal codificada
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function nominatim(query) {
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=ar&bounded=1&viewbox=${GBA_VIEWBOX}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

async function main() {
  const pool = new Pool({ connectionString: loadDbUrl(), ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en DB)' : 'DRY-RUN'} | umbral outlier: ${OUTLIER_KM} km\n`);

  const { rows } = await client.query(
    `SELECT g.pdv_id, g.latitud::float AS lat, g.longitud::float AS lng, p.localidad
       FROM pdvs_geo g JOIN pdvs p ON p.id = g.pdv_id AND p.activo = true
      WHERE g.latitud IS NOT NULL AND g.longitud IS NOT NULL`
  );

  // 1. medianas por localidad (puntos sanos dentro del GBA)
  const byLoc = new Map();
  for (const r of rows) { if (!inGBA(r.lat, r.lng)) continue; const l = norm(r.localidad); if (!byLoc.has(l)) byLoc.set(l, []); byLoc.get(l).push(r); }
  const refs = new Map(); // localidad -> {lat,lng,fuente}
  for (const [loc, rs] of byLoc) if (rs.length >= MIN_SANE) refs.set(loc, { lat: median(rs.map((r) => r.lat)), lng: median(rs.map((r) => r.lng)), fuente: `mediana(${rs.length})` });

  // referencia global (centro del GBA) como último recurso
  const allSane = rows.filter((r) => inGBA(r.lat, r.lng));
  const globalRef = { lat: median(allSane.map((r) => r.lat)), lng: median(allSane.map((r) => r.lng)) };

  // 2. geocodificar localidades sin mediana confiable
  const faltantes = [...new Set(rows.filter((r) => !inGBA(r.lat, r.lng) || !refs.has(norm(r.localidad))).map((r) => norm(r.localidad)))]
    .filter((l) => l && l !== '?' && !refs.has(l));
  for (const loc of faltantes) {
    try {
      const g = await nominatim(`${loc}, Buenos Aires, Argentina`);
      if (g && inGBA(g.lat, g.lng)) { refs.set(loc, { lat: g.lat, lng: g.lng, fuente: 'geocode-localidad' }); }
    } catch (e) { console.error(`  ⚠ geocode "${loc}": ${e.message}`); }
    await sleep(1100);
  }

  // 3. detectar y corregir outliers
  const refOf = (r) => refs.get(norm(r.localidad)) || { ...globalRef, fuente: 'centro-GBA' };
  const changes = [];
  for (const r of rows) {
    const ref = refOf(r);
    const fuera = !inGBA(r.lat, r.lng);
    const d = hv(r.lat, r.lng, ref.lat, ref.lng);
    if (fuera || d > OUTLIER_KM) {
      changes.push({ pdv_id: r.pdv_id, localidad: norm(r.localidad), antes: `${r.lat.toFixed(5)},${r.lng.toFixed(5)}`, despues: `${ref.lat.toFixed(5)},${ref.lng.toFixed(5)}`, km: Math.round(d), fuente: ref.fuente });
    }
  }
  changes.sort((a, b) => b.km - a.km);

  console.log(`PDVs totales: ${rows.length} | a corregir: ${changes.length}`);
  console.log('Top 12 peores:');
  console.table(changes.slice(0, 12));
  const porFuente = {}; for (const c of changes) porFuente[c.fuente] = (porFuente[c.fuente] || 0) + 1;
  console.log('Por fuente de referencia:', porFuente);

  if (!APPLY) { console.log('\nDRY-RUN: sin cambios. Corré con --apply para escribir.'); await client.release(); await pool.end(); return; }

  // backup de los registros afectados (coords originales)
  const backup = changes.map((c) => ({ pdv_id: c.pdv_id, antes: c.antes }));
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const file = path.resolve(__dirname, `geofix-backup-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log(`\nBackup: ${file}`);

  let n = 0;
  for (const c of changes) {
    const [lat, lng] = c.despues.split(',');
    await client.query('UPDATE pdvs_geo SET latitud = $1, longitud = $2, updated_at = NOW() WHERE pdv_id = $3', [lat, lng, c.pdv_id]);
    n++;
  }
  console.log(`Aplicado: ${n} PDVs actualizados.`);
  await client.release(); await pool.end();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
