const { Pool } = require('pg');
const fs = require('fs');

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/apply-migration.cjs <migration.sql>');
  process.exit(1);
}

const sql = fs.readFileSync(file, 'utf8');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('applied:', file);
  } catch (e) {
    console.error('FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
