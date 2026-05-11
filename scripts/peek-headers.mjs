import { readFile } from 'fs/promises';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('./node_modules/xlsx/xlsx.js');

const buf = await readFile('./data/Base25.xlsx');
const wb = XLSX.read(buf, { sheetRows: 3, cellDates: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
console.log('HEADERS:', JSON.stringify(rows[0]));
console.log('ROW 1:',   JSON.stringify(rows[1]));
