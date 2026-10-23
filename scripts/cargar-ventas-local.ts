/**
 * Carga un Excel de ventas a la base corriendo local (sin pasar por la URL
 * pública: tope de 4,5 MB y timeout). Misma lógica que /api/admin/ventas/upload.
 *
 *   npx ts-node --project tsconfig.scripts.json scripts/cargar-ventas-local.ts "<archivo.xlsx>"          # dry-run
 *   npx ts-node --project tsconfig.scripts.json scripts/cargar-ventas-local.ts "<archivo.xlsx>" --aplicar
 */
import fs from 'node:fs';
import { Pool } from 'pg';
import { parseVentasFile } from '../lib/excel/parser';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const [archivo, flag] = process.argv.slice(2);
const aplicar = flag === '--aplicar';

async function main() {
  const buf = fs.readFileSync(archivo);
  const rows = parseVentasFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const fechas = [...new Set(rows.map((r) => r.fecha))].sort();
  const suma = (f: (r: (typeof rows)[number]) => number) => Math.round(rows.reduce((a, r) => a + f(r), 0));
  console.log(`archivo: ${rows.length} filas · ${fechas[0]} → ${fechas[fechas.length - 1]} (${fechas.length} días)`);
  console.log(`  neto ${suma((r) => r.neto)} · kg ${suma((r) => r.kilos)}`);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const clave = (r: { fecha: string; pdv_id: number; comprobante: string; sku: string }) =>
      `${r.fecha}|${r.pdv_id}|${r.comprobante}|${r.sku}`;
    const enArchivo = new Set(rows.map(clave));
    if (enArchivo.size !== rows.length) console.log(`  ⚠ ${rows.length - enArchivo.size} filas repetidas por clave (el upsert deja la última)`);

    const { rows: db } = await pool.query(
      `SELECT to_char(fecha,'YYYY-MM-DD') fecha, pdv_id, comprobante, sku, neto::float, kilos::float
         FROM ventas WHERE fecha BETWEEN $1 AND $2`, [fechas[0], fechas[fechas.length - 1]]);
    const enDb = new Map(db.map((r) => [clave(r), r]));
    const sobran = db.filter((r) => !enArchivo.has(clave(r)));
    const nuevas = rows.filter((r) => !enDb.has(clave(r)));
    const distintas = rows.filter((r) => {
      const d = enDb.get(clave(r));
      return d && (Math.abs(d.neto - r.neto) > 0.005 || Math.abs(d.kilos - r.kilos) > 0.0005);
    });
    console.log(`base en ese rango: ${db.length} filas`);
    console.log(`  nuevas ${nuevas.length} · cambiadas ${distintas.length} · en la base y NO en el archivo ${sobran.length}`
      + (sobran.length ? ` (neto ${Math.round(sobran.reduce((a, r) => a + r.neto, 0))})` : ''));

    if (!aplicar) { console.log('dry-run: no se escribió nada (--aplicar para cargar)'); return; }

    const { rows: ex } = await pool.query('SELECT id FROM pdvs');
    const ids = new Set(ex.map((r) => r.id as number));
    const faltan = new Map<number, { cartera: string; razon_social: string }>();
    for (const r of rows) if (!ids.has(r.pdv_id) && !faltan.has(r.pdv_id)) faltan.set(r.pdv_id, { cartera: r.cartera, razon_social: r.razon_social });
    for (const [id, v] of faltan) {
      await pool.query(
        'INSERT INTO pdvs (id, razon_social, cartera, activo) VALUES ($1,$2,$3,true) ON CONFLICT (id) DO NOTHING',
        [id, v.razon_social || `PDV ${id}`, v.cartera || null]);
    }
    console.log(`PDVs creados: ${faltan.size}`);

    const unicas = [...new Map(rows.map((r) => [clave(r), r])).values()];
    const cols = ['fecha','pdv_id','cartera','vendedor','razon_social','comprobante','marca','rubro','sku','articulo','neto','kilos','bultos','unidades','mes','anio'] as const;
    const CHUNK = 500;
    for (let i = 0; i < unicas.length; i += CHUNK) {
      const lote = unicas.slice(i, i + CHUNK);
      const params: unknown[] = [];
      const values = lote.map((r) => `(${cols.map((c) => { params.push(r[c]); return `$${params.length}`; }).join(',')})`);
      await pool.query(
        `INSERT INTO ventas (${cols.join(',')}) VALUES ${values.join(',')}
         ON CONFLICT (fecha, pdv_id, comprobante, sku) DO UPDATE SET
         ${cols.filter((c) => !['fecha','pdv_id','comprobante','sku'].includes(c)).map((c) => `${c}=EXCLUDED.${c}`).join(',')}`, params);
    }
    console.log(`upsert: ${unicas.length} filas`);

    await pool.query('SELECT recalcular_resumen_diario($1::date[])', [fechas]);
    await pool.query('SELECT recalcular_resumen_clientes_pdv($1::text[])', [[...new Set(fechas.map((f) => f.slice(0, 7)))]]);
    await pool.query('SELECT recalcular_catalogo_productos()');
    console.log('resúmenes recalculados');
  } finally { await pool.end(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
