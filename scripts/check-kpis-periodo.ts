/**
 * Chequeo de los dos cálculos que se rompieron en silencio. Corre con:
 *   npm run check:periodo
 *
 * 1. El corte del período: con hoy en septiembre, pedir julio tiene que traer
 *    julio y nada más. Con `p_hasta = hoy` sumaba julio+agosto+septiembre y el
 *    dashboard mostraba 178.615 kg donde había 81.737.
 * 2. El cumplimiento en $ no es el de kilos: son dos metas distintas.
 */
import assert from 'assert';
import fs from 'fs';
import { hastaDelPeriodo, rangoDelPeriodo } from '@/lib/calculations/queries/shared';
import { buildKpi } from '@/lib/calculations/dashboard';

const hoy = new Date('2026-09-02T12:00:00');

// ── 1. corte del período ────────────────────────────────────────────────────
assert.strictEqual(hastaDelPeriodo(2026, 7, hoy), '2026-07-31', 'mes pasado: corta en fin de mes');
assert.strictEqual(hastaDelPeriodo(2026, 2, hoy), '2026-02-28', 'febrero no bisiesto');
assert.strictEqual(hastaDelPeriodo(2026, 9, hoy), '2026-09-02', 'mes corriente: corta hoy');
assert.strictEqual(hastaDelPeriodo(2026, 12, hoy), '2026-09-02', 'mes futuro: no adelanta ventas');
assert.deepStrictEqual(
  rangoDelPeriodo(2026, 7, hoy), { desde: '2026-07-01', hasta: '2026-07-31' },
  'el rango arranca el 1 y termina en el cierre',
);

// ── 2. kilos y $ tienen cada uno su cumplimiento ────────────────────────────
// Mes cerrado con la mezcla corrida: 90% de los kilos pero 120% de la plata.
const cerrado = buildKpi({
  rubro: 'Chocolates', year: 2026, month: 7, today: hoy,
  dias_laborables: 22, dias_trabajados: 22,
  acumulado: 900, meta: 1000,
  acumulado_minus7: 0, acumulado_minus14: 0, acumulado_aa: 0,
  neto_acumulado: 1_200_000, neto_meta_stored: 1_000_000,
  neto_minus7: 0, neto_minus14: 0, neto_acumulado_aa: 0,
});
assert.ok(Math.abs(cerrado.avance_pct - 90) < 0.01, `kilos: ${cerrado.avance_pct}`);
assert.ok(Math.abs(cerrado.neto_avance_pct - 120) < 0.01, `pesos: ${cerrado.neto_avance_pct}`);
assert.strictEqual(cerrado.tendencia, null, 'un mes cerrado no proyecta');

// Mes corriente: los dos porcentajes van sobre la tendencia, no sobre el acumulado.
const corriente = buildKpi({
  rubro: 'Chocolates', year: 2026, month: 9, today: hoy,
  dias_laborables: 20, dias_trabajados: 10,
  acumulado: 500, meta: 1000,
  acumulado_minus7: 0, acumulado_minus14: 0, acumulado_aa: 0,
  neto_acumulado: 300_000, neto_meta_stored: 1_000_000,
  neto_minus7: 0, neto_minus14: 0, neto_acumulado_aa: 0,
});
assert.ok(Math.abs(corriente.avance_pct - 100) < 0.01, `kilos proyectados: ${corriente.avance_pct}`);
assert.ok(Math.abs(corriente.neto_avance_pct - 60) < 0.01, `pesos proyectados: ${corriente.neto_avance_pct}`);

// Sin meta $ cargada, neto_meta se estima por ratio y los dos % coinciden: es
// correcto por construcción, y por eso el bug pasaba desapercibido.
const sinMetaPesos = buildKpi({
  rubro: 'Chocolates', year: 2026, month: 7, today: hoy,
  dias_laborables: 22, dias_trabajados: 22,
  acumulado: 900, meta: 1000,
  acumulado_minus7: 0, acumulado_minus14: 0, acumulado_aa: 0,
  neto_acumulado: 1_200_000, neto_meta_stored: null,
  neto_minus7: 0, neto_minus14: 0, neto_acumulado_aa: 0,
});
assert.ok(Math.abs(sinMetaPesos.neto_avance_pct - sinMetaPesos.avance_pct) < 0.01,
  'sin objetivo $ cargado, el % de pesos es el de kilos');

// ── 3. que nadie vuelva a armar el rango a mano ─────────────────────────────
// El bug no fue una cuenta mal hecha: fue pasarle `hoy` a un RPC que espera el
// cierre del período. Mientras el rango salga de rangoDelPeriodo no se repite;
// esto falla si alguien vuelve a escribirlo a mano en una consulta nueva.
const FUENTES = [
  'lib/calculations/queries/kpis.ts',
  'lib/calculations/queries/clientes.ts',
  'lib/calculations/productos.ts',
];
for (const f of FUENTES) {
  fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((linea, i) => {
    const m = linea.match(/p_hasta:\s*([A-Za-z0-9_().]+)/);
    if (m && /^(today|hoy)/i.test(m[1])) {
      assert.fail(`${f}:${i + 1} le pasa "${m[1]}" a p_hasta — usá rangoDelPeriodo(): ${linea.trim()}`);
    }
  });
}

console.log('✓ corte del período, cumplimiento kg/$ y rango sin armar a mano');
