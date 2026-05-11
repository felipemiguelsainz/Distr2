const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const client = await pool.connect();
  const r = await client.query(
    "SELECT MAX(fecha)::text AS ultimo, COUNT(DISTINCT fecha) AS dias FROM ventas WHERE anio = 2026 AND mes = 4"
  );
  console.log('Ultimo dia:', r.rows[0].ultimo);
  console.log('Dias con data:', r.rows[0].dias);
  const dias = await client.query(
    "SELECT DISTINCT fecha::text AS f FROM ventas WHERE anio = 2026 AND mes = 4 ORDER BY f"
  );
  console.log('Dias:', dias.rows.map(r => r.f).join(', '));
  client.release();
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
