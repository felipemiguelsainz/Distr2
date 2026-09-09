/**
 * Chequeo del export a Excel: que los números salgan CRUDOS con formato de
 * celda, no como texto ya formateado.
 *
 *   npm run check:excel
 *
 * Lo que se cuida acá: los porcentajes del dashboard vienen 0-100. Con el
 * formato nativo `0.0%` Excel los volvería a multiplicar por cien y un avance
 * del 92,4% se mostraría como 9240%. Por eso el formato es `0.0"%"`.
 */
import assert from 'node:assert/strict';
import { construirHoja, type ColExcel } from '../lib/excel/exportar';

const COLS: ColExcel[] = [
  { key: 'rubro',      label: 'Rubro' },
  { key: 'acumulado',  label: 'Acum.', fmt: 'kg' },
  { key: 'neto',       label: 'Neto',  fmt: 'money' },
  { key: 'avance_pct', label: 'Av%',   fmt: 'pct' },
  { key: 'tendencia',  label: 'Tend.', fmt: 'kg' },
];

const FILAS = [
  { rubro: 'CHOCOLATES', acumulado: 81737.4, neto: 1220913332, avance_pct: 92.4, tendencia: null },
  { rubro: 'TOTAL',      acumulado: 178615,  neto: 2000000,    avance_pct: 104.9, tendencia: 190000 },
];

async function main() {
  const ws = await construirHoja(COLS, FILAS);

  // Encabezados en la fila 1, en el orden de `cols`.
  assert.equal(ws.A1.v, 'Rubro');
  assert.equal(ws.E1.v, 'Tend.');

  // Números crudos, no strings: 81737.4 y no "81.737 kg".
  assert.equal(ws.B2.t, 'n', 'los kilos tienen que quedar numéricos');
  assert.equal(ws.B2.v, 81737.4);
  assert.equal(ws.C2.v, 1220913332);

  // Formato de celda por tipo de columna.
  assert.equal(ws.B2.z, '#,##0');
  assert.equal(ws.C2.z, '$ #,##0');
  // El % va 0-100 con formato literal: con `0.0%` Excel mostraría 9240%.
  assert.equal(ws.D2.z, '0.0"%"');
  assert.equal(ws.D2.v, 92.4);

  // Un null no inventa un 0: la celda queda vacía, como el "—" de la pantalla.
  assert.equal(ws.E2, undefined, 'null tiene que dejar la celda vacía');
  assert.equal(ws.E3.v, 190000);

  // Los anchos siguen el orden de las columnas.
  assert.equal(ws['!cols']?.length, COLS.length);

  console.log('OK — export a Excel: números crudos y formatos correctos.');
}

main().catch((e) => { console.error(e); process.exit(1); });
