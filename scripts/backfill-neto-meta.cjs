/**
 * Backfill neto_meta for existing metas rows.
 * Reverses the kg conversion: neto_meta = kilos_meta × (april_neto / april_kg per rubro)
 * This is the same rate that was used when the user originally entered $ objectives.
 */
const { Client } = require('pg');

const DB = 'postgresql://postgres.ughzmwnguuzyddcbklhb:Compu2025!Rio@aws-1-us-east-1.pooler.supabase.com:5432/postgres';

async function run() {
  const c = new Client({ connectionString: DB, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // 1. Get all distinct (anio, mes) pairs that have null neto_meta for mondelez rubros
  const periodsRes = await c.query(`
    SELECT DISTINCT anio, mes FROM metas
    WHERE neto_meta IS NULL
    ORDER BY anio, mes
  `);
  console.log('Periods to backfill:', periodsRes.rows);

  for (const { anio, mes } of periodsRes.rows) {
    // prev month
    const prevMes  = mes === 1 ? 12 : mes - 1;
    const prevAnio = mes === 1 ? anio - 1 : anio;
    const desde    = `${prevAnio}-${String(prevMes).padStart(2,'0')}-01`;
    const lastDay  = new Date(prevAnio, prevMes, 0).getDate();
    const hasta    = `${prevAnio}-${String(prevMes).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

    // 2. Get $/kg per rubro from resumen_diario for prev month
    const rateRes = await c.query(`
      SELECT rubro, SUM(neto)::float as neto, SUM(kilos)::float as kg
      FROM resumen_diario
      WHERE fecha >= $1 AND fecha <= $2
      GROUP BY rubro
    `, [desde, hasta]);

    const rates = new Map();
    for (const r of rateRes.rows) {
      if (r.kg > 0) rates.set(r.rubro, r.neto / r.kg);
    }
    console.log(`\nPeriod ${anio}-${mes} (prev: ${prevAnio}-${prevMes}):`);
    rates.forEach((rate, rubro) => console.log(`  ${rubro.padEnd(20)}: $${rate.toFixed(0)}/kg`));

    // 3. Update neto_meta = kilos_meta × $/kg for rows that have a known rate
    const updateRes = await c.query(`
      UPDATE metas m
      SET neto_meta = m.kilos_meta * rates.rate
      FROM (
        SELECT rubro, SUM(neto)::float / NULLIF(SUM(kilos), 0) as rate
        FROM resumen_diario
        WHERE fecha >= $1 AND fecha <= $2
        GROUP BY rubro
      ) rates
      WHERE m.anio = $3 AND m.mes = $4
        AND m.rubro = rates.rubro
        AND m.neto_meta IS NULL
      RETURNING m.rubro, m.vendedor_nombre, m.kilos_meta, m.neto_meta
    `, [desde, hasta, anio, mes]);

    console.log(`  Updated ${updateRes.rowCount} rows`);

    // Show per-rubro totals
    const checkRes = await c.query(`
      SELECT rubro, SUM(kilos_meta)::float as kg, SUM(neto_meta)::float as neto
      FROM metas WHERE anio=$1 AND mes=$2 AND neto_meta IS NOT NULL
      GROUP BY rubro ORDER BY rubro
    `, [anio, mes]);
    checkRes.rows.forEach(r =>
      console.log(`  ${r.rubro.padEnd(20)} kg: ${Math.round(r.kg).toString().padStart(8)} → $${(r.neto/1e6).toFixed(1)}M`)
    );
  }

  await c.end();
  console.log('\nDone.');
}

run().catch(e => { console.error(e.message); process.exit(1); });
