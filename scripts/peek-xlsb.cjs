const XLSX = require('xlsx');

const file = './data/maestrovendedodores.xlsb';
const wb = XLSX.readFile(file, { cellDates: false });

console.log('Hojas:', wb.SheetNames);

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', header: 1 });
  console.log(`\n=== Hoja: ${name} ===`);
  if (rows[0]) console.log('Header:', JSON.stringify(rows[0]));
  if (rows[1]) console.log('Row 1:', JSON.stringify(rows[1]));
  if (rows[2]) console.log('Row 2:', JSON.stringify(rows[2]));
}
