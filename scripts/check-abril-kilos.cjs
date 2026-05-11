const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const client = await pool.connect();

  // Total kilos por rubro en ventas (fuente)
  const ventas = await client.query(`
    SELECT rubro, ROUND(SUM(kilos)::numeric, 0) AS kilos_ventas
    FROM ventas WHERE anio = 2026 AND mes = 4
    GROUP BY rubro ORDER BY rubro
  `);
  console.log('=== ventas abril 2026 (fuente) ===');
  let totalV = 0;
  for (const r of ventas.rows) {
    console.log(`  ${r.rubro}: ${Number(r.kilos_ventas).toLocaleString('es-AR')} kg`);
    totalV += Number(r.kilos_ventas);
  }
  console.log(`  TOTAL: ${totalV.toLocaleString('es-AR')} kg`);

  // Total kilos por rubro en resumen_diario
  const resumen = await client.query(`
    SELECT rubro, ROUND(SUM(kilos)::numeric, 0) AS kilos_rd
    FROM resumen_diario WHERE EXTRACT(YEAR FROM fecha)=2026 AND EXTRACT(MONTH FROM fecha)=4
    GROUP BY rubro ORDER BY rubro
  `);
  console.log('\n=== resumen_diario abril 2026 ===');
  let totalRD = 0;
  for (const r of resumen.rows) {
    console.log(`  ${r.rubro}: ${Number(r.kilos_rd).toLocaleString('es-AR')} kg`);
    totalRD += Number(r.kilos_rd);
  }
  console.log(`  TOTAL: ${totalRD.toLocaleString('es-AR')} kg`);

  // Total neto por rubro en ventas
  const neto = await client.query(`
    SELECT rubro, ROUND(SUM(neto)::numeric, 0) AS neto_total
    FROM ventas WHERE anio = 2026 AND mes = 4
    GROUP BY rubro ORDER BY rubro
  `);
  console.log('\n=== neto (facturacion) abril 2026 ===');
  for (const r of neto.rows) {
    console.log(`  ${r.rubro}: $${Number(r.neto_total).toLocaleString('es-AR')}`);
  }

  client.release();
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
