/**
 * Historical sales data bulk loader — usa ExcelJS streaming para archivos grandes.
 *
 * Uso:
 *   npx ts-node scripts/load-historical.ts --file ./data/Base25.xlsx --year 2025
 */

import ExcelJS from 'exceljs';
import { Pool, PoolClient } from 'pg';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  let file = '';
  let year = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[i + 1];
    if (args[i] === '--year') year = parseInt(args[i + 1], 10);
  }
  if (!file || !year) {
    console.error('Uso: npx ts-node scripts/load-historical.ts --file <ruta> --year <YYYY>');
    process.exit(1);
  }
  const absFile = path.resolve(file);
  if (!fs.existsSync(absFile)) {
    console.error(`Archivo no encontrado: ${absFile}`);
    process.exit(1);
  }
  return { file: absFile, year };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseDate(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(val));
    return epoch.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return s.length >= 10 ? s.slice(0, 10) : null;
}

const str = (v: unknown) => (v == null ? '' : String(v).trim());
const num = (v: unknown) => parseFloat(String(v ?? '0')) || 0;
const int = (v: unknown) => parseInt(String(v ?? '0'), 10) || 0;

// ---------------------------------------------------------------------------
// Bulk insert chunk
// ---------------------------------------------------------------------------
async function insertChunk(
  client: PoolClient,
  rows: Record<string, unknown>[],
  stats: { inserted: number; skipped: number; processed: number }
) {
  if (rows.length === 0) return;

  const placeholders: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const row of rows) {
    placeholders.push(
      `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},` +
      `$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},` +
      `$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`
    );
    values.push(
      row.fecha, row.pdv_id, row.cartera, row.vendedor, row.razon_social,
      row.comprobante, row.marca, row.rubro, row.sku, row.articulo,
      row.neto, row.kilos, row.bultos, row.unidades, row.mes, row.anio
    );
  }

  const sql = `
    INSERT INTO ventas
      (fecha, pdv_id, cartera, vendedor, razon_social, comprobante,
       marca, rubro, sku, articulo, neto, kilos, bultos, unidades, mes, anio)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (fecha, pdv_id, comprobante, sku) DO NOTHING
    RETURNING id
  `;

  try {
    const result = await client.query(sql, values);
    const ins = result.rowCount ?? 0;
    stats.inserted += ins;
    stats.skipped += rows.length - ins;
    stats.processed += rows.length;
  } catch (err) {
    console.error('Error en chunk:', (err as Error).message);
    stats.skipped += rows.length;
    stats.processed += rows.length;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { file, year } = parseArgs();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log(`Archivo: ${file}`);
  console.log('Conectando a la base de datos...');
  const client = await pool.connect();
  console.log('Conectado.\n');

  const CHUNK_SIZE = 500;
  const stats = { inserted: 0, skipped: 0, processed: 0 };
  let chunk: Record<string, unknown>[] = [];
  let headers: string[] = [];
  let lastLogAt = 0;

  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(file, {
    entries: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    worksheets: 'emit',
    styles: 'ignore',
  } as ExcelJS.stream.xlsx.WorkbookStreamReaderOptions);

  for await (const worksheet of workbook as AsyncIterable<ExcelJS.stream.xlsx.WorksheetReader>) {
    console.log(`Hoja: ${(worksheet as unknown as { name: string }).name}`);

    for await (const row of worksheet as AsyncIterable<ExcelJS.Row>) {
      const cells = (row.values as unknown[]).slice(1);

      if (row.number === 1) {
        headers = cells.map(str);
        console.log('Columnas:', headers.join(' | '));
        continue;
      }

      const mapped: Record<string, unknown> = {};
      headers.forEach((h, i) => { mapped[h] = cells[i] ?? null; });

      const fecha = parseDate(mapped['Fecha Comprobante'] ?? mapped['Fecha']);
      if (!fecha) continue;
      const pdvId = int(mapped['PDV']);
      if (!pdvId) continue;

      const [, mStr] = fecha.split('-');

      chunk.push({
        fecha,
        pdv_id:      pdvId,
        cartera:     str(mapped['Cartera']),
        vendedor:    str(mapped['Vendedor']),
        razon_social: str(mapped['Razon Social']),
        comprobante: str(mapped['Comprobante']),
        marca:       str(mapped['Marca']),
        rubro:       str(mapped['Rubro']),
        sku:         str(mapped['SKU']),
        articulo:    str(mapped['Articulo']),
        neto:        num(mapped['NETO']),
        kilos:       num(mapped['KILOS']),
        bultos:      int(mapped['BULTOS']),
        unidades:    int(mapped['UNIDADES']),
        mes:         int(mStr),
        anio:        year,
      });

      if (chunk.length >= CHUNK_SIZE) {
        await insertChunk(client, chunk, stats);
        chunk = [];

        const milestone = Math.floor(stats.processed / 10000);
        if (milestone > lastLogAt) {
          lastLogAt = milestone;
          console.log(`  ${stats.processed} filas procesadas — insertadas: ${stats.inserted}, omitidas: ${stats.skipped}`);
        }
      }
    }

    // Flush remaining
    if (chunk.length > 0) {
      await insertChunk(client, chunk, stats);
      chunk = [];
    }

    break; // solo procesamos la primera hoja
  }

  console.log(`\nVentas cargadas:`);
  console.log(`  Total procesadas : ${stats.processed}`);
  console.log(`  Insertadas       : ${stats.inserted}`);
  console.log(`  Omitidas (dupl.) : ${stats.skipped}`);

  console.log('\nReconstruyendo resumen_diario...');
  await client.query(`DELETE FROM resumen_diario WHERE EXTRACT(YEAR FROM fecha) = $1`, [year]);
  await client.query(`
    INSERT INTO resumen_diario (fecha, vendedor, supervisor, equipo, rubro, kilos, neto, pdvs_activos)
    SELECT
      v.fecha, v.vendedor, vd.supervisor, vd.equipo, v.rubro,
      SUM(v.kilos), SUM(v.neto), COUNT(DISTINCT v.pdv_id)
    FROM ventas v
    LEFT JOIN vendedores vd ON vd.nombre = v.vendedor
    WHERE EXTRACT(YEAR FROM v.fecha) = $1
    GROUP BY v.fecha, v.vendedor, vd.supervisor, vd.equipo, v.rubro
    ON CONFLICT (fecha, vendedor, rubro) DO UPDATE SET
      supervisor = EXCLUDED.supervisor, equipo = EXCLUDED.equipo,
      kilos = EXCLUDED.kilos, neto = EXCLUDED.neto, pdvs_activos = EXCLUDED.pdvs_activos
  `, [year]);

  console.log(`resumen_diario reconstruido para ${year}.`);
  console.log('\n✓ Carga completa.');

  client.release();
  await pool.end();
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
