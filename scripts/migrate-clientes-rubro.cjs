// scripts/migrate-clientes-rubro.cjs
// Applies the clientes_compra_rubro RPC to Supabase.
const { Client } = require('pg');

const CONN = 'postgresql://postgres.ughzmwnguuzyddcbklhb:Compu2025!Rio@aws-1-us-east-1.pooler.supabase.com:5432/postgres';

const SQL = `
CREATE OR REPLACE FUNCTION clientes_compra_rubro(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS TABLE(rubro text, clientes bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    rubro,
    COUNT(DISTINCT pdv_id)::bigint AS clientes
  FROM ventas
  WHERE fecha BETWEEN p_desde AND p_hasta
    AND (p_vendedores IS NULL OR vendedor = ANY(p_vendedores))
  GROUP BY rubro
  ORDER BY rubro
$$;
`;

async function main() {
  const c = new Client({ connectionString: CONN, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const res = await c.query(SQL);
  console.log('Done:', res.command);
  await c.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
