const { Client } = require('pg');
const c = new Client({
  connectionString: 'postgresql://postgres.ughzmwnguuzyddcbklhb:Compu2025!Rio@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
});
c.connect()
  .then(() => c.query(
    `SELECT rubro, SUM(kilos_meta)::float as kg, SUM(neto_meta)::float as neto
     FROM metas WHERE anio=2026 AND mes=5 GROUP BY rubro ORDER BY rubro`
  ))
  .then(r => {
    if (r.rows.length === 0) {
      console.log('No metas found for 2026-05');
      // Try 2025
      return c.query(`SELECT DISTINCT anio, mes FROM metas ORDER BY anio DESC, mes DESC LIMIT 5`);
    }
    r.rows.forEach(row =>
      console.log(row.rubro.padEnd(20), 'kg:', String(Math.round(row.kg)).padStart(10), 'neto:', row.neto)
    );
    return null;
  })
  .then(r2 => {
    if (r2) {
      console.log('Available periods:', r2.rows);
    }
    c.end();
  })
  .catch(e => { console.error(e.message); c.end(); });
