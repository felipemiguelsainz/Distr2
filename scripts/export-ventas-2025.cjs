// Ventas 2025 por rubro y mes -> ventas_2025_por_categoria.xlsx (hoja $ y hoja kg).
//   node scripts/export-ventas-2025.cjs [anio]
/* eslint-disable @typescript-eslint/no-require-imports */
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const fs = require('fs');

for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const anio = Number(process.argv[2]) || 2025;
const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function main() {
  const { rows } = await pool.query(
    `SELECT rubro,
            EXTRACT(MONTH FROM fecha)::int AS mes,
            SUM(neto)  AS neto,
            SUM(kilos) AS kilos
       FROM resumen_diario
      WHERE fecha >= make_date($1, 1, 1) AND fecha < make_date($1 + 1, 1, 1)
      GROUP BY 1, 2`,
    [anio],
  );

  const rubros = [...new Set(rows.map((r) => r.rubro))].sort();
  const celda = (campo) => {
    const m = new Map(rows.map((r) => [`${r.rubro}|${r.mes}`, Number(r[campo])]));
    return (rubro, mes) => m.get(`${rubro}|${mes}`) || 0;
  };

  const wb = new ExcelJS.Workbook();
  for (const [nombre, campo, formato] of [
    ['Ventas en $', 'neto', '#,##0'],
    ['Volumen en kg', 'kilos', '#,##0'],
  ]) {
    const ws = wb.addWorksheet(nombre);
    const valor = celda(campo);
    ws.addRow(['Rubro', ...MESES]).font = { bold: true };
    for (const rubro of rubros) {
      ws.addRow([rubro, ...MESES.map((_, i) => valor(rubro, i + 1))]);
    }
    const total = ws.addRow([
      'TOTAL',
      ...MESES.map((_, i) => rubros.reduce((a, rubro) => a + valor(rubro, i + 1), 0)),
    ]);
    total.font = { bold: true };
    ws.getColumn(1).width = 16;
    for (let c = 2; c <= 13; c++) {
      ws.getColumn(c).width = 14;
      ws.getColumn(c).numFmt = formato;
    }
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
  }

  const archivo = `ventas_${anio}_por_categoria.xlsx`;
  await wb.xlsx.writeFile(archivo);
  console.log(`${archivo}: ${rubros.length} rubros x 12 meses`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
