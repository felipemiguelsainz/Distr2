// ---------------------------------------------------------------------------
// Hoja de ruta — el papel que se lleva el vendedor.
//
// Es otra cosa que el PDF de zonas (ver PlanificacionClient): aquél muestra el
// mapa de UN cuadrante y sirve para revisar la zonificación de escritorio. Esto
// es la semana de trabajo: una hoja por día, con TODAS las zonas de ese día
// juntas, ordenadas por calle y con la dirección. Un vendedor con dos zonas el
// lunes tiene un solo lunes, no dos papeles sueltos.
//
// Sin mapa a propósito: capturar tiles cuesta ~2,5s por zona y multiplica el
// peso del archivo por diez. Esto tiene que salir en un segundo y viajar por
// WhatsApp.
// ---------------------------------------------------------------------------
import type { jsPDF } from 'jspdf';
import {
  DIAS_HABILES, DIA_NOMBRE, colorPorCanal, contarPorCanal, hexARgb,
  type Cuadrante, type Dia, type PdvPlan,
} from '@/app/planificacion/types';

export interface DiaRuta {
  dia: Dia;
  /** Nombres de los cuadrantes que se recorren ese día. */
  zonas: string[];
  /** PDVs del día, ya ordenados para recorrerlos. */
  pdvs: PdvPlan[];
}

// ---------------------------------------------------------------------------
// El domicilio del maestro viene sucio y en varios formatos:
//   'PRINGLES Nro.1629' · 'CATAMARCA 4551' · 'SAN MARTIN NRO.8'
//   'MOSCONI 25 Nro. (LAMADRID y JUJUY)'
//
// Ordenar el string crudo mezcla la misma calle en tres lugares distintos, que
// es justo lo que rompe el recorrido. Se separa calle de altura para que la
// altura ordene como número: 'MITRE 9' tiene que ir antes que 'MITRE 100'.
//
// El paréntesis es una referencia de esquina, no parte de la dirección.
// ---------------------------------------------------------------------------
export function calleYAltura(domicilio: string | null): { calle: string; altura: number } {
  if (!domicilio) return { calle: '', altura: 0 };
  const limpio = domicilio
    .normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\bnro\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  // La altura es el último número del string; lo anterior es el nombre.
  const m = limpio.match(/^(.*?)\s*(\d+)\D*$/);
  if (!m) return { calle: limpio, altura: 0 };
  return { calle: m[1].trim(), altura: Number(m[2]) };
}

const porTexto = new Intl.Collator('es', { sensitivity: 'base' });

/** Orden de recorrido: por localidad, después por calle, después por altura. */
export function ordenarParaRecorrer(pdvs: PdvPlan[]): PdvPlan[] {
  const clave = new Map(pdvs.map((p) => [p.pdv_id, calleYAltura(p.domicilio)]));
  return [...pdvs].sort((a, b) => {
    const la = a.localidad ?? '', lb = b.localidad ?? '';
    if (la !== lb) return porTexto.compare(la, lb);
    const ka = clave.get(a.pdv_id)!, kb = clave.get(b.pdv_id)!;
    if (ka.calle !== kb.calle) return porTexto.compare(ka.calle, kb.calle);
    if (ka.altura !== kb.altura) return ka.altura - kb.altura;
    return porTexto.compare(a.razon_social ?? '', b.razon_social ?? '');
  });
}

/**
 * La semana de un vendedor: un día por hoja, con sus zonas fusionadas.
 *
 * Un PDV puede estar en dos días distintos (visita dos veces por semana) y
 * aparece en los dos, que es lo que hay que salir a hacer. Dentro del mismo día
 * no puede repetirse — lo garantiza el UNIQUE (pdv_id, dia) de la migración
 * 042 — pero se deduplica igual: un papel con el mismo cliente dos veces manda
 * al vendedor a hacer un viaje al pedo.
 */
export function rutaPorDia(
  cuadrantes: Cuadrante[],
  porId: Map<number, PdvPlan>,
  vendedor: string,
): DiaRuta[] {
  return DIAS_HABILES.map((dia) => {
    const zonas = cuadrantes.filter((c) => c.vendedor_nombre === vendedor && c.dia === dia);
    const pdvs = new Map<number, PdvPlan>();
    for (const z of zonas) {
      for (const id of z.pdv_ids) {
        const p = porId.get(id);
        if (p) pdvs.set(id, p);
      }
    }
    return {
      dia,
      zonas: zonas.map((z) => z.nombre),
      pdvs: ordenarParaRecorrer([...pdvs.values()]),
    };
  }).filter((d) => d.pdvs.length > 0);
}

/** 'YYYY-MM-DD' → 'DD/MM/AA'. Vacío si no hay fecha. */
function fechaCorta(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

/**
 * Texto que entra sí o sí en su columna: primero achica la fuente, y recién si
 * aun así no entra corta con puntos suspensivos.
 *
 * `splitTextToSize(...)[0]` a secas cortaba en silencio y sin marca: una
 * localidad como SAN FRANCISCO SOLANO salía impresa "SAN", que en un papel que
 * se usa para manejar es peor que no poner nada.
 */
export function celda(
  pdf: jsPDF, txt: string, x: number, y: number, ancho: number, base: number,
) {
  let tam = base;
  pdf.setFontSize(tam);
  while (pdf.getTextWidth(txt) > ancho && tam > 6) {
    tam -= 0.5;
    pdf.setFontSize(tam);
  }
  let t = txt;
  if (pdf.getTextWidth(t) > ancho) {
    while (t.length > 1 && pdf.getTextWidth(`${t}…`) > ancho) t = t.slice(0, -1);
    t = `${t.trimEnd()}…`;
  }
  pdf.text(t, x, y);
  pdf.setFontSize(base);
}

/**
 * Mezcla de canales con el punto de color adelante de cada uno, con el nombre
 * que les pone el maestro.
 *
 * Es la única aclaración de qué significa cada color: los puntos del mapa y
 * los de la lista se pintan por canal, y sin esto el papel tiene colores que
 * no dicen nada. Va en los dos PDFs, que antes escribían la misma línea por su
 * cuenta y sin color.
 */
export function leyendaCanales(pdf: jsPDF, pdvs: PdvPlan[], x: number, y: number, tam = 8) {
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(tam);
  for (const { canal, color, n } of contarPorCanal(pdvs)) {
    const [r, g, b] = hexARgb(color);
    pdf.setFillColor(r, g, b);
    pdf.circle(x + 1.3, y - 1, 1.3, 'F');
    pdf.setTextColor(63, 63, 70);
    const txt = `${n} ${canal}`;
    pdf.text(txt, x + 3.6, y);
    x += 3.6 + pdf.getTextWidth(txt) + 6;
  }
}

// ---------------------------------------------------------------------------
// PDF A4 vertical. Una hoja nueva por día: el vendedor arranca el martes en una
// hoja limpia, no a mitad del lunes.
// ---------------------------------------------------------------------------
export async function generarHojaRuta(vendedor: string, dias: DiaRuta[]): Promise<void> {
  if (dias.length === 0) return;
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PAGE_W = 210, PAGE_H = 297, MARGIN = 12;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const AZUL: [number, number, number] = [12, 92, 171];
  const GRIS: [number, number, number] = [113, 113, 122];
  const BORDE: [number, number, number] = [228, 228, 231];
  const FILA_H = 6.2;
  const PIE_Y = PAGE_H - 12;

  // x de cada columna, en mm desde el margen. La suma es CONTENT_W (186).
  const COL = { check: 0, punto: 5, num: 7, id: 12, cliente: 26, dir: 86, loc: 148, vta: 174 };
  const ANCHO = { id: 12, cliente: 58, dir: 60, loc: 25, vta: 12 };

  const recorte = (txt: string, ancho: number) =>
    pdf.splitTextToSize(txt || '', ancho)[0] ?? '';

  function encabezadoDia(d: DiaRuta, pagina: number): number {
    pdf.setFillColor(...AZUL);
    pdf.rect(0, 0, PAGE_W, 22, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.text(`${(DIA_NOMBRE[d.dia] ?? d.dia).toUpperCase()}`, MARGIN, 11);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text(`${vendedor}  ·  ${d.pdvs.length} clientes`, MARGIN, 17.5);
    // El nombre de la zona sirve para volver al mapa cuando algo no cierra.
    const zonas = recorte(d.zonas.join('  ·  '), 80);
    if (zonas) pdf.text(zonas, PAGE_W - MARGIN, 17.5, { align: 'right' });
    if (pagina > 1) {
      pdf.setFontSize(9);
      pdf.text(`(cont.)`, PAGE_W - MARGIN, 11, { align: 'right' });
    }
    return 30;
  }

  function encabezadoTabla(y: number): number {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...GRIS);
    pdf.text('#', MARGIN + COL.num, y);
    pdf.text('ID', MARGIN + COL.id, y);
    pdf.text('CLIENTE', MARGIN + COL.cliente, y);
    pdf.text('DIRECCION', MARGIN + COL.dir, y);
    pdf.text('LOCALIDAD', MARGIN + COL.loc, y);
    pdf.text('ULT. VTA', MARGIN + COL.vta, y);
    pdf.setDrawColor(...BORDE);
    pdf.line(MARGIN, y + 1.8, PAGE_W - MARGIN, y + 1.8);
    return y + 6.5;
  }

  dias.forEach((d, iDia) => {
    if (iDia > 0) pdf.addPage();
    let pagina = 1;
    let y = encabezadoTabla(encabezadoDia(d, pagina));

    d.pdvs.forEach((p, i) => {
      if (y > PIE_Y - 10) {
        pdf.addPage();
        pagina += 1;
        y = encabezadoTabla(encabezadoDia(d, pagina));
      }
      // Cebra: 60 renglones seguidos sin franja se leen mal en la calle.
      if (i % 2 === 1) {
        pdf.setFillColor(248, 248, 249);
        pdf.rect(MARGIN, y - 4, CONTENT_W, FILA_H, 'F');
      }
      // Casilla para tildar la visita: el vendedor la usa como planilla.
      pdf.setDrawColor(...GRIS);
      pdf.rect(MARGIN + COL.check, y - 3.2, 3.2, 3.2);
      // Punto del color de su canal, igual que en el mapa y en el PDF de zonas.
      const [r, g, b] = hexARgb(colorPorCanal(p.canal_venta));
      pdf.setFillColor(r, g, b);
      pdf.circle(MARGIN + COL.punto, y - 1.2, 1.1, 'F');

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.setTextColor(9, 9, 11);
      pdf.text(String(i + 1), MARGIN + COL.num, y);
      // Código de cliente del maestro: es con lo que se lo busca en el sistema.
      celda(pdf, String(p.pdv_id), MARGIN + COL.id, y, ANCHO.id, 8.5);
      celda(pdf, p.razon_social ?? 's/n', MARGIN + COL.cliente, y, ANCHO.cliente, 8.5);
      celda(pdf, p.domicilio ?? '', MARGIN + COL.dir, y, ANCHO.dir, 8.5);
      pdf.setTextColor(...GRIS);
      celda(pdf, p.localidad ?? '', MARGIN + COL.loc, y, ANCHO.loc, 8.5);
      pdf.text(fechaCorta(p.ultima_vta), MARGIN + COL.vta, y);
      y += FILA_H;
    });

    // Mezcla de canales del día, abajo del listado: es además la referencia
    // del color de los puntos de la columna de la izquierda.
    if (y < PIE_Y - 6) {
      pdf.setDrawColor(...BORDE);
      pdf.line(MARGIN, y - 2, PAGE_W - MARGIN, y - 2);
      leyendaCanales(pdf, d.pdvs, MARGIN, y + 3);
    }
  });

  const hoy = new Date().toLocaleDateString('es-AR');
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(...BORDE);
    pdf.line(MARGIN, PIE_Y - 4, PAGE_W - MARGIN, PIE_Y - 4);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...GRIS);
    pdf.text(`Hoja de ruta · ${vendedor} · generada el ${hoy}`, MARGIN, PIE_Y);
    pdf.text(`Pagina ${p} / ${total}`, PAGE_W - MARGIN, PIE_Y, { align: 'right' });
  }

  pdf.save(`hoja_de_ruta_${vendedor}`.replace(/\s+/g, '_') + '.pdf');
}
