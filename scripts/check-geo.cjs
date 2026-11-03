// Salud de las direcciones del maestro de PDVs. Corre con:
//   node scripts/check-geo.cjs              # resumen
//   node scripts/check-geo.cjs --listar     # + el detalle de cada caso
//   node scripts/check-geo.cjs --verificar 250   # ademas: contrasta N coords
//                                                # contra OSM (1 req/seg)
//
// Contesta una sola pregunta: ¿de los PDV activos, cuáles NO se pueden poner
// en el mapa donde realmente están? El upload ya valida contra el centroide de
// la localidad (bulk_upsert_pdvs_geo, mig. 029), así que lo que queda son los
// huecos que esa validación no puede tapar: PDV nuevos que nunca entraron a
// pdvs_geo, direcciones que el maestro trae vacías o sin altura, y coords que
// pasaron el filtro pero caen lejos de su localidad.
//
// Sale con código 1 sólo ante datos rotos (coords fuera del GBA, a más de
// 25 km de su localidad, o un PDV que vendió hace poco y no tiene ni domicilio
// ni localidad). Lo demás se informa y no frena nada: una coord "aproximada"
// es honesta, no un error — el mapa la muestra como tal.
/* eslint-disable @typescript-eslint/no-require-imports */
const { Pool } = require('pg');
const fs = require('fs');

for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const listar = process.argv.includes('--listar');
// --verificar [n]: cuantas coords contrastar contra OSM. Lento a proposito
// (Nominatim pide 1 req/seg), asi que por defecto no corre.
const iVerif = process.argv.indexOf('--verificar');
const verificar = iVerif === -1 ? 0 : (Number(process.argv[iVerif + 1]) || 250);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const n = (v) => Number(v).toLocaleString('es-AR');

// Un PDV "vivo" es el que compró en los últimos 90 días: es al que el vendedor
// va a ir a visitar, así que es el único cuya dirección importa hoy.
const VIVO = `p.ultima_vta >= current_date - 90`;

async function main() {
  const [tot] = await q(`
    SELECT
      count(*)                                                          AS activos,
      count(*) FILTER (WHERE ${VIVO})                                   AS vivos,
      count(*) FILTER (WHERE g.pdv_id IS NULL)                          AS sin_geo,
      count(*) FILTER (WHERE g.pdv_id IS NULL AND ${VIVO})              AS sin_geo_vivos,
      count(*) FILTER (WHERE g.aproximada)                              AS aproximadas,
      count(*) FILTER (WHERE g.pdv_id IS NOT NULL AND NOT g.aproximada) AS precisas,
      count(*) FILTER (WHERE coalesce(trim(p.domicilio),'') = ''
                         AND coalesce(trim(p.localidad),'') = '')       AS sin_direccion,
      count(*) FILTER (WHERE coalesce(trim(p.domicilio),'') = ''
                         AND coalesce(trim(p.localidad),'') = ''
                         AND ${VIVO})                                   AS sin_direccion_vivos,
      count(*) FILTER (WHERE coalesce(trim(p.domicilio),'') <> ''
                         AND p.domicilio !~ '[0-9]')                    AS sin_altura,
      count(*) FILTER (WHERE g.latitud IS NOT NULL
                         AND NOT (g.latitud  BETWEEN -35.6 AND -34.2
                              AND g.longitud BETWEEN -59.2 AND -57.7))  AS fuera_gba
    FROM pdvs p
    LEFT JOIN pdvs_geo g ON g.pdv_id = p.id
    WHERE p.activo`);

  const lejos = await q(`
    SELECT p.id, p.razon_social, p.domicilio, p.localidad, p.cartera,
           round(haversine_km(g.latitud, g.longitud, lg.lat, lg.lng), 1) AS km
    FROM pdvs_geo g
    JOIN pdvs p ON p.id = g.pdv_id AND p.activo
    JOIN localidades_geo lg ON lg.localidad = norm_localidad(p.localidad)
    WHERE NOT g.aproximada
      AND haversine_km(g.latitud, g.longitud, lg.lat, lg.lng) > 10
    ORDER BY km DESC`);

  const sinCentroide = await q(`
    SELECT norm_localidad(p.localidad) AS localidad, count(*)::int AS pdvs
    FROM pdvs p
    LEFT JOIN localidades_geo lg ON lg.localidad = norm_localidad(p.localidad)
    WHERE p.activo AND lg.localidad IS NULL AND norm_localidad(p.localidad) <> ''
    GROUP BY 1 ORDER BY 2 DESC`);

  const [dup] = await q(`
    SELECT count(*)::int AS grupos, coalesce(sum(t.n), 0)::int AS pdvs
    FROM (
      SELECT count(*) AS n
      FROM pdvs_geo g
      JOIN pdvs p ON p.id = g.pdv_id AND p.activo
      WHERE g.latitud IS NOT NULL AND NOT g.aproximada
      GROUP BY g.latitud, g.longitud
      HAVING count(*) > 2
    ) t`);

  // Integridad de la coordenada en si: que el par (lat,lng) sea el que es.
  // Un swap siempre es detectable porque los dos rangos del GBA no se solapan
  // (lat ~ -34.x, lng ~ -58.x): con las coords dadas vuelta, lat < lng.
  const [coord] = await q(`
    SELECT
      count(*)                                                            AS con_coord,
      count(*) FILTER (WHERE g.latitud = 0 OR g.longitud = 0)              AS en_cero,
      count(*) FILTER (WHERE g.latitud  NOT BETWEEN -90  AND 90
                          OR g.longitud NOT BETWEEN -180 AND 180)          AS fuera_del_planeta,
      count(*) FILTER (WHERE g.latitud > 0 OR g.longitud > 0)              AS hemisferio_mal,
      count(*) FILTER (WHERE g.latitud < g.longitud)                       AS invertidas,
      count(*) FILTER (WHERE scale(g.latitud) < 4 OR scale(g.longitud) < 4) AS poca_precision,
      round(max(haversine_km(g.latitud, g.longitud,
                             round(g.latitud, 5), round(g.longitud, 5))) * 1000, 2) AS metros_redondeo
    FROM pdvs_geo g JOIN pdvs p ON p.id = g.pdv_id AND p.activo
    WHERE g.latitud IS NOT NULL AND g.longitud IS NOT NULL`);

  const pct = (x) => `${((x / tot.activos) * 100).toFixed(1)}%`;

  console.log(`\nPDV activos: ${n(tot.activos)}  (compraron en 90 días: ${n(tot.vivos)})\n`);
  console.log(`  ubicación a nivel calle   ${n(tot.precisas).padStart(6)}   ${pct(tot.precisas)}`);
  console.log(`  ubicación aproximada      ${n(tot.aproximadas).padStart(6)}   ${pct(tot.aproximadas)}   centro del barrio; el mapa lo aclara`);
  console.log(`  sin ubicación             ${n(tot.sin_geo).padStart(6)}   ${pct(tot.sin_geo)}   de ellos ${n(tot.sin_geo_vivos)} compraron en 90 días`);

  console.log(`\nDirecciones del maestro:`);
  console.log(`  sin domicilio ni localidad ${n(tot.sin_direccion).padStart(5)}   ${n(tot.sin_direccion_vivos)} con venta reciente`);
  console.log(`  calle sin altura           ${n(tot.sin_altura).padStart(5)}   nunca van a pasar de barrio`);

  if (sinCentroide.length > 0) {
    const pdvs = sinCentroide.reduce((s, r) => s + r.pdvs, 0);
    console.log(`  localidad sin centroide    ${n(pdvs).padStart(5)}   en ${sinCentroide.length}: ${sinCentroide.slice(0, 5).map((r) => `${r.localidad} (${r.pdvs})`).join(', ')}`);
    console.log(`${' '.repeat(29)}corregible con: SELECT refresh_localidades_geo();`);
  }

  if (dup.grupos > 0) {
    console.log(`  coords repetidas           ${n(dup.pdvs).padStart(5)}   ${dup.grupos} puntos con 3+ PDV "precisos" encima`);
  }

  console.log(`\nCoordenadas (${n(coord.con_coord)}):`);
  console.log(`  en (0,0) o fuera del planeta   ${Number(coord.en_cero) + Number(coord.fuera_del_planeta)}`);
  console.log(`  en el hemisferio equivocado    ${coord.hemisferio_mal}`);
  console.log(`  lat/lng invertidas             ${coord.invertidas}`);
  console.log(`  menos de 4 decimales           ${coord.poca_precision}   (4 decimales = 11 m)`);
  console.log(`  el mapa las redondea a 5 dec.  mueve el pin ${coord.metros_redondeo} m como maximo`);

  if (lejos.length > 0) {
    console.log(`\nCoords lejos del centro de su localidad (>10 km) — ${lejos.length}:`);
    for (const r of lejos) {
      console.log(`  #${r.id}  ${r.km} km  ${r.localidad} — ${r.domicilio ?? ''}  (${r.cartera ?? 's/cartera'})`);
    }
  }

  if (listar) {
    const sinGeo = await q(`
      SELECT p.id, p.razon_social, p.domicilio, p.localidad, p.cartera, p.ultima_vta
      FROM pdvs p LEFT JOIN pdvs_geo g ON g.pdv_id = p.id
      WHERE p.activo AND g.pdv_id IS NULL
      ORDER BY p.ultima_vta DESC NULLS LAST`);
    console.log(`\nSin ubicación (${sinGeo.length}):`);
    for (const r of sinGeo) {
      const vta = r.ultima_vta ? r.ultima_vta.toISOString().slice(0, 10) : 'nunca';
      console.log(`  #${r.id}  ${vta}  ${r.localidad ?? '—'} — ${r.domicilio ?? '(sin domicilio)'}  (${r.cartera ?? 's/cartera'})`);
    }
  }

  // ---- Veredicto -----------------------------------------------------------
  const rotos = [];
  if (Number(tot.fuera_gba) > 0) rotos.push(`${tot.fuera_gba} coords fuera del GBA`);
  if (Number(coord.invertidas) > 0) rotos.push(`${coord.invertidas} coords con lat/lng invertidas`);
  if (Number(coord.en_cero) + Number(coord.fuera_del_planeta) > 0) {
    rotos.push(`${Number(coord.en_cero) + Number(coord.fuera_del_planeta)} coords imposibles`);
  }
  if (Number(coord.hemisferio_mal) > 0) rotos.push(`${coord.hemisferio_mal} coords en otro hemisferio`);
  const muyLejos = lejos.filter((r) => Number(r.km) > 25);
  if (muyLejos.length > 0) rotos.push(`${muyLejos.length} coords a más de 25 km de su localidad`);
  if (Number(tot.sin_direccion_vivos) > 0) {
    rotos.push(`${tot.sin_direccion_vivos} PDV con venta reciente y sin domicilio ni localidad`);
  }

  if (verificar > 0) await contraOsm(verificar);

  if (rotos.length > 0) {
    console.log(`\n✗ ${rotos.join('; ')}`);
    process.exit(1);
  }
  console.log(`\n✓ ninguna dirección rota; lo de arriba es lo que falta completar.`);
}

// ---------------------------------------------------------------------------
// Contraste contra OSM: la unica forma de saber si el pin cae en la direccion
// y no solo si la coord es formalmente valida. Reverse-geocode de la coord
// guardada y comparacion de la calle contra el domicilio del maestro.
//
// El numero que sale es un PISO, no la verdad: el callejero de OSM en el GBA
// tiene huecos y hay direcciones que no se pueden comparar por nombre (una
// esquina, una calle numerada que ademas tiene nombre). Un "otra calle" es
// para ir a mirar, no una condena — por eso no cuenta para el veredicto.
// ---------------------------------------------------------------------------
const UA = 'Distr2-geocheck/1.0 (felipemiguelsainz@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Palabras que no identifican una calle: si dos direcciones solo comparten
// esto, no comparten nada.
const GENERICAS = new Set(['AVENIDA', 'AV', 'CALLE', 'CAMINO', 'GENERAL', 'DOCTOR', 'PASAJE',
  'CORONEL', 'PRESIDENTE', 'SARGENTO', 'INTENDENTE', 'GOBERNADOR', 'DIAGONAL', 'RUTA',
  'BOULEVARD', 'DEL', 'DE', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'NRO', 'ESQ', 'ENTRE']);

const ABREV = [[/\bAV(DA?)?\b\.?/g, 'AVENIDA'], [/\bGRAL\b\.?/g, 'GENERAL'],
  [/\bDR\b\.?/g, 'DOCTOR'], [/\bPJE\b\.?/g, 'PASAJE'], [/\bCNEL\b\.?/g, 'CORONEL'],
  [/\bPTE\b\.?/g, 'PRESIDENTE'], [/\bSGTO\b\.?/g, 'SARGENTO'],
  [/\bINT\b\.?/g, 'INTENDENTE'], [/\bCMNO\b\.?/g, 'CAMINO']];

function norm(s) {
  let t = String(s || '').toUpperCase().replace(/#/g, 'N')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [re, to] of ABREV) t = t.replace(re, to);
  return t.replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** La altura SOLO cuando viene marcada (N / Nro). Si no, no se descarta ningun
    numero: en Solano y Berazategui las calles SON numeros, y sacarlos daba
    falsos negativos ("CALLE 4 N 1495" contra "Calle 4"). */
function altura(dom) {
  const m = norm(dom).match(/\bN(?:RO)?\s*(\d+)/);
  return m ? m[1] : null;
}

/** Los tokens que identifican la calle, sin genericas ni la altura. */
function tokensCalle(s, alturaFuera) {
  return norm(s).split(' ').filter((t) => {
    if (GENERICAS.has(t)) return false;
    if (/^\d+$/.test(t)) return !(alturaFuera && t === alturaFuera);
    return t.length >= 4;
  });
}

async function contraOsm(limite) {
  const rows = await q(`
    SELECT p.id, p.domicilio, p.localidad, g.latitud, g.longitud, g.aproximada
    FROM pdvs_geo g JOIN pdvs p ON p.id = g.pdv_id AND p.activo
    WHERE g.latitud IS NOT NULL AND coalesce(trim(p.domicilio),'') <> ''
    ORDER BY random() LIMIT $1`, [limite]);

  const min = Math.ceil((rows.length * 1.1) / 60);
  console.log(`\nContrastando ${rows.length} coords contra OSM (~${min} min, 1 req/seg)...`);

  let iguales = 0, distintas = 0, sinCalle = 0, sinRed = 0, cerca = 0, comparables = 0;
  const sospechosos = [];

  for (const r of rows) {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2`
      + `&lat=${r.latitud}&lon=${r.longitud}&zoom=18&addressdetails=1`;
    let d = null;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } });
      if (res.ok) d = await res.json();
    } catch { /* sin red: se cuenta aparte */ }
    await sleep(1100);

    const a = (d && d.address) || null;
    if (!a) { sinRed++; continue; }
    if (!a.road) { sinCalle++; continue; }

    const alt = altura(r.domicilio);
    const tMae = tokensCalle(r.domicilio, alt);
    if (tokensCalle(a.road, null).some((t) => tMae.includes(t))) {
      iguales++;
      if (alt && /^\d+$/.test(String(a.house_number ?? ''))) {
        comparables++;
        if (Math.abs(Number(alt) - Number(a.house_number)) <= 20) cerca++;
      }
    } else {
      distintas++;
      if (sospechosos.length < 20) {
        sospechosos.push(`  #${r.id}${r.aproximada ? ' [aprox]' : ''}  ${r.domicilio} | ${r.localidad}`
          + `\n      OSM ve: ${a.road} ${a.house_number ?? ''} | ${a.town || a.city || a.suburb || '?'}`);
      }
    }
  }

  const comp = iguales + distintas;
  if (comp === 0) { console.log('  OSM no devolvio ninguna calle.'); return; }
  console.log(`  cae en la misma calle   ${iguales}  ${((iguales / comp) * 100).toFixed(1)}%`);
  console.log(`  cae en otra calle       ${distintas}  ${((distintas / comp) * 100).toFixed(1)}%`);
  if (comparables > 0) {
    console.log(`  de las que coinciden, ${cerca}/${comparables} caen a menos de 20 numeros de la altura`);
  }
  if (sinCalle || sinRed) console.log(`  (sin calle en OSM: ${sinCalle}; sin respuesta: ${sinRed})`);
  if (sospechosos.length > 0) {
    console.log(`\n  Para ir a mirar al mapa:`);
    console.log(sospechosos.join('\n'));
  }
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
