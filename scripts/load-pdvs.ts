/**
 * Carga masiva del maestro de clientes (Puntos de Venta).
 *
 * Uso:
 *   npx ts-node scripts/load-pdvs.ts --file ./data/pdvs.xlsx
 */

import ExcelJS from 'exceljs';
import { Pool, PoolClient } from 'pg';
import * as path from 'path';
import * as fs from 'fs';

function parseArgs() {
  const args = process.argv.slice(2);
  let file = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file') file = args[i + 1];
  }
  if (!file) {
    console.error('Uso: npx ts-node scripts/load-pdvs.ts --file <ruta>');
    process.exit(1);
  }
  const absFile = path.resolve(file);
  if (!fs.existsSync(absFile)) {
    console.error(`Archivo no encontrado: ${absFile}`);
    process.exit(1);
  }
  return { file: absFile };
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
const int = (v: unknown) => parseInt(String(v ?? '0'), 10) || 0;

// ---------------------------------------------------------------------------
// Upsert chunk
// ---------------------------------------------------------------------------
async function upsertChunk(
  client: PoolClient,
  rows: Record<string, unknown>[]
): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const placeholders: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const row of rows) {
    placeholders.push(
      `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},` +
      `$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},` +
      `$${idx++},$${idx++})`
    );
    values.push(
      row.id, row.razon_social, row.domicilio, row.localidad, row.zona,
      row.canal_distribucion, row.canal_venta, row.categoria_iva, row.cuit,
      row.cartera, row.fecha_alta, row.ultima_vta
    );
  }

  const sql = `
    INSERT INTO pdvs
      (id, razon_social, domicilio, localidad, zona,
       canal_distribucion, canal_venta, categoria_iva, cuit,
       cartera, fecha_alta, ultima_vta)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (id) DO UPDATE SET
      razon_social       = EXCLUDED.razon_social,
      domicilio          = EXCLUDED.domicilio,
      localidad          = EXCLUDED.localidad,
      zona               = EXCLUDED.zona,
      canal_distribucion = EXCLUDED.canal_distribucion,
      canal_venta        = EXCLUDED.canal_venta,
      categoria_iva      = EXCLUDED.categoria_iva,
      cuit               = EXCLUDED.cuit,
      cartera            = EXCLUDED.cartera,
      fecha_alta         = EXCLUDED.fecha_alta,
      ultima_vta         = EXCLUDED.ultima_vta,
      updated_at         = NOW()
    RETURNING (xmax = 0) AS inserted
  `;

  const result = await client.query(sql, values);
  const inserted = result.rows.filter((r) => r.inserted).length;
  const updated = result.rows.length - inserted;
  return { inserted, updated };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const { file } = parseArgs();

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  console.log(`Archivo: ${file}`);
  const client = await pool.connect();
  console.log('Conectado.\n');

  const CHUNK_SIZE = 500;
  let headers: string[] = [];
  let chunk: Record<string, unknown>[] = [];
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalRows = 0;
  const today = new Date().toISOString().slice(0, 10);

  // Fetch existing cartera → to detect reasignaciones
  const { rows: existing } = await client.query<{ id: number; cartera: string }>(
    'SELECT id, cartera FROM pdvs'
  );
  const existingMap = new Map<number, string>();
  for (const r of existing) existingMap.set(r.id, r.cartera);
  console.log(`PDVs existentes en DB: ${existingMap.size}`);

  const carteraChanges: Array<{ pdv_id: number; cartera_anterior: string; cartera_nueva: string }> = [];

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
        headers = cells.map((c) => str(c));
        console.log('Columnas detectadas:', headers.join(' | '));
        continue;
      }

      const m: Record<string, unknown> = {};
      headers.forEach((h, i) => { m[h] = cells[i] ?? null; });

      const id = int(m['PDV'] ?? m['Cod. Cliente']);
      if (!id) continue;

      const cartera = str(m['Cartera']);
      const oldCartera = existingMap.get(id);
      if (oldCartera !== undefined && oldCartera !== cartera && cartera) {
        carteraChanges.push({ pdv_id: id, cartera_anterior: oldCartera, cartera_nueva: cartera });
      }

      chunk.push({
        id,
        razon_social:       str(m['Razón Social'] ?? m['Razon Social']),
        domicilio:          str(m['DOMICILIO'] ?? m['Domicilio']),
        localidad:          str(m['Localidad'] ?? m['LOCALIDAD']),
        zona:               str(m['Zona'] ?? m['ZONA']),
        canal_distribucion: str(m['Canal Distribucion'] ?? m['Canal Distribución']),
        canal_venta:        str(m['Canal Vta.'] ?? m['Canal Venta']),
        categoria_iva:      str(m['Categoría IVA'] ?? m['Categoria IVA']),
        cuit:               str(m['CUIT'] ?? m['Cuit']),
        cartera,
        fecha_alta:         parseDate(m['Fecha Alta']),
        ultima_vta:         parseDate(m['Ultima Vta.'] ?? m['Ultima Vta']),
      });

      totalRows++;

      if (chunk.length >= CHUNK_SIZE) {
        const { inserted, updated } = await upsertChunk(client, chunk);
        totalInserted += inserted;
        totalUpdated += updated;
        chunk = [];
        process.stdout.write(`\r  Procesados: ${totalRows} (${totalInserted} nuevos, ${totalUpdated} actualizados)`);
      }
    }

    if (chunk.length > 0) {
      const { inserted, updated } = await upsertChunk(client, chunk);
      totalInserted += inserted;
      totalUpdated += updated;
      chunk = [];
    }

    break;
  }

  // Registrar reasignaciones de cartera
  if (carteraChanges.length > 0) {
    for (const c of carteraChanges) {
      await client.query(
        `INSERT INTO asignaciones (cartera, vendedor_nombre, fecha_desde)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [c.cartera_nueva, c.cartera_nueva, today]
      );
    }
  }

  console.log('\n\n--- Resumen ---');
  console.log(`Total filas       : ${totalRows}`);
  console.log(`Insertados (new)  : ${totalInserted}`);
  console.log(`Actualizados      : ${totalUpdated}`);
  console.log(`Cambios de cartera: ${carteraChanges.length}`);

  if (carteraChanges.length > 0) {
    console.log('\nCambios de cartera:');
    for (const c of carteraChanges) {
      console.log(`  PDV ${c.pdv_id}: ${c.cartera_anterior} → ${c.cartera_nueva}`);
    }
  }

  console.log('\n✓ PDVs cargados.');
  client.release();
  await pool.end();
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
