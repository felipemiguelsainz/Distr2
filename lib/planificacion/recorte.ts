// ---------------------------------------------------------------------------
// Qué pedazo de la captura del mapa va a la hoja.
//
// El contenedor del mapa es bien apaisado y `fitBounds` ajusta contra el lado
// que sobra: una zona más o menos cuadrada terminaba ocupando un tercio del
// ancho, con medio conurbano alrededor y las etiquetas de las zonas vecinas
// encima. Se recorta a la caja del polígono más un poco de aire.
//
// Vive acá y no dentro del componente porque es geometría pura: así se puede
// verificar sin navegador (ver scripts/check-hoja-ruta.ts).
// ---------------------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * @param pts     vértices del polígono, en píxeles del contenedor
 * @param W,H     tamaño del contenedor, en los mismos píxeles
 * @param aspecto ancho/alto que le toca a la imagen en la hoja
 * @param aire    margen alrededor de la zona, como fracción de su lado mayor
 */
export function recorteDeZona(
  pts: { x: number; y: number }[],
  W: number, H: number,
  aspecto: number,
  aire = 0.08,
): Rect {
  if (pts.length === 0) return { x: 0, y: 0, w: W, h: H };
  let x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
  let y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));

  const m = Math.max(x1 - x0, y1 - y0) * aire;
  x0 -= m; x1 += m; y0 -= m; y1 += m;

  // Estirar al aspecto de la hoja: así entra sin deformarse y usando todo el
  // ancho, en vez de quedar centrada y flaca.
  let w = x1 - x0, h = y1 - y0;
  if (w / h < aspecto) { const n = h * aspecto; x0 -= (n - w) / 2; w = n; }
  else                 { const n = w / aspecto; y0 -= (n - h) / 2; h = n; }

  // Y adentro del canvas: afuera de sus bordes no hay imagen que copiar.
  w = Math.min(w, W); h = Math.min(h, H);
  return {
    x: Math.max(0, Math.min(x0, W - w)),
    y: Math.max(0, Math.min(y0, H - h)),
    w, h,
  };
}
