const ExcelJS = require('exceljs');

async function main() {
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader('./data/pdvs.xlsx', {});
  for await (const worksheet of workbook) {
    console.log('Sheet:', worksheet.name);
    let rowCount = 0;
    for await (const row of worksheet) {
      if (rowCount === 0) console.log('Headers:', JSON.stringify(row.values.slice(1)));
      if (rowCount === 1) console.log('Row 1:',   JSON.stringify(row.values.slice(1)));
      rowCount++;
      if (rowCount > 1) break;
    }
    break;
  }
}
main().catch(console.error);
