// Rendimiento y consistencia de los KPIs. Corre con:
//   node scripts/check-kpis.cjs           # mes en curso
//   node scripts/check-kpis.cjs 2026-07
//
// Mide los RPC contra la base real —sin el cache de Next, que en la app tapa
// el costo— y verifica que las tres vistas den lo mismo: el total tiene que
// ser la suma de los equipos, y el equipo la suma de sus vendedores. Si el
// resumen_diario quedó viejo respecto de ventas, también salta acá.
const assert = require('assert');
const { Pool } = require('pg');
const fs = require('fs');

for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const arg = process.argv[2];
const hoy = new Date();
const [anio, mes] = arg ? arg.split('-').map(Number) : [hoy.getFullYear(), hoy.getMonth() + 1];
const desde = `${anio}-${String(mes).padStart(2, '0')}-01`;
const hasta = new Date(anio, mes, 0).toISOString().slice(0, 10);

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const q = async (sql, params) => (await pool.query(sql, params)).rows;

const CORRIDAS = 5;
const medidas = [];
// Cuánto tarda un SELECT 1: es red y nada más. Corriendo desde una notebook
// contra Supabase son ~170ms que se suman a TODA medición, y sin descontarlos
// parece que cada RPC tarda 175ms cuando la base tarda 5.
let baseline = 0;

/** Corre la query N veces y guarda p50/max. La primera no cuenta: es el plan. */
async function medir(nombre, sql, params) {
  await q(sql, params);
  const t = [];
  for (let i = 0; i < CORRIDAS; i++) {
    const t0 = process.hrtime.bigint();
    await q(sql, params);
    t.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  t.sort((a, b) => a - b);
  const p50 = t[Math.floor(t.length / 2)];
  medidas.push({
    query: nombre,
    'p50 (ms)': +p50.toFixed(1),
    'max (ms)': +t[t.length - 1].toFixed(1),
    'sin red': +Math.max(0, p50 - baseline).toFixed(1),
  });
  return q(sql, params);
}

const suma = (rows, campo) => rows.reduce((s, r) => s + Number(r[campo] ?? 0), 0);
const casi = (a, b, msg, tol = 0.01) =>
  assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b} (dif ${(a - b).toFixed(4)})`);

(async () => {
  console.log(`KPIs de ${desde} a ${hasta}\n`);

  // Abrir las conexiones ANTES de medir: el handshake TLS son ~200ms por
  // conexión y se los comía entera la primera medición en paralelo.
  await Promise.all(Array.from({ length: 4 }, () => q('SELECT 1')));

  // Latencia de red, para poder descontarla del resto.
  {
    const t = [];
    for (let i = 0; i < 10; i++) {
      const t0 = process.hrtime.bigint();
      await q('SELECT 1');
      t.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    t.sort((a, b) => a - b);
    baseline = t[Math.floor(t.length / 2)];
    console.log(`latencia de red a la base: ${baseline.toFixed(1)} ms por ida y vuelta`);
    console.log('("sin red" descuenta eso: es lo que le cuesta a Postgres)');
  }

  const equipos = (await q(`SELECT DISTINCT equipo FROM resumen_diario WHERE equipo IS NOT NULL ORDER BY 1`)).map((r) => r.equipo);
  const vendedores = (await q(
    `SELECT DISTINCT vendedor FROM resumen_diario WHERE fecha BETWEEN $1 AND $2 AND vendedor IS NOT NULL ORDER BY 1`,
    [desde, hasta],
  )).map((r) => r.vendedor);

  // ── Rendimiento: lo que dispara una pantalla de dashboard ──────────────
  const total = await medir('kpi_resumen · empresa · mes',
    `SELECT * FROM kpi_resumen($1,$2,NULL,NULL)`, [desde, hasta]);
  await medir('kpi_resumen · empresa · 1 dia',
    `SELECT * FROM kpi_resumen($1,$1,NULL,NULL)`, [hasta]);
  await medir('kpi_resumen · empresa · 12 meses',
    `SELECT * FROM kpi_resumen($1,$2,NULL,NULL)`, [`${anio - 1}-${String(mes).padStart(2, '0')}-01`, hasta]);
  await medir(`kpi_resumen · equipo (${equipos[0]})`,
    `SELECT * FROM kpi_resumen($1,$2,$3,NULL)`, [desde, hasta, equipos[0]]);
  await medir(`kpi_resumen · vendedor (${vendedores[0]})`,
    `SELECT * FROM kpi_resumen($1,$2,NULL,$3)`, [desde, hasta, vendedores[0]]);
  await medir('kpi_por_vendedor · empresa', `SELECT * FROM kpi_por_vendedor($1,$2,NULL)`, [desde, hasta]);
  await medir('kpi_tendencia · empresa', `SELECT * FROM kpi_tendencia($1,$2,NULL,NULL)`, [desde, hasta]);
  await medir('kpi_dias_trabajados', `SELECT * FROM kpi_dias_trabajados($1,$2)`, [desde, hasta]);
  await medir('ccc_por_vendedor · empresa', `SELECT * FROM ccc_por_vendedor($1,$2,NULL)`, [desde, hasta]);

  // La pantalla del supervisor: sus KPIs y los de cada vendedor suyo, todo junto.
  // Se calienta el pool justo antes: pg cierra las conexiones ociosas a los 10s
  // y abrir cuatro de nuevo cuesta más que las cuatro consultas.
  const pantalla = () => Promise.all([
    q(`SELECT * FROM kpi_resumen($1,$2,$3,NULL)`, [desde, hasta, equipos[0]]),
    q(`SELECT * FROM kpi_por_vendedor($1,$2,$3)`, [desde, hasta, equipos[0]]),
    q(`SELECT * FROM kpi_dias_trabajados($1,$2,$3)`, [desde, hasta, equipos[0]]),
    q(`SELECT * FROM kpi_tendencia($1,$2,$3,NULL)`, [desde, hasta, equipos[0]]),
  ]);
  await pantalla();
  const t0 = process.hrtime.bigint();
  await pantalla();
  const tPantalla = Number(process.hrtime.bigint() - t0) / 1e6;
  medidas.push({
    query: 'pantalla supervisor (4 RPC juntos)',
    'p50 (ms)': +tPantalla.toFixed(1), 'max (ms)': '—',
    'sin red': +Math.max(0, tPantalla - baseline).toFixed(1),
  });

  console.table(medidas);

  // ── Consistencia ───────────────────────────────────────────────────────
  const totKilos = suma(total, 'kilos'), totNeto = suma(total, 'neto');
  console.log(`total del mes: ${totKilos.toFixed(1)} kg · $${totNeto.toFixed(0)} · ${total.length} rubros`);
  assert.ok(totKilos > 0, 'el mes no tiene ventas: revisar la carga');

  // 1) La suma de los equipos tiene que dar el total de la empresa. Lo que
  //    falte son filas con equipo NULL: ventas que se ven en Total Empresa y
  //    en ninguna pantalla de equipo. No es un bug de los RPC —es un nombre de
  //    vendedor que no matchea el maestro— así que se reporta y no se corta.
  let kEquipos = 0, nEquipos = 0;
  for (const e of equipos) {
    const r = await q(`SELECT * FROM kpi_resumen($1,$2,$3,NULL)`, [desde, hasta, e]);
    kEquipos += suma(r, 'kilos'); nEquipos += suma(r, 'neto');
  }
  const huerfanos = await q(
    `SELECT r.vendedor, ROUND(SUM(r.kilos)::numeric,1) kilos
       FROM resumen_diario r
      WHERE r.fecha BETWEEN $1 AND $2 AND r.equipo IS NULL
      GROUP BY 1 ORDER BY 2 DESC`, [desde, hasta]);
  if (huerfanos.length) {
    console.log(`⚠ ${(totKilos - kEquipos).toFixed(1)} kg ($${(totNeto - nEquipos).toFixed(0)}) sin equipo: se ven en Total Empresa y en ningún equipo`);
    for (const h of huerfanos) console.log(`    ${h.vendedor} — ${h.kilos} kg  (no matchea ningún nombre del maestro)`);
    const kHuerf = huerfanos.reduce((s, h) => s + Number(h.kilos), 0);
    casi(kEquipos + kHuerf, totKilos, 'kilos: equipos + huérfanos vs total', 0.5);
    console.log('✓ equipos + huérfanos dan el total (el agujero es de datos, no de los RPC)');
  } else {
    casi(kEquipos, totKilos, 'kilos: suma de equipos vs total');
    casi(nEquipos, totNeto, 'neto: suma de equipos vs total');
    console.log(`✓ ${equipos.length} equipos suman el total de la empresa`);
  }

  // 2) Y la de los vendedores de un equipo, el total de ese equipo.
  for (const e of equipos) {
    const eq = await q(`SELECT * FROM kpi_resumen($1,$2,$3,NULL)`, [desde, hasta, e]);
    const pv = await q(`SELECT * FROM kpi_por_vendedor($1,$2,$3)`, [desde, hasta, e]);
    casi(suma(pv, 'kilos'), suma(eq, 'kilos'), `kilos: vendedores vs equipo ${e}`);
    casi(suma(pv, 'neto'), suma(eq, 'neto'), `neto: vendedores vs equipo ${e}`);
  }
  console.log('✓ en cada equipo, sus vendedores suman el total del equipo');

  // 3) resumen_diario contra ventas: si el resumen quedó viejo, los KPIs
  //    muestran números que no existen en ninguna factura.
  const [v] = await q(
    `SELECT COALESCE(SUM(kilos),0) kilos, COALESCE(SUM(neto),0) neto FROM ventas WHERE fecha BETWEEN $1 AND $2`,
    [desde, hasta],
  );
  casi(totKilos, Number(v.kilos), 'kilos: resumen_diario vs ventas', 1);
  casi(totNeto, Number(v.neto), 'neto: resumen_diario vs ventas', 1);
  console.log('✓ resumen_diario coincide con ventas');

  // 4) Un rango de un solo día no puede dar más que el mes que lo contiene.
  const dia = await q(`SELECT * FROM kpi_resumen($1,$1,NULL,NULL)`, [hasta]);
  assert.ok(suma(dia, 'kilos') <= totKilos + 0.01, 'un dia da mas que el mes entero');
  console.log('✓ los rangos cierran');

  // 5) Las metas del mes tienen que existir para los que vendieron.
  const sinMeta = await q(
    `SELECT DISTINCT r.vendedor FROM resumen_diario r
      WHERE r.fecha BETWEEN $1 AND $2 AND r.vendedor IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM metas m WHERE m.vendedor_nombre = r.vendedor AND m.anio = $3 AND m.mes = $4)
      ORDER BY 1`, [desde, hasta, anio, mes]);
  if (sinMeta.length) console.log(`⚠ ${sinMeta.length} vendedores vendieron sin meta cargada: ${sinMeta.map((r) => r.vendedor).join(', ')}`);
  else console.log('✓ todos los que vendieron tienen meta');

  const lento = medidas.filter((m) => m['sin red'] > 300);
  console.log(lento.length ? `\n⚠ lentas (>500ms): ${lento.map((m) => m.query).join(' · ')}` : '\nKPIs: OK');
  await pool.end();
})().catch((e) => { console.error('\n✗', e.message); process.exit(1); });
