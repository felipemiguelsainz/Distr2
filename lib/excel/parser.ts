import * as XLSX from 'xlsx';
import { RawVentaRow } from '@/lib/types';

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function parseExcelDate(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    } catch { return null; }
  }
  const s = String(val).trim();
  if (!s) return null;
  const parts = s.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return s.length >= 10 ? s.slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Ventas preview — shows raw column → field mapping for first data row
// ---------------------------------------------------------------------------
export interface VentasFieldMapping {
  field: string;
  label: string;
  excelCol: string | null;
  value: string;
  ok: boolean;
}

export interface VentasPreview {
  totalRows: number;
  mappings: VentasFieldMapping[];
  allColumns: { name: string; sample: string }[];
  parsedSample: { kilos: number; neto: number }[];
  kilosTotalPos: number;
  kilosTotalNeg: number;
  rowsPos: number;
  rowsNeg: number;
}

const VENTAS_FIELD_DEFS: { field: string; label: string; required: boolean; candidates: string[] }[] = [
  { field: 'fecha',       label: 'Fecha',       required: true,  candidates: ['Fecha Comprobante', 'Fecha', 'FECHA', 'fecha'] },
  { field: 'pdv_id',      label: 'PDV',         required: true,  candidates: ['PDV', 'Cod. Cliente', 'COD_CLIENTE'] },
  { field: 'vendedor',    label: 'Vendedor',     required: false, candidates: ['Vendedor', 'VENDEDOR'] },
  { field: 'cartera',     label: 'Cartera',      required: false, candidates: ['Cartera', 'CARTERA'] },
  { field: 'comprobante', label: 'Comprobante',  required: false, candidates: ['Comprobante', 'COMPROBANTE'] },
  { field: 'rubro',       label: 'Rubro',        required: false, candidates: ['Rubro', 'RUBRO'] },
  { field: 'sku',         label: 'SKU',          required: false, candidates: ['SKU', 'Sku', 'Código', 'CODIGO'] },
  { field: 'articulo',    label: 'Artículo',     required: false, candidates: ['Artículo', 'Articulo', 'ARTICULO'] },
  { field: 'kilos',       label: 'Kilos',        required: true,  candidates: ['Kilos', 'KILOS'] },
  { field: 'neto',        label: 'Neto ($)',     required: true,  candidates: ['Neto', 'NETO'] },
  { field: 'bultos',      label: 'Bultos',       required: false, candidates: ['Bultos', 'BULTOS'] },
  { field: 'unidades',    label: 'Unidades',     required: false, candidates: ['Unidades', 'UNIDADES'] },
];

export function getVentasPreview(buffer: ArrayBuffer): VentasPreview {
  const workbook = XLSX.read(buffer, { cellDates: false, type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const firstRow = raw[0] ?? {};

  const mappings: VentasFieldMapping[] = VENTAS_FIELD_DEFS.map(({ field, label, required, candidates }) => {
    const match = candidates.find(c => firstRow[c] !== undefined && firstRow[c] !== '');
    const raw_val = match ? firstRow[match] : null;
    const value = raw_val !== null && raw_val !== undefined ? String(raw_val).slice(0, 50) : '';
    return {
      field,
      label,
      excelCol: match ?? null,
      value,
      ok: match !== undefined || !required,
    };
  });

  // All columns in the file with their first-row sample values
  const allColumns = Object.keys(firstRow).map(name => ({
    name,
    sample: String(firstRow[name] ?? '').slice(0, 40),
  }));

  const kilosCol = mappings.find(m => m.field === 'kilos')?.excelCol;
  const netoCol  = mappings.find(m => m.field === 'neto')?.excelCol;

  const parsedSample = raw.slice(0, 5).map(r => ({
    kilos: parseFloat(String(kilosCol ? r[kilosCol] : (r['Kilos'] ?? r['KILOS'] ?? '0'))) || 0,
    neto:  parseFloat(String(netoCol  ? r[netoCol]  : (r['Neto']  ?? r['NETO']  ?? '0'))) || 0,
  }));

  let kilosTotalPos = 0, kilosTotalNeg = 0, rowsPos = 0, rowsNeg = 0;
  for (const r of raw) {
    const k = parseFloat(String(kilosCol ? r[kilosCol] : (r['Kilos'] ?? r['KILOS'] ?? '0'))) || 0;
    if (k > 0) { kilosTotalPos += k; rowsPos++; }
    else if (k < 0) { kilosTotalNeg += k; rowsNeg++; }
  }

  return { totalRows: raw.length, mappings, allColumns, parsedSample, kilosTotalPos, kilosTotalNeg, rowsPos, rowsNeg };
}

// ---------------------------------------------------------------------------
// Ventas file parser
// ---------------------------------------------------------------------------
export function parseVentasFile(buffer: ArrayBuffer): RawVentaRow[] {
  const workbook = XLSX.read(buffer, { cellDates: false, type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const rows: RawVentaRow[] = [];

  for (const r of raw) {
    const fecha = parseExcelDate(r['Fecha Comprobante'] ?? r['Fecha'] ?? r['FECHA'] ?? r['fecha']);
    if (!fecha) continue;

    const pdvId = parseInt(String(r['PDV'] ?? r['Cod. Cliente'] ?? r['COD_CLIENTE'] ?? '0'), 10);
    if (!pdvId || isNaN(pdvId)) continue;

    const [yStr, mStr] = fecha.split('-');

    rows.push({
      fecha,
      pdv_id:      pdvId,
      cartera:     String(r['Cartera'] ?? r['CARTERA'] ?? '').trim(),
      vendedor:    String(r['Vendedor'] ?? r['VENDEDOR'] ?? '').trim(),
      razon_social: String(r['Razon Social'] ?? r['Razón Social'] ?? r['RAZON_SOCIAL'] ?? '').trim(),
      comprobante: String(r['Comprobante'] ?? r['COMPROBANTE'] ?? '').trim(),
      marca:       String(r['Marca'] ?? r['MARCA'] ?? '').trim(),
      rubro:       String(r['Rubro'] ?? r['RUBRO'] ?? '').trim(),
      sku:         String(r['SKU'] ?? r['Sku'] ?? r['Código'] ?? r['CODIGO'] ?? '').trim(),
      articulo:    String(r['Artículo'] ?? r['Articulo'] ?? r['ARTICULO'] ?? '').trim(),
      neto:        parseFloat(String(r['Neto'] ?? r['NETO'] ?? '0')) || 0,
      kilos:       parseFloat(String(r['Kilos'] ?? r['KILOS'] ?? '0')) || 0,
      bultos:      parseInt(String(r['Bultos'] ?? r['BULTOS'] ?? '0'), 10) || 0,
      unidades:    parseInt(String(r['Unidades'] ?? r['UNIDADES'] ?? '0'), 10) || 0,
      mes:         parseInt(mStr, 10),
      anio:        parseInt(yStr, 10),
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Maestros file parser (.xlsb supported by xlsx library)
// ---------------------------------------------------------------------------
export interface RawVendedorRow {
  nombre: string;
  supervisor: string;
  equipo: string;
  localidad: string;
  activo: boolean;
}

export function parseMaestrosFile(buffer: ArrayBuffer): RawVendedorRow[] {
  const workbook = XLSX.read(buffer, { cellDates: false, type: 'array' });

  const sheetVendedores =
    workbook.Sheets['Maestro vendedores'] ??
    workbook.Sheets['Vendedores'] ??
    workbook.Sheets[workbook.SheetNames[0]];

  const rawVendedores: Record<string, unknown>[] =
    XLSX.utils.sheet_to_json(sheetVendedores, { defval: '' });

  return rawVendedores
    .map((r) => {
      const nombre = String(r['Nombre'] ?? r['NOMBRE'] ?? r['Vendedor'] ?? '').trim();
      if (!nombre) return null;
      const activoRaw = r['Activo'] ?? r['ACTIVO'];
      const activo = activoRaw === undefined
        ? true
        : String(activoRaw).toLowerCase() !== 'false' &&
          String(activoRaw) !== '0' &&
          String(activoRaw).toLowerCase() !== 'no';
      return {
        nombre,
        supervisor: String(r['Supervisor'] ?? r['SUPERVISOR'] ?? '').trim(),
        equipo:     String(r['Equipo'] ?? r['EQUIPO'] ?? '').trim(),
        localidad:  String(r['Localidad'] ?? r['LOCALIDAD'] ?? '').trim(),
        activo,
      };
    })
    .filter((r): r is RawVendedorRow => r !== null);
}
