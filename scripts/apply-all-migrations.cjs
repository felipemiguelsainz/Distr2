// Aplica TODAS las migraciones en orden a una base de datos destino.
//
// Uso:
//   PROD_DATABASE_URL="postgresql://..." node scripts/apply-all-migrations.cjs
//   (o)  node scripts/apply-all-migrations.cjs "postgresql://..."
//
// Si no se pasa nada, usa DATABASE_URL de .env.local (¡tu base de DEV!),
// así que para producción SIEMPRE pasá la URL de prod explícitamente.

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Cargar .env.local solo como fallback de credenciales
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const target =
  process.argv[2] || process.env.PROD_DATABASE_URL || process.env.DATABASE_URL;

if (!target) {
  console.error('Falta la connection string (PROD_DATABASE_URL o arg 1).');
  process.exit(1);
}

// Orden explícito. Los numeros duplicados (019/020/021) se ordenan por
// fecha de creacion real para respetar las dependencias.
const ORDER = [
  '001_initial_schema.sql',
  '002_kpi_rpcs.sql',
  '003_metas_neto.sql',
  '004_clientes_rubro.sql',
  '005_performance_indexes.sql',
  '006_pdvs_geo.sql',
  '007_geo_upsert_rpc.sql',
  '008_metas_totales_rpc.sql',
  '009_missing_schema.sql',
  '010_clientes_activos_total.sql',
  '011_pdvs_activos_ids.sql',
  '012_home_rpcs.sql',
  '013_resumen_clientes_pdv.sql',
  '014_optimize_home_rpcs.sql',
  '015_cleanup_indexes.sql',
  '016_simplify_clientes_activos.sql',
  '017_drop_home_rpcs.sql',
  '018_recalcular_completo.sql',
  '019_audit_fixes.sql',
  '020_ccc_por_vendedor.sql',
  '021_pdvs_dia_visita.sql',
  '022_fix_ccc_por_vendedor.sql',
  '019_consolidado_productos.sql',
  '020_catalogo_productos.sql',
  '021_prod_critical_fixes.sql',
  '023_profiles_equipo.sql',
  '024_lock_down_functions.sql',
];

const dir = path.join('supabase', 'migrations');

// Chequeo de seguridad: que todos los archivos de la carpeta esten en ORDER
const onDisk = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const missing = onDisk.filter((f) => !ORDER.includes(f));
if (missing.length) {
  console.error('Hay migraciones en disco que NO estan en ORDER:', missing);
  console.error('Agregalas al array ORDER en el lugar correcto y volve a correr.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: target,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const masked = target.replace(/:\/\/([^:]+):[^@]+@/, '://$1:****@');
  console.log('Destino:', masked);
  const client = await pool.connect();
  let applied = 0;
  try {
    for (const file of ORDER) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      try {
        await client.query(sql);
        applied++;
        console.log(`  ok   ${file}`);
      } catch (e) {
        console.error(`  FAIL ${file}: ${e.message}`);
        throw e;
      }
    }
    console.log(`\nListo: ${applied}/${ORDER.length} migraciones aplicadas.`);
  } catch {
    console.error(`\nDetenido tras ${applied} migraciones. Revisa el error de arriba.`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
