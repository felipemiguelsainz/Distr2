// Run once: adds neto_meta column to metas table
const { Client } = require('pg');

const client = new Client({
  connectionString: 'postgresql://postgres.ughzmwnguuzyddcbklhb:Compu2025!Rio@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await client.connect();
  const res = await client.query(
    'ALTER TABLE metas ADD COLUMN IF NOT EXISTS neto_meta NUMERIC DEFAULT NULL'
  );
  console.log('Done:', res.command);
  await client.end();
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
