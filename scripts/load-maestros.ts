/**
 * Carga el maestro de vendedores desde el .xlsb y reconstruye resumen_diario.
 *
 * Uso:
 *   npx ts-node -P tsconfig.scripts.json scripts/load-maestros.ts --file ./data/maestrovendedodores.xlsb
 */

import * as XLSX from 'xlsx';
import { Pool } from 'pg';
import * as path from 'path';
import * as fs from 'fs';

function parseArgs() {
  const args = process.argv.slice(2);
  let file = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[i + 1];
  }
  if (!file) {
    console.error('Uso: npx ts-node -P tsconfig.scripts.json scripts/load-maestros.ts --file <ruta>');
    process.exit(1);
  }
  const absFile = path.resolve(file);
  if (!fs.existsSync(absFile)) {
    console.error(`Archivo no encontrado: ${absFile}`);
    process.exit(1);
  }
  return { file: absFile };
}

const str = (v: unknown) => (v == null ? '' : String(v).trim());

async function main() {
  const { file } = parseArgs();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  console.log(`Archivo: ${file}`);
  console.log('Conectado.\n');

  // Read xlsb
  const wb = XLSX.readFile(file, { cellDates: false });

  // Find vendedores sheet
  const sheetName = wb.SheetNames.find(
    (n) => n.toLowerCase().includes('vendedor')
  ) ?? wb.SheetNames[0];
  console.log(`Hoja de vendedores: "${sheetName}"`);

  const ws = wb.Sheets[sheetName];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

  console.log(`Filas encontradas: ${raw.length}`);
  if (raw.length > 0) console.log('Columnas:', Object.keys(raw[0]).join(' | '));

  const vendedores: { nombre: string; supervisor: string; equipo: string }[] = [];

  for (const r of raw) {
    const nombre = str(r['Vendedor '] ?? r['Vendedor'] ?? r['VENDEDOR'] ?? r['nombre']);
    const supervisor = str(r['Supervisor'] ?? r['SUPERVISOR']);
    if (!nombre) continue;
    vendedores.push({
      nombre,
      supervisor,
      equipo: supervisor, // equipo = supervisor (misma jerarquía)
    });
  }

  console.log(`\nVendedores válidos: ${vendedores.length}`);

  if (vendedores.length === 0) {
    console.error('No se encontraron vendedores.');
    client.release();
    await pool.end();
    process.exit(1);
  }

  // Upsert vendedores
  let upserted = 0;
  for (const v of vendedores) {
    await client.query(
      `INSERT INTO vendedores (nombre, supervisor, equipo, activo)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (nombre) DO UPDATE SET
         supervisor = EXCLUDED.supervisor,
         equipo     = EXCLUDED.equipo,
         activo     = true,
         updated_at = NOW()`,
      [v.nombre, v.supervisor, v.equipo]
    );
    upserted++;
  }
  console.log(`Vendedores upserted: ${upserted}`);

  // Rebuild resumen_diario to populate supervisor/equipo
  console.log('\nReconstruyendo resumen_diario (equipo + supervisor)...');
  await client.query(`
    UPDATE resumen_diario rd
    SET supervisor = vd.supervisor,
        equipo     = vd.equipo
    FROM vendedores vd
    WHERE rd.vendedor = vd.nombre
      AND (rd.supervisor IS DISTINCT FROM vd.supervisor
           OR rd.equipo IS DISTINCT FROM vd.equipo)
  `);
  console.log('resumen_diario actualizado.');

  // Show summary
  const { rows: equipos } = await client.query(`
    SELECT equipo, COUNT(DISTINCT vendedor) AS vendedores, COUNT(*) AS filas
    FROM resumen_diario
    GROUP BY equipo
    ORDER BY equipo
  `);
  console.log('\nEquipos en resumen_diario:');
  for (const e of equipos) {
    console.log(`  ${e.equipo ?? '(sin equipo)'}: ${e.vendedores} vendedores, ${e.filas} filas`);
  }

  console.log('\n✓ Maestros cargados.');
  client.release();
  await pool.end();
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
