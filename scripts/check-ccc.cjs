// Chequeo del CCC: la rama pre-agregada (resumen_clientes_pdv, meses completos)
// tiene que dar exactamente lo mismo que contar sobre ventas.
// Rompe si el backfill de lineas_compra quedó mal o si el resumen quedó viejo.
//
//   node scripts/check-ccc.cjs            # mes anterior completo
//   node scripts/check-ccc.cjs 2026-07
const assert = require('assert');
const { Pool } = require('pg');
const fs = require('fs');

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const arg = process.argv[2];
const hoy = new Date();
const [anio, mes] = arg
  ? arg.split('-').map(Number)
  : [hoy.getMonth() === 0 ? hoy.getFullYear() - 1 : hoy.getFullYear(), hoy.getMonth() === 0 ? 12 : hoy.getMonth()];

const mm     = String(mes).padStart(2, '0');
const desde  = `${anio}-${mm}-01`;
const hasta  = `${anio}-${mm}-${String(new Date(anio, mes, 0).getDate()).padStart(2, '0')}`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // Rama resumen (la que usa la app para un mes completo)
  const { rows: [{ v: resumen }] } = await pool.query(
    'SELECT clientes_activos_total($1, $2)::int AS v', [desde, hasta]);

  // Misma cuenta sobre ventas, sin pasar por el pre-agregado
  const { rows: [{ v: crudo }] } = await pool.query(`
    SELECT COUNT(DISTINCT pdv_id)::int AS v FROM ventas
    WHERE fecha BETWEEN $1 AND $2
      AND pdv_id IS NOT NULL AND rubro IS NOT NULL AND vendedor IS NOT NULL
      AND (kilos > 0 OR neto > 0)`, [desde, hasta]);

  console.log(`${anio}-${mm}  resumen=${resumen}  ventas=${crudo}`);
  assert.strictEqual(resumen, crudo, 'CCC del resumen != CCC sobre ventas — recalcular el período');
  console.log('ok');
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
