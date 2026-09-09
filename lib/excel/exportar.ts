// ---------------------------------------------------------------------------
// Exportar una tabla de la pantalla a Excel.
//
// Los números van CRUDOS (1234.56, no "1.234 kg") con formato de celda: en la
// planilla se ven igual que en el dashboard pero se pueden sumar y pivotear,
// que es para lo que se pide el Excel.
//
// El nombre del archivo lleva los filtros que estaban puestos (mes, año,
// vendedor, equipo, rango) leídos de la URL: dos exportaciones de la misma
// tabla con distinto período no se pisan en la carpeta de descargas.
// ---------------------------------------------------------------------------

export type Fmt = 'kg' | 'money' | 'pct' | 'int' | 'text';

export interface ColExcel {
  key:   string;
  label: string;
  /** Formato de celda. Por defecto texto. */
  fmt?:  Fmt;
  /** Ancho en caracteres. Por defecto, el del encabezado. */
  w?:    number;
}

// `object` y no `Record<string, ...>`: TypeScript no le da index signature
// implicita a las interfaces, asi que un `CoberturaItem[]` no entraria en un
// Record y habria que mapear en cada llamada. Las claves las fija `cols`.
export type FilaExcel = object;

// Los porcentajes del dashboard vienen 0-100, no 0-1: el formato es 0.0"%" y
// no 0.0%, que los volvería a multiplicar por cien.
const FORMATO: Record<Fmt, string | undefined> = {
  kg:    '#,##0',
  money: '$ #,##0',
  pct:   '0.0"%"',
  int:   '#,##0',
  text:  undefined,
};

/** mes/año/vendedor/equipo/rango de la URL, para el nombre del archivo. */
function sufijoDeFiltros(): string {
  if (typeof window === 'undefined') return '';
  const p = new URLSearchParams(window.location.search);
  const anio = p.get('anio');
  const mes  = p.get('mes');
  const partes = [
    anio && mes ? `${anio}-${mes.padStart(2, '0')}` : null,
    p.get('desde') && p.get('hasta') ? `${p.get('desde')}_a_${p.get('hasta')}` : null,
    p.get('vendedor'),
    p.get('supervisor') ?? p.get('equipo'),
  ].filter(Boolean) as string[];
  return partes.join('_');
}

/** Saca lo que Windows no acepta en un nombre de archivo (y los espacios). */
function limpiar(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
}

/** La hoja armada, sin bajarla. Separada para poder chequearla desde un script. */
export async function construirHoja(cols: ColExcel[], filas: FilaExcel[]) {
  const XLSX = await import('xlsx');

  const aoa = [
    cols.map((c) => c.label),
    ...filas.map((f) => cols.map((c) => (f as Record<string, unknown>)[c.key] ?? null)),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Formato por columna, sólo sobre las celdas que quedaron numéricas.
  cols.forEach((c, i) => {
    const z = FORMATO[c.fmt ?? 'text'];
    if (!z) return;
    for (let r = 1; r <= filas.length; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: i })];
      if (cell && cell.t === 'n') cell.z = z;
    }
  });

  ws['!cols'] = cols.map((c) => ({ wch: c.w ?? Math.max(10, c.label.length + 2) }));
  return ws;
}

export async function exportarExcel(
  archivo: string,
  hoja:    string,
  cols:    ColExcel[],
  filas:   FilaExcel[],
): Promise<void> {
  const XLSX = await import('xlsx');
  const ws = await construirHoja(cols, filas);

  const wb = XLSX.utils.book_new();
  // Excel no acepta nombres de hoja de más de 31 caracteres ni con : \ / ? * [ ]
  XLSX.utils.book_append_sheet(wb, ws, hoja.replace(/[:\\/?*[\]]/g, '-').slice(0, 31));

  const sufijo = sufijoDeFiltros() || new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${limpiar(archivo)}_${limpiar(sufijo)}.xlsx`);
}
