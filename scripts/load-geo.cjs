/**
 * Carga masiva de geolocalización (pdvs_geo) desde el maestro geolocalizado.
 * Replica el endpoint UI (RPC bulk_upsert_pdvs_geo con validación por localidad, mig. 029),
 * pero pensado para el bootstrap de una base vacía, donde localidades_geo aún no existe.
 *
 * Hace 3 pasos:
 *   1) bulk_upsert_pdvs_geo  -> keep (GBA) / reject (outliers, sin centroide de referencia)
 *   2) refresh_localidades_geo -> calcula centroides por localidad desde lo recién cargado
 *   3) bulk_upsert_pdvs_geo  -> ahora corrige los outliers contra esos centroides
 *
 * Uso:
 *   node scripts/load-geo.cjs --file "C:/ruta/PUNTOS DE VENTAS ACTIVOS 8-07.xlsx"
 *
 * Lee DATABASE_URL de .env.local (igual que apply-all-migrations.cjs).
 */

const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const XLSX = require('xlsx');
const { Pool } = require('pg');

const fileArg = (() => { const i = process.argv.indexOf('--file'); return i >= 0 ? process.argv[i + 1] : null; })();
if (!fileArg) { console.error('Uso: node scripts/load-geo.cjs --file <ruta.xlsx>'); process.exit(1); }
const file = path.resolve(fileArg);
if (!fs.existsSync(file)) { console.error('No existe:', file); process.exit(1); }

// --- Parseo de columnas tolerante (mismo criterio que CargarClient.tsx) ---
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
const normKey = (s) => s.toLowerCase().normalize('NFD').replace(DIACRITICS, '').replace(/[\s._]/g, '');
function rowGetter(r) {
  const map = new Map();
  for (const k of Object.keys(r)) map.set(normKey(k), r[k]);
  return (...cs) => { for (const c of cs) { const v = map.get(normKey(c)); if (v !== undefined && v !== '') return v; } return undefined; };
}
function pickPdvId(r) {
  const keys = Object.keys(r);
  const p = keys.find((k) => normKey(k) === 'pdv');
  const c = keys.find((k) => normKey(k).includes('codcliente'));
  return parseInt(String(r[p ?? c ?? ''] ?? ''), 10);
}
function parseSerialDate(val) {
  if (!val) return null;
  if (typeof val === 'number' && val > 0) {
    try { const d = XLSX.SSF.parse_date_code(val); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
    catch { return null; }
  }
  const s = String(val).trim();
  return s ? s.slice(0, 10) : null;
}

const wb = XLSX.readFile(file, { cellDates: false });
const sheet = wb.Sheets[wb.SheetNames[0]];
const raw = XLSX.utils.sheet_to_json(sheet, { defval: '' });

const rows = [];
for (const r of raw) {
  const pdv_id = pickPdvId(r);
  if (!pdv_id || isNaN(pdv_id)) continue;
  const g = rowGetter(r);
  const lat = parseFloat(String(g('LATITUD') ?? ''));
  const lng = parseFloat(String(g('LONGITUD') ?? ''));
  if (isNaN(lat) || lat === 0 || isNaN(lng) || lng === 0) continue;
  const ruteableRaw = String(g('Ruteable') ?? '').toLowerCase();
  rows.push({
    pdv_id,
    partido:   String(g('Partido')   ?? '').trim() || null,
    provincia: String(g('Provincia') ?? '').trim() || null,
    calle:     String(g('Calle')     ?? '').trim() || null,
    altura:    String(g('Altura')    ?? '').trim() || null,
    entre1:    String(g('Entre1')    ?? '').trim() || null,
    entre2:    String(g('Entre2')    ?? '').trim() || null,
    latitud:   lat,
    longitud:  lng,
    ruteable:  ruteableRaw === 'si' || ruteableRaw === 's' ? true : (ruteableRaw === 'no' || ruteableRaw === 'n' ? false : null),
    domicilio_geo: String(g('Domicilio_GEO') ?? '').trim() || null,
    fecha_geo: parseSerialDate(g('Fecha_GEO')),
    hora_geo:  String(g('Hora_GEO') ?? '').trim() || null,
  });
}
console.log(`Archivo: ${file}`);
console.log(`Filas con coordenadas: ${rows.length}`);

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const c = await pool.connect();
  const payload = JSON.stringify(rows);
  try {
    console.log('\nPasada 1 — upsert (keep GBA / reject outliers)...');
    const r1 = await c.query('SELECT bulk_upsert_pdvs_geo($1::jsonb) AS res', [payload]);
    console.log('  ', JSON.stringify(r1.rows[0].res));

    console.log('Refrescando localidades_geo (centroides por localidad)...');
    const rl = await c.query('SELECT refresh_localidades_geo() AS n');
    console.log('   localidades con centroide:', rl.rows[0].n);

    console.log('Pasada 2 — upsert (corrige outliers contra centroides)...');
    const r2 = await c.query('SELECT bulk_upsert_pdvs_geo($1::jsonb) AS res', [payload]);
    console.log('  ', JSON.stringify(r2.rows[0].res));

    const cnt = await c.query('SELECT count(*)::int AS n FROM pdvs_geo');
    console.log(`\n✓ pdvs_geo total: ${cnt.rows[0].n}`);
  } catch (e) {
    console.error('FALLO:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})();
