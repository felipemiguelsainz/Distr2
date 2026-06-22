/**
 * Completa la tabla localidades_geo geocodificando las localidades que NO
 * tienen centroide por mediana (pocas, chicas). Complementa a la función SQL
 * refresh_localidades_geo() (que arma centroides por mediana de puntos sanos).
 *
 * Busca localidades de PDVs activos que faltan en localidades_geo, geocodifica
 * el nombre con Nominatim (sesgado al GBA) e inserta el centro con fuente
 * 'geocode'. Corré refresh_localidades_geo() primero (lo hace la migración 029).
 *
 * Uso:  node scripts/seed-localidades-geo.cjs            # dry-run
 *       node scripts/seed-localidades-geo.cjs --apply    # inserta
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const UA = 'Distr2-geoseed/1.0 (felipemiguelsainz@gmail.com)';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const GBA = { latMax: -34.2, latMin: -35.6, lngMin: -59.2, lngMax: -57.7 };
const GBA_VIEWBOX = `${GBA.lngMin},${GBA.latMax},${GBA.lngMax},${GBA.latMin}`;
const inGBA = (la, ln) => la <= GBA.latMax && la >= GBA.latMin && ln >= GBA.lngMin && ln <= GBA.lngMax;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dbUrl() {
  const env = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8');
  return env.split('\n').find((l) => l.startsWith('DATABASE_URL=')).slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}
async function nominatim(q) {
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=ar&bounded=1&viewbox=${GBA_VIEWBOX}&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const d = await res.json();
  return Array.isArray(d) && d.length ? { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) } : null;
}

async function main() {
  const c = new Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(`
    SELECT norm_localidad(p.localidad) loc, count(*) n
    FROM pdvs p WHERE p.activo = true AND norm_localidad(p.localidad) <> ''
      AND norm_localidad(p.localidad) NOT IN (SELECT localidad FROM localidades_geo)
    GROUP BY 1 ORDER BY 2 DESC`);
  console.log(`Localidades faltantes: ${rows.length} | modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  let ok = 0, fail = 0;
  for (const r of rows) {
    let g = null;
    try { g = await nominatim(`${r.loc}, Buenos Aires, Argentina`); } catch (e) { console.error(`  ⚠ ${r.loc}: ${e.message}`); }
    await sleep(1100);
    if (g && inGBA(g.lat, g.lng)) {
      console.log(`  ✓ ${r.loc} (${r.n} PDVs) -> ${g.lat.toFixed(5)},${g.lng.toFixed(5)}`);
      if (APPLY) {
        await c.query(
          `INSERT INTO localidades_geo (localidad, lat, lng, n_puntos, fuente, updated_at)
           VALUES ($1,$2,$3,$4,'geocode',now())
           ON CONFLICT (localidad) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, fuente='geocode', updated_at=now()`,
          [r.loc, g.lat, g.lng, r.n]
        );
      }
      ok++;
    } else {
      console.error(`  ✗ ${r.loc} (${r.n} PDVs): sin resultado en GBA`);
      fail++;
    }
  }
  console.log(`\n${APPLY ? 'Insertadas' : 'Geocodificables'}: ${ok} | fallidas: ${fail}`);
  await c.end();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
