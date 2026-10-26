// Carga el maestro de PDVs corriendo local (la web tiene tope de 4,5 MB).
// Misma lógica que /api/admin/pdvs/upload, más --conservar-compradores: los PDVs
// que no vienen en el archivo pero compraron en los últimos 3 meses NO se dan de baja.
//
//   node scripts/cargar-pdvs-local.cjs "<archivo.xlsx>" [--conservar-compradores]            # dry-run
//   node scripts/cargar-pdvs-local.cjs "<archivo.xlsx>" [--conservar-compradores] --aplicar
const XLSX = require('xlsx');
const { Pool } = require('pg');
const fs = require('fs');

for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const [archivo, ...flags] = process.argv.slice(2);
const aplicar = flags.includes('--aplicar');
const conservar = flags.includes('--conservar-compradores');

const nk = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function fecha(v) {
  if (!v) return null;
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
  const s = String(v).trim(); if (!s) return null;
  const p = s.split('/');
  return p.length === 3 ? `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}` : s.slice(0, 10) || null;
}
function parse() {
  const wb = XLSX.readFile(archivo);
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const rows = new Map();
  for (const r of raw) {
    const k = Object.keys(r);
    const pk = k.find((x) => nk(x) === 'pdv'), ck = k.find((x) => nk(x).includes('codcliente'));
    const id = parseInt(String(r[pk ?? ck ?? '']), 10);
    if (!id || isNaN(id)) continue;
    const map = new Map(k.map((x) => [nk(x), r[x]]));
    const g = (...c) => { for (const n of c) { const v = map.get(nk(n)); if (v !== undefined && v !== '') return v; } return undefined; };
    const a = g('Activo');
    rows.set(id, {
      id,
      razon_social: String(g('Razon Social') ?? '').trim(),
      domicilio: String(g('Domicilio') ?? '').trim(),
      localidad: String(g('Localidad') ?? '').trim(),
      zona: String(g('Zona') ?? '').trim(),
      canal_distribucion: String(g('Canal Distribucion') ?? '').trim(),
      canal_venta: String(g('Canal Venta', 'Canal Vta') ?? '').trim(),
      categoria_iva: String(g('Categoria IVA') ?? '').trim(),
      cuit: String(g('CUIT') ?? '').trim(),
      cartera: String(g('Cartera') ?? '').trim(),
      fecha_alta: fecha(g('Fecha Alta')),
      ultima_vta: fecha(g('Ultima Vta')),
      activo: a === undefined ? true : !['false', '0', 'no'].includes(String(a).toLowerCase()),
      dia_visita: ['LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB', 'DOM'].filter((d) => String(g(d) ?? '').trim().toUpperCase() === 'S').join(',') || null,
    });
  }
  return [...rows.values()];
}

(async () => {
  const rows = parse();
  const ids = new Set(rows.map((r) => r.id));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const { rows: db } = await pool.query('SELECT id, cartera, razon_social, activo FROM pdvs');
    const m = new Map(db.map((r) => [r.id, r]));
    const { rows: comp } = await pool.query(
      `SELECT DISTINCT pdv_id FROM ventas WHERE pdv_id IS NOT NULL AND (kilos>0 OR neto>0)
         AND fecha >= (current_date - interval '3 months')::date`);
    const compran = new Set(comp.map((r) => r.pdv_id));

    const bajasTodas = db.filter((p) => p.activo && !ids.has(p.id));
    const bajas = conservar ? bajasTodas.filter((p) => !compran.has(p.id)) : bajasTodas;
    const reas = rows.filter((r) => { const o = m.get(r.id); return o && r.cartera && o.cartera !== r.cartera; });
    console.log(`archivo ${rows.length} · nuevos ${rows.filter((r) => !m.has(r.id)).length} · reasignaciones ${reas.length}`);
    console.log(`bajas según archivo ${bajasTodas.length} · se dan de baja ${bajas.length}` + (conservar ? ` · se conservan ${bajasTodas.length - bajas.length} que compraron` : ''));
    if (!aplicar) { console.log('dry-run: no se escribió nada'); return; }

    fs.mkdirSync('respaldos', { recursive: true });
    fs.writeFileSync('respaldos/pdvs_antes_de_cargar.json', JSON.stringify((await pool.query('SELECT * FROM pdvs')).rows));
    console.log('respaldo: respaldos/pdvs_antes_de_cargar.json');

    const { rows: asig } = await pool.query('SELECT cartera, vendedor_nombre FROM asignaciones ORDER BY fecha_desde DESC');
    const ult = new Map(); for (const a of asig) if (!ult.has(a.cartera)) ult.set(a.cartera, a.vendedor_nombre);

    const cols = Object.keys(rows[0]);
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const lote = rows.slice(i, i + CHUNK);
      const params = [];
      const vals = lote.map((r) => `(${cols.map((c) => { params.push(r[c]); return `$${params.length}`; }).join(',')})`);
      await pool.query(`INSERT INTO pdvs (${cols.join(',')}) VALUES ${vals.join(',')}
        ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c}=EXCLUDED.${c}`).join(',')}`, params);
    }
    console.log(`upsert ${rows.length}`);

    for (let i = 0; i < bajas.length; i += CHUNK) {
      await pool.query('UPDATE pdvs SET activo=false WHERE id = ANY($1)', [bajas.slice(i, i + CHUNK).map((b) => b.id)]);
    }
    console.log(`bajas ${bajas.length}`);

    const { rows: [{ n: geo }] } = await pool.query('SELECT cleanup_pdvs_geo_inactivos() n');
    console.log(`geo eliminada ${geo}`);

    const hoy = new Date().toISOString().slice(0, 10);
    const nuevas = new Map(reas.map((r) => [r.cartera, ult.get(r.cartera) ?? r.cartera]));
    for (const [cartera, vend] of nuevas) await pool.query('INSERT INTO asignaciones (cartera, vendedor_nombre, fecha_desde) VALUES ($1,$2,$3)', [cartera, vend, hoy]);
    console.log(`asignaciones registradas ${nuevas.size}`);

    const n = new Date();
    await pool.query('SELECT calcular_preset_ccc($1,$2)', [n.getMonth() + 1, n.getFullYear()]);
    console.log('metas CCC recalculadas');
  } finally { await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
