// Arma gramaje_sku desde "Info Logística Productos.xlsx" (KG/BULTO correcto) y
// el maestro de artículos (Peso Neto que usó el ERP), y corrige la historia.
//
//   node scripts/cargar-gramaje.cjs "<logistica.xlsx>" "<maestro-articulos.xlsx>"            # dry-run
//   node scripts/cargar-gramaje.cjs "<logistica.xlsx>" "<maestro-articulos.xlsx>" --aplicar
// Requiere la migración 051 aplicada.
const XLSX = require('xlsx');
const { Pool } = require('pg');
const fs = require('fs');
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const [fLog, fMae, flag] = process.argv.slice(2);
const aplicar = flag === '--aplicar';
const nd = (x) => String(x).toUpperCase().replace(/\s+/g, ' ').trim();

(async () => {
  const lg = XLSX.utils.sheet_to_json(XLSX.readFile(fLog).Sheets.Sheet1, { range: 1, defval: '' });
  const wbm = XLSX.readFile(fMae);
  const ma = XLSX.utils.sheet_to_json(wbm.Sheets[wbm.SheetNames[0]], { defval: '' });
  const mp = new Map(ma.map((r) => [nd(r['Descripción']), r]));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  pool.on('connect', (c) => c.query("SET statement_timeout = '30min'"));
  try {
    const { rows: art } = await pool.query(
      `WITH obs AS (
         SELECT sku, percentile_cont(0.5) WITHIN GROUP (ORDER BY kilos/unidades) kg_unidad_obs
           FROM ventas WHERE kilos > 0 AND unidades > 0 AND fecha >= '2026-01-01' GROUP BY sku),
       ult AS (
         SELECT DISTINCT ON (sku) sku, articulo FROM ventas
          WHERE sku IS NOT NULL AND fecha >= '2026-01-01' ORDER BY sku, fecha DESC)
       SELECT ult.sku, ult.articulo, obs.kg_unidad_obs FROM ult LEFT JOIN obs USING (sku)`);
    const bySku = new Map(art.map((a) => [String(a.sku), a]));

    const aplicables = [], omitidos = [];
    for (const r of lg) {
      const sku = String(r['CODIGO SKU']), kgb = Number(r['KG/BULTO']);
      const a = bySku.get(sku), m = a && mp.get(nd(a.articulo));
      if (!a || !m) { omitidos.push([sku, r['DESCRIPCION'], 'sin match en ventas/maestro']); continue; }
      const pn = Number(m['Peso Neto (Kg)']), uxb = Number(m['UxB']) || 1;
      if (!(pn > 0) || !(kgb > 0)) { omitidos.push([sku, r['DESCRIPCION'], 'peso inválido']); continue; }
      if (Math.abs(kgb - pn) <= 0.02 * Math.max(kgb, pn)) continue; // ya coinciden
      const obs = Number(a.kg_unidad_obs);
      if (obs && Math.abs(obs * uxb - pn) > 0.1 * pn) { omitidos.push([sku, r['DESCRIPCION'], `el ERP usó ${(obs * uxb).toFixed(3)} y no ${pn}`]); continue; }
      aplicables.push({ sku, descripcion: r['DESCRIPCION'], kg_bulto_erp: pn, kg_bulto_correcto: kgb });
    }
    console.log(`a corregir ${aplicables.length} · omitidos ${omitidos.length}`);
    for (const o of omitidos) console.log('  omitido', o.join(' | '));

    const skus = aplicables.map((a) => a.sku);
    const { rows: [t] } = await pool.query(
      `SELECT count(*) n, round(sum(kilos)) kg FROM ventas WHERE sku = ANY($1)`, [skus]);
    const { rows: [e] } = await pool.query(
      `SELECT round(sum(v.kilos * (a.c/a.e - 1))) delta FROM ventas v
         JOIN unnest($1::text[], $2::numeric[], $3::numeric[]) AS a(sku,e,c) ON a.sku = v.sku`,
      [skus, aplicables.map((a) => a.kg_bulto_erp), aplicables.map((a) => a.kg_bulto_correcto)]);
    const { rows: [tot] } = await pool.query('SELECT round(sum(kilos)) kg FROM ventas');
    console.log(`filas de ventas afectadas ${t.n} · kg actuales de esos SKUs ${t.kg} · cambio ${e.delta} (de ${tot.kg} kg totales)`);
    if (!aplicar) { console.log('dry-run: no se escribió nada'); return; }

    fs.mkdirSync('respaldos', { recursive: true });
    const { rows: resp } = await pool.query('SELECT id, sku, kilos FROM ventas WHERE sku = ANY($1)', [skus]);
    fs.writeFileSync('respaldos/ventas_kilos_antes_de_gramaje.json', JSON.stringify(resp));
    console.log(`respaldo de ${resp.length} filas: respaldos/ventas_kilos_antes_de_gramaje.json`);

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM gramaje_sku');
      for (const a of aplicables)
        await c.query('INSERT INTO gramaje_sku (sku, descripcion, kg_bulto_erp, kg_bulto_correcto) VALUES ($1,$2,$3,$4)',
          [a.sku, a.descripcion, a.kg_bulto_erp, a.kg_bulto_correcto]);
      // La historia se corrige con el trigger apagado: ya tiene el kilo crudo del ERP.
      await c.query('ALTER TABLE ventas DISABLE TRIGGER trg_aplicar_gramaje');
      const r = await c.query(
        `UPDATE ventas v SET kilos_erp = v.kilos, kilos = v.kilos * g.factor
           FROM gramaje_sku g WHERE g.sku = v.sku AND v.kilos_erp IS NULL`);
      await c.query('ALTER TABLE ventas ENABLE TRIGGER trg_aplicar_gramaje');
      await c.query('COMMIT');
      console.log(`ventas corregidas ${r.rowCount}`);
    } catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); }

    // Recalcular los resúmenes de las fechas/meses tocados.
    const { rows: fechas } = await pool.query(`SELECT DISTINCT to_char(fecha,'YYYY-MM-DD') f FROM ventas WHERE kilos_erp IS NOT NULL ORDER BY 1`);
    const lista = fechas.map((x) => x.f);
    for (let i = 0; i < lista.length; i += 40) await pool.query('SELECT recalcular_resumen_diario($1::date[])', [lista.slice(i, i + 40)]);
    const periodos = [...new Set(lista.map((f) => f.slice(0, 7)))];
    for (const p of periodos) await pool.query('SELECT recalcular_resumen_clientes_pdv($1::text[])', [[p]]);
    console.log(`resúmenes recalculados: ${lista.length} días, ${periodos.length} meses`);
  } finally { await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
