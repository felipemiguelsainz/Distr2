/**
 * Chequeo de la hoja de ruta. Corre con:
 *   npx ts-node --project tsconfig.scripts.json -r tsconfig-paths/register scripts/check-hoja-ruta.ts
 *
 * Cubre lo único que puede romperse en silencio: el orden del recorrido y la
 * fusión de zonas por día. Un PDF mal ordenado no falla, sale — y el vendedor
 * se entera manejando.
 */
import assert from 'assert';
import { calleYAltura, ordenarParaRecorrer, rutaPorDia } from '@/lib/planificacion/hojaRuta';
import type { Cuadrante, PdvPlan } from '@/app/planificacion/types';

// ── calleYAltura: los formatos que trae el maestro ──────────────────────────
const casos: [string | null, string, number][] = [
  ['PRINGLES Nro.1629',                          'PRINGLES',       1629],
  ['CATAMARCA 4551',                             'CATAMARCA',      4551],
  ['SAN MARTIN NRO.8',                           'SAN MARTIN',        8],
  ['MOSCONI 25 Nro. (LAMADRID y JUJUY)',         'MOSCONI',          25],
  ['HUMBERTO PRIMO Nro.101 (SAN MARTIN y MORENO)', 'HUMBERTO PRIMO', 101],
  ['AV. CALCHAQUI S/N',                          'AV. CALCHAQUI S/N', 0], // sin altura
  [null,                                         '',                  0],
];
for (const [dom, calle, altura] of casos) {
  const r = calleYAltura(dom);
  assert.strictEqual(r.calle, calle, `calle de ${dom}: ${r.calle}`);
  assert.strictEqual(r.altura, altura, `altura de ${dom}: ${r.altura}`);
}

// ── Orden de recorrido ──────────────────────────────────────────────────────
const pdv = (id: number, domicilio: string, localidad: string): PdvPlan => ({
  pdv_id: id, lat: 0, lon: 0, razon_social: `C${id}`, domicilio,
  cartera: null, dia_visita: null, localidad, partido: null, zona: null,
  canal_venta: 'KIOSCO', ultima_vta: null,
});

const desordenados = [
  pdv(1, 'MITRE 100', 'QUILMES'),
  pdv(2, 'MITRE 9',   'QUILMES'),
  pdv(3, 'ALSINA 50', 'QUILMES'),
  pdv(4, 'MITRE 20',  'BERNAL'),
];
const ordenados = ordenarParaRecorrer(desordenados).map((p) => p.pdv_id);
// BERNAL antes que QUILMES; dentro de QUILMES ALSINA antes que MITRE; y la
// altura ordena como número: 9 antes que 100 (como string sería al revés).
assert.deepStrictEqual(ordenados, [4, 3, 2, 1], `orden: ${ordenados}`);

// ── Fusión de zonas por día ─────────────────────────────────────────────────
const cuad = (id: string, dia: Cuadrante['dia'], vendedor: string, pdv_ids: number[]): Cuadrante => ({
  id, nombre: `zona ${id}`, dia, vendedor_nombre: vendedor,
  color: '#000', poligono: [], localidad: null, pdv_ids,
});

const porId = new Map(desordenados.map((p) => [p.pdv_id, p]));
const semana = rutaPorDia(
  [
    cuad('a', 'LUN', 'ANA', [1, 2]),
    cuad('b', 'LUN', 'ANA', [3]),      // segunda zona del mismo día → misma hoja
    cuad('c', 'MIE', 'ANA', [1]),      // el mismo PDV otro día → sale en los dos
    cuad('d', 'MAR', 'BETO', [4]),     // otro vendedor → no entra
  ],
  porId,
  'ANA',
);

assert.deepStrictEqual(semana.map((d) => d.dia), ['LUN', 'MIE'], 'días cronológicos y sin vacíos');
assert.deepStrictEqual(semana[0].zonas, ['zona a', 'zona b'], 'las dos zonas del lunes');
assert.deepStrictEqual(semana[0].pdvs.map((p) => p.pdv_id), [3, 2, 1], 'lunes fusionado y ordenado');
assert.deepStrictEqual(semana[1].pdvs.map((p) => p.pdv_id), [1], 'el PDV de dos visitas sale también el miércoles');

// Un PDV repetido en dos zonas del mismo día se cuenta una sola vez (el UNIQUE
// de la 042 lo impide en la base, pero el papel no puede mandarlo dos veces).
const dup = rutaPorDia([cuad('a', 'LUN', 'ANA', [1]), cuad('b', 'LUN', 'ANA', [1])], porId, 'ANA');
assert.deepStrictEqual(dup[0].pdvs.map((p) => p.pdv_id), [1], 'sin duplicados dentro del día');

console.log('hoja de ruta: OK');

// ── recorteDeZona: el pedazo de mapa que va al PDF de la zona ───────────────
// Lo que puede salir mal sin avisar: un rectángulo fuera del canvas (queda una
// franja gris) o uno con otra proporción (el mapa sale deformado).
{
  const { recorteDeZona } = require('@/lib/planificacion/recorte') as
    typeof import('@/lib/planificacion/recorte');
  const W = 1200, H = 900, ASP = 180 / 115;
  const casi = (a: number, b: number, m: string) =>
    assert.ok(Math.abs(a - b) < 0.01, `${m}: ${a} vs ${b}`);

  // Zona chica en el medio: se acerca, y con la proporción de la hoja.
  const r = recorteDeZona([{ x: 500, y: 400 }, { x: 700, y: 600 }], W, H, ASP);
  casi(r.w / r.h, ASP, 'aspecto');
  assert.ok(r.w < W / 2, `tiene que acercarse, no abarcar todo: ${r.w}`);
  casi(r.x + r.w / 2, 600, 'centrado en x');
  casi(r.y + r.h / 2, 500, 'centrado en y');

  // Zona pegada al borde: el recorte se corre adentro, nunca se sale.
  for (const p of [[0, 0], [W, H], [0, H], [W, 0]] as [number, number][]) {
    const b = recorteDeZona([{ x: p[0], y: p[1] }, { x: p[0], y: p[1] }], W, H, ASP);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= W + 0.01 && b.y + b.h <= H + 0.01,
      `recorte fuera del canvas en ${p}: ${JSON.stringify(b)}`);
  }

  // Zona más grande que el contenedor: se queda con lo que hay.
  const g = recorteDeZona([{ x: -500, y: -500 }, { x: 2000, y: 2000 }], W, H, ASP);
  assert.deepStrictEqual(g, { x: 0, y: 0, w: W, h: H }, 'zona gigante');

  console.log('✓ recorteDeZona');
}
