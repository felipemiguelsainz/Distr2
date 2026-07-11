/**
 * Re-geocodifica los PDVs mal sitiados en pdvs_geo.
 *
 * Detecta outliers (coords lejos del centro real de su partido) y los vuelve a
 * geocodificar con Nominatim (OSM), sesgando la búsqueda al partido correcto.
 * Si el geocoding no devuelve un punto razonable, cae al centro del partido
 * (nunca al centroide de Argentina ni a la mediana corrupta de un partido chico).
 *
 * Referencia de cada partido:
 *   - mediana de sus puntos sanos (dentro del bounding box del GBA) si tiene
 *     suficientes; si no, el centro del partido geocodificado y acotado al GBA.
 *
 * Uso:
 *   node scripts/regeocode-pdvs.cjs            # dry-run: muestra qué cambiaría
 *   node scripts/regeocode-pdvs.cjs --apply    # escribe los cambios en la DB
 *   node scripts/regeocode-pdvs.cjs --km 40    # umbral de outlier (default 40)
 *
 * Requiere DATABASE_URL en .env.local. Respeta el rate-limit de Nominatim (1 req/s).
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// ---- config ----------------------------------------------------------------
const APPLY = process.argv.includes('--apply');
const kmArgIdx = process.argv.indexOf('--km');
const OUTLIER_KM = kmArgIdx > -1 ? Number(process.argv[kmArgIdx + 1]) : 40; // lejos del partido => sospechoso
const ACCEPT_KM = 45;        // geocoding válido si cae dentro de esto del centro del partido
const SANE_MEDIAN_MIN = 10;  // puntos sanos mínimos para confiar en la mediana del partido
const UA = 'Distr2-regeocoder/1.0 (felipemiguelsainz@gmail.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Bounding box del Gran Buenos Aires (todos los partidos del padrón caen acá).
// Sirve para descartar puntos corruptos y para acotar las búsquedas de Nominatim.
const GBA = { latMax: -34.2, latMin: -35.6, lngMin: -59.2, lngMax: -57.7 };
const GBA_VIEWBOX = `${GBA.lngMin},${GBA.latMax},${GBA.lngMax},${GBA.latMin}`;
const inGBA = (lat, lng) => lat <= GBA.latMax && lat >= GBA.latMin && lng >= GBA.lngMin && lng <= GBA.lngMax;

// ---- helpers ----------------------------------------------------------------
function loadDatabaseUrl() {
  const env = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8');
  const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL no encontrada en .env.local');
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Limpia el campo `calle` del maestro: abreviaturas de número, esquinas, pisos,
// y separa altura embebida ("RUCCI 589" -> calle "RUCCI", nro 589).
function cleanAddress(calle, altura) {
  let s = (calle || '').trim();
  if (!s) return null;
  s = s.split(/\s+(?:ESQ|ESQUINA|Y|E\/|ENTRE|PISO|PISO:|DPTO|DEPTO|LOCAL|KM)\b/i)[0].trim();
  // Sólo saca "N." cuando precede a un número (Nro/N°/Nº siempre). Antes `N\.?`
  // suelto se comía la N inicial de calles como NECOCHEA -> ECOCHEA.
  s = s.replace(/\b(?:NRO\.?|N[°º]|N\.(?=\s*\d))\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  let num = (altura || '').toString().trim();
  if (!num) {
    const m = s.match(/(\d{1,6})\s*$/);
    if (m) { num = m[1]; s = s.slice(0, m.index).trim(); }
  } else {
    s = s.replace(new RegExp(`\\s*${num}\\s*$`), '').trim();
  }
  return { calle: s, altura: num || null };
}

async function nominatim(query, viewbox) {
  const box = viewbox ? `&bounded=1&viewbox=${viewbox}` : '';
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=ar${box}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
}

// ---- main -------------------------------------------------------------------
async function main() {
  const pool = new Pool({ connectionString: loadDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  console.log(`Modo: ${APPLY ? 'APPLY (escribe en DB)' : 'DRY-RUN (sin cambios)'} | umbral outlier: ${OUTLIER_KM} km\n`);

  const { rows } = await client.query(
    `SELECT pdv_id, latitud::float AS lat, longitud::float AS lng, partido, provincia, calle, altura
       FROM pdvs_geo
      WHERE latitud IS NOT NULL AND longitud IS NOT NULL AND partido IS NOT NULL`
  );

  // Agrupar por partido y resolver una referencia confiable para cada uno.
  const byPartido = new Map();
  for (const r of rows) {
    if (!byPartido.has(r.partido)) byPartido.set(r.partido, []);
    byPartido.get(r.partido).push(r);
  }

  const refs = new Map(); // partido -> {lat, lng, fuente}
  for (const [partido, rs] of byPartido) {
    const sane = rs.filter((r) => inGBA(r.lat, r.lng));
    const saneRef = sane.length
      ? { lat: median(sane.map((r) => r.lat)), lng: median(sane.map((r) => r.lng)) }
      : null;
    // ¿qué tan disperso es el cluster sano? (un cluster chico pero consistente es confiable)
    const spread = saneRef ? Math.max(...sane.map((r) => haversineKm(r.lat, r.lng, saneRef.lat, saneRef.lng)), 0) : Infinity;

    if (sane.length >= SANE_MEDIAN_MIN || (sane.length >= 2 && spread <= 20)) {
      refs.set(partido, { ...saneRef, fuente: `mediana(${sane.length})` });
    } else {
      // Partido chico/corrupto: geocodificar el área administrativa ("Partido de X").
      const provincia = rs[0].provincia || 'Buenos Aires';
      const name = partido === 'CAPITAL FEDERAL'
        ? 'Ciudad Autónoma de Buenos Aires'
        : `Partido de ${partido}`;
      let ref = null;
      try {
        const g = await nominatim(`${name}, ${provincia}, Argentina`); // sin bounded: queremos el límite administrativo
        if (g && inGBA(g.lat, g.lng)) ref = { lat: g.lat, lng: g.lng, fuente: 'geocode-partido' };
      } catch (e) { /* sigue al fallback */ }
      await sleep(1100);
      if (!ref && saneRef) ref = { ...saneRef, fuente: `mediana(${sane.length})` };
      if (ref) refs.set(partido, ref);
      else console.error(`  ⚠ Sin referencia para partido ${partido} — se omite`);
    }
  }

  // Detectar outliers respecto a la referencia de su partido.
  const outliers = [];
  for (const r of rows) {
    const ref = refs.get(r.partido);
    if (!ref) continue;
    const d = haversineKm(r.lat, r.lng, ref.lat, ref.lng);
    if (d > OUTLIER_KM) outliers.push({ ...r, dist_km: Math.round(d), ref });
  }
  outliers.sort((a, b) => b.dist_km - a.dist_km);

  console.log('Referencias por partido:');
  console.table([...refs.entries()].map(([p, r]) => ({ partido: p, ref: `${r.lat.toFixed(4)},${r.lng.toFixed(4)}`, fuente: r.fuente })));
  console.log(`\nPDVs totales: ${rows.length} | a corregir: ${outliers.length}\n`);

  // Re-geocodificar cada outlier.
  const changes = [];
  for (let i = 0; i < outliers.length; i++) {
    const o = outliers[i];
    const ref = o.ref;
    const vb = `${(ref.lng - 0.5).toFixed(4)},${(ref.lat + 0.5).toFixed(4)},${(ref.lng + 0.5).toFixed(4)},${(ref.lat - 0.5).toFixed(4)}`;
    const cleaned = cleanAddress(o.calle, o.altura);

    let result = null, source = 'centro-partido';
    if (cleaned && cleaned.calle) {
      const partido = o.partido === 'CAPITAL FEDERAL' ? 'CABA' : o.partido;
      const q = `${cleaned.calle}${cleaned.altura ? ' ' + cleaned.altura : ''}, ${partido}, ${o.provincia}, Argentina`;
      try {
        const g = await nominatim(q, vb);
        if (g && haversineKm(g.lat, g.lng, ref.lat, ref.lng) <= ACCEPT_KM) { result = g; source = 'nominatim'; }
      } catch (e) {
        console.error(`  PDV ${o.pdv_id}: error geocoding (${e.message})`);
      }
      await sleep(1100);
    }

    const newLat = result ? result.lat : ref.lat;
    const newLng = result ? result.lng : ref.lng;
    changes.push({
      pdv_id: o.pdv_id, partido: o.partido, calle: o.calle,
      antes: `${o.lat.toFixed(5)},${o.lng.toFixed(5)}`,
      despues: `${newLat.toFixed(5)},${newLng.toFixed(5)}`,
      fuente: source, dist_orig_km: o.dist_km,
    });
    process.stdout.write(`\r  Procesados ${i + 1}/${outliers.length}…`);
  }
  console.log('\n');
  console.table(changes);
  const viaNominatim = changes.filter((c) => c.fuente === 'nominatim').length;
  console.log(`\nResueltos por dirección (Nominatim): ${viaNominatim} | al centro del partido: ${changes.length - viaNominatim}`);

  if (APPLY && changes.length) {
    // Backup de las coords previas para poder revertir.
    const backupPath = path.resolve(__dirname, `regeocode-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(changes.map((c) => ({ pdv_id: c.pdv_id, antes: c.antes, despues: c.despues })), null, 2));
    console.log(`\nBackup escrito en ${backupPath}`);
    let n = 0;
    for (const ch of changes) {
      const [lat, lng] = ch.despues.split(',').map(Number);
      await client.query(`UPDATE pdvs_geo SET latitud=$1, longitud=$2, updated_at=now() WHERE pdv_id=$3`, [lat, lng, ch.pdv_id]);
      n++;
    }
    console.log(`✓ ${n} PDVs actualizados en pdvs_geo.`);
  } else if (changes.length) {
    console.log('\nDry-run: nada se escribió. Volvé a correr con --apply para guardar.');
  }

  client.release();
  await pool.end();
}

main().catch((e) => { console.error('Error fatal:', e); process.exit(1); });
