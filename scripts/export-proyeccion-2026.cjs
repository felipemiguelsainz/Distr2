// Proyección oct-dic 2026 por rubro con estacionalidad histórica en kg -> proyeccion_estacionalidad_2026.xlsx
//   node scripts/export-proyeccion-2026.cjs [archivo.xlsx]
// índice_mes   = promedio sobre años completos de (kg_mes / kg_año)
// kg_proyectado = kg del mes anterior × (índice_mes / índice_mes_anterior), encadenado desde sep 2026
// $_proyectado  = kg_proyectado × $/kg promedio ene-sep 2026
/* eslint-disable @typescript-eslint/no-require-imports */
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const fs = require('fs');

for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const ANIO = 2026;
const ULTIMO_REAL = 9; // septiembre: último mes cerrado; octubre en curso no entra
const VENTANA = 3; // rubros sin histórico: promedio de los últimos 3 meses cerrados
const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const AZUL = 'FF0C3366';
const GRIS = 'FFF5F5F5';
const AMARILLO = 'FFFFFBE6';
const NUM = '#,##0';
const PCT = '0.0%';
const col = (i) => String.fromCharCode(65 + i); // 0 -> A
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const prom = (xs) => sum(xs) / xs.length;
const desvio = (xs) => {
  const m = prom(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
};
const div = (a, b) => (b ? a / b : 0);
const L_ULT = col(ULTIMO_REAL); // J
const mesUlt = MESES[ULTIMO_REAL - 1].toLowerCase();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

async function main() {
  const { rows } = await pool.query(
    `SELECT rubro, EXTRACT(YEAR FROM fecha)::int AS anio, EXTRACT(MONTH FROM fecha)::int AS mes,
            SUM(kilos)::float8 AS kilos, SUM(neto)::float8 AS neto
       FROM resumen_diario
      WHERE fecha < make_date($1, $2 + 1, 1)
      GROUP BY 1, 2, 3`,
    [ANIO, ULTIMO_REAL],
  );

  // Años históricos = los anteriores a 2026 con los 12 meses cargados.
  const mesesPorAnio = new Map();
  for (const r of rows) {
    if (r.anio < ANIO) (mesesPorAnio.get(r.anio) ?? mesesPorAnio.set(r.anio, new Set()).get(r.anio)).add(r.mes);
  }
  const historicos = [...mesesPorAnio].filter(([, s]) => s.size === 12).map(([a]) => a).sort();
  if (!historicos.length) throw new Error('No hay ningún año completo para calcular estacionalidad');
  const anios = [...historicos, ANIO];
  const rubros = [...new Set(rows.map((r) => r.rubro))].sort();
  const anterior = historicos.includes(ANIO - 1) ? ANIO - 1 : null;

  const datos = new Map(); // `${campo}|${rubro}|${anio}` -> [12]
  for (const r of rows) {
    for (const k of [r.rubro, 'TOTAL']) {
      for (const campo of ['kilos', 'neto']) {
        const key = `${campo}|${k}|${r.anio}`;
        if (!datos.has(key)) datos.set(key, Array(12).fill(0));
        datos.get(key)[r.mes - 1] += r[campo];
      }
    }
  }
  const serie = (campo, rubro, anio) => datos.get(`${campo}|${rubro}|${anio}`) ?? Array(12).fill(0);
  const pesosDe = (rubro, años) =>
    MESES.map((_, m) => prom(años.map((a) => serie('kilos', rubro, a)[m] / sum(serie('kilos', rubro, a)))));
  const pesosTotal = pesosDe('TOTAL', historicos);

  // Layout fijo, igual en todas las hojas (las hojas sin histórico referencian a TOTAL).
  const R_HEAD_KG = 5;
  const rKg = (a) => R_HEAD_KG + 1 + anios.indexOf(a);
  const R_KG26 = rKg(ANIO);
  const R_PESO = R_KG26 + 1;
  const R_STD = R_KG26 + 2;
  const R_VAR = R_KG26 + 3;
  const R_HEAD_P = R_VAR + 3;
  const rP = (a) => R_HEAD_P + 1 + anios.indexOf(a);
  const R_P26 = rP(ANIO);
  const R_SEC2 = R_P26 + 3;
  const R_HEAD2 = R_SEC2 + 1;
  const R_ACUM = R_HEAD2 + 1;
  const R_TOT = R_ACUM + 1 + (12 - ULTIMO_REAL);
  const R_NOTA = R_TOT + 2;

  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true;

  // Proyección en JS (para los valores cacheados de las fórmulas). Tres modos:
  //  estacional -> rubro con histórico: parte del último mes real y le aplica la
  //                variación histórica contra el mes anterior (oct = sep × oct/sep
  //                de 2025, y así encadenado). Escalar todo el acumulado ene-sep
  //                arrastraba los meses flojos de 2025 y daba oct +19% sobre sep.
  //  ritmo      -> rubro sin histórico (GENOMA): no hay estacionalidad propia que
  //                aplicar, y escalar su acumulado arrastraba el pico del
  //                lanzamiento de enero. Se usa el promedio de los últimos meses.
  //  suma       -> TOTAL = suma de los rubros. Proyectarlo con su propio $/kg
  //                mezclaba rubros de precios muy distintos y daba ~$140M más.
  const proy = new Map();
  for (const rubro of rubros) {
    const validos = historicos.filter((a) => sum(serie('kilos', rubro, a)) > 0);
    const pesos = validos.length ? pesosDe(rubro, validos) : null;
    const kg26 = serie('kilos', rubro, ANIO);
    const $26 = serie('neto', rubro, ANIO);
    const desde = pesos ? 0 : ULTIMO_REAL - VENTANA; // de dónde sale el $/kg
    const precio = div(sum($26.slice(desde, ULTIMO_REAL)), sum(kg26.slice(desde, ULTIMO_REAL)));
    const kgRitmo = prom(kg26.slice(ULTIMO_REAL - VENTANA, ULTIMO_REAL));
    const kgProy = kg26.slice(0, ULTIMO_REAL);
    for (let m = ULTIMO_REAL; m < 12; m++) {
      kgProy.push(pesos ? kgProy[m - 1] * div(pesos[m], pesos[m - 1]) : kgRitmo);
    }
    const $Proy = $26.map((x, m) => (m < ULTIMO_REAL ? x : kgProy[m] * precio));
    proy.set(rubro, { modo: pesos ? 'estacional' : 'ritmo', validos, pesos, kgProy, $Proy });
  }
  proy.set('TOTAL', {
    modo: 'suma', validos: historicos, pesos: pesosTotal,
    kgProy: MESES.map((_, m) => sum(rubros.map((r) => proy.get(r).kgProy[m]))),
    $Proy: MESES.map((_, m) => sum(rubros.map((r) => proy.get(r).$Proy[m]))),
  });
  const sumaHojas = (celda) => rubros.map((r) => `'${r.slice(0, 31)}'!${celda}`).join('+');
  const L_VENT = col(ULTIMO_REAL - VENTANA + 1); // primera columna de la ventana (H = jul)
  const mesVent = MESES[ULTIMO_REAL - VENTANA].toLowerCase();

  // Primera hoja: resumen y explicación para quien recibe el archivo (no técnico).
  {
    const ws = wb.addWorksheet('Cómo se calculó');
    const N = 5; // columnas A:E
    [30, 20, 20, 20, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    const ancho = 100; // caracteres aprox. en A:E, para el alto de las filas de texto
    let r = 1;
    const texto = (t, estilo = {}) => {
      ws.mergeCells(r, 1, r, N);
      const c = ws.getCell(r, 1);
      c.value = t;
      c.alignment = { wrapText: true, vertical: 'top' };
      c.font = estilo;
      ws.getRow(r).height = Math.max(1, Math.ceil(t.length / ancho)) * 15 + 2;
      r++;
    };
    const subtitulo = (t) => { r++; texto(t, { bold: true, size: 12, color: { argb: AZUL } }); };

    ws.mergeCells(r, 1, r, N);
    ws.getCell(r, 1).value = `Proyección de ventas oct-dic ${ANIO}`;
    estiloHeader(ws.getRow(r), N);
    ws.getRow(r).height = 22;
    r++;
    texto(`Ventas reales hasta ${MESES[ULTIMO_REAL - 1].toLowerCase()} ${ANIO} y proyección de octubre a diciembre, por rubro.`,
      { italic: true, color: { argb: 'FF555555' } });

    subtitulo('Resumen (toda la distribuidora, en $)');
    ws.getRow(r).values = ['Mes', `Proyectado ${ANIO}`, `Real ${ANIO - 1}`, 'Diferencia', 'Variación'];
    estiloHeader(ws.getRow(r), N);
    r++;
    const t = proy.get('TOTAL');
    const t$Ant = serie('neto', 'TOTAL', ANIO - 1);
    const filas = [
      ...MESES.slice(ULTIMO_REAL).map((m, k) => [
        `${m} (proyectado)`, R_ACUM + 1 + k, t.$Proy[ULTIMO_REAL + k], t$Ant[ULTIMO_REAL + k]]),
      [`Año ${ANIO} completo`, R_TOT, sum(t.$Proy), sum(t$Ant)],
    ];
    filas.forEach(([label, fila, a, b], i) => {
      const row = ws.getRow(r);
      row.values = [label, { formula: `TOTAL!D${fila}`, result: a }, { formula: `TOTAL!F${fila}`, result: b },
        { formula: `B${r}-C${r}`, result: a - b }, { formula: `IF(C${r}=0,"",B${r}/C${r}-1)`, result: b ? a / b - 1 : '' }];
      cebra(row, i, N);
      if (i < filas.length - 1) row.getCell(2).fill = fill(AMARILLO);
      else {
        row.font = { bold: true };
        for (let c = 1; c <= N; c++) row.getCell(c).border = { top: { style: 'double' } };
      }
      for (const c of [2, 3, 4]) row.getCell(c).numFmt = NUM;
      row.getCell(5).numFmt = PCT;
      r++;
    });

    const pasos = [
      'Se parte de los kilos, no de la plata. Así el aumento de precios no se confunde con más ventas.',
      `Estacionalidad: cuánto cambiaron los kilos de cada mes respecto del mes anterior en ${historicos.join(', ')}. Por ejemplo, si en ${historicos.at(-1)} octubre vendió 5% más kilos que septiembre, se espera una suba parecida.`,
      `Kilos de oct-dic: se parte de los kilos reales de ${MESES[ULTIMO_REAL - 1].toLowerCase()} ${ANIO}, el último mes cerrado, y se le aplica esa variación mes a mes: octubre sale de septiembre, noviembre de octubre y diciembre de noviembre. Así la proyección arranca del nivel de venta actual.`,
      `Plata de oct-dic: kilos proyectados × precio promedio por kilo de ene-${mesUlt} ${ANIO}, calculado para cada rubro por separado.`,
      'El total de la distribuidora es la suma de los rubros. Cada rubro tiene su propio patrón y su propio precio por kilo: Chocolates baja en octubre y Biscuits sube, y mezclarlos en un solo cálculo inflaba el total.',
      `GENOMA arrancó en ${ANIO} y no tiene un año anterior para sacar su patrón. Además, enero tuvo un pico de kilos por el lanzamiento. Por eso se proyecta con el promedio de ${mesVent}-${mesUlt}, que es su ritmo actual.`,
    ];
    subtitulo('Cómo se calculó');
    pasos.forEach((p, i) => texto(`${i + 1}. ${p}`));

    const cuidados = [
      `Hay un solo año completo de historia (${historicos.join(', ')}). El patrón de cada mes sale de ese año, así que un mes atípico en ${historicos.at(-1)} se repite en la proyección. Con más años se podría medir qué tan estable es cada mes.`,
      `El precio por kilo es el promedio de ene-${mesUlt}. Si los precios siguen subiendo, la plata de oct-dic puede quedar algo corta: lo más firme de la proyección son los kilos.`,
      `La proyección arranca de ${MESES[ULTIMO_REAL - 1].toLowerCase()}: si ese mes fue atípico en algún rubro (por ejemplo Beverages, que en ${MESES[ULTIMO_REAL - 1].toLowerCase()} casi duplicó jul-ago), ese salto se arrastra a oct-dic.`,
      `Others casi no tuvo ventas en ${ANIO}, por eso su proyección es prácticamente cero.`,
    ];
    subtitulo('Para tener en cuenta');
    cuidados.forEach((p) => texto(`• ${p}`));

    subtitulo('Cómo leer las otras hojas');
    texto('Hay una hoja por rubro y una TOTAL. Arriba: los kilos de cada mes, el peso de cada mes en el año y la variación contra el mes anterior. Debajo: lo mismo en pesos. Al final: el resumen del año comparado con el anterior.');
    texto('Las celdas amarillas son proyectadas; el resto son ventas reales. La línea azul marca dónde termina lo real.');
  }

  for (const rubro of ['TOTAL', ...rubros]) {
    const ws = wb.addWorksheet(rubro.slice(0, 31));
    const { modo, validos, pesos, kgProy, $Proy } = proy.get(rubro);
    const kg26 = serie('kilos', rubro, ANIO);
    const $26 = serie('neto', rubro, ANIO);
    const kgAcum = sum(kg26.slice(0, ULTIMO_REAL));
    const $Acum = sum($26.slice(0, ULTIMO_REAL));
    const precio = div($Acum, kgAcum);

    // Título
    ws.mergeCells(1, 1, 1, 14);
    ws.getCell('A1').value = `${rubro} — Proyección de ventas ${ANIO} (estacionalidad en kg → $)`;
    estiloHeader(ws.getRow(1), 14);
    ws.getRow(1).height = 22;
    ws.getCell('A2').value = {
      estacional:
        `Peso del mes = promedio de (kg del mes / kg del año) en ${historicos.join(', ')}. ` +
        `Kg proyectado = kg del mes anterior × (1 + variación vs mes anterior), arrancando de ${mesUlt} ${ANIO} real. ` +
        `$ proyectado = kg proyectado × $/kg promedio ene-${mesUlt} ${ANIO}.`,
      ritmo:
        `Sin ventas en ${historicos.join(', ')}: no hay estacionalidad propia. ` +
        `Kg proyectado = promedio ${mesVent}-${mesUlt} ${ANIO}; $ proyectado = kg × $/kg de ${mesVent}-${mesUlt}.`,
      suma:
        'Proyectado = suma de las hojas de cada rubro (cada uno con su estacionalidad y su $/kg). ' +
        `La tabla de pesos muestra la estacionalidad en kg de la empresa en ${historicos.join(', ')}, como referencia.`,
    }[modo] + (historicos.length < 2 && modo !== 'ritmo' ? ' Con un solo año completo el desvío no se puede calcular.' : '');
    nota(ws.getCell('A2'));

    // Sección 1a — kg
    titulo(ws.getCell(R_HEAD_KG - 1, 1), 'Sección 1 — Histórico de estacionalidad en kg');
    ws.getRow(R_HEAD_KG).values = ['Año', ...MESES, 'Total anual'];
    estiloHeader(ws.getRow(R_HEAD_KG), 14);
    anios.forEach((a, i) => {
      const r = rKg(a);
      const row = ws.getRow(r);
      const v = a === ANIO ? kgProy : serie('kilos', rubro, a);
      row.getCell(1).value = a === ANIO ? `${a} (real + proy.)` : a;
      for (let m = 0; m < 12; m++) {
        const L = col(m + 1);
        row.getCell(m + 2).value =
          a === ANIO && m >= ULTIMO_REAL
            ? {
              formula: {
                estacional: `${col(m)}${r}*(1+${L}${R_VAR})`,
                ritmo: `AVERAGE($${L_VENT}${r}:$${L_ULT}${r})`,
                suma: sumaHojas(`${L}${r}`),
              }[modo],
              result: v[m],
            }
            : v[m];
      }
      row.getCell(14).value = { formula: `SUM(B${r}:M${r})`, result: sum(v) };
      cebra(row, i, 14);
      for (let c = 2; c <= 14; c++) row.getCell(c).numFmt = NUM;
    });

    const peso = ws.getRow(R_PESO);
    const std = ws.getRow(R_STD);
    const vari = ws.getRow(R_VAR);
    peso.getCell(1).value = 'Peso promedio %';
    std.getCell(1).value = 'Desvío std';
    vari.getCell(1).value = 'Variación vs mes anterior';
    for (let m = 0; m < 12; m++) {
      // Enero se compara con diciembre.
      const L = col(m + 1);
      const Lant = col(m === 0 ? 12 : m);
      const ant = pesos?.[m === 0 ? 11 : m - 1];
      vari.getCell(m + 2).value = pesos
        ? { formula: `IF(${Lant}${R_PESO}=0,0,${L}${R_PESO}/${Lant}${R_PESO}-1)`, result: ant ? pesos[m] / ant - 1 : 0 }
        : 'n/d';
    }
    for (let m = 0; m < 12; m++) {
      const L = col(m + 1);
      const ratios = validos.map((a) => `${L}${rKg(a)}/$N${rKg(a)}`).join(',');
      peso.getCell(m + 2).value = pesos ? { formula: `AVERAGE(${ratios})`, result: pesos[m] } : 'n/d';
      std.getCell(m + 2).value =
        validos.length >= 2
          ? { formula: `STDEV(${ratios})`, result: desvio(validos.map((a) => serie('kilos', rubro, a)[m] / sum(serie('kilos', rubro, a)))) }
          : 'n/d';
    }
    if (pesos) peso.getCell(14).value = { formula: `SUM(B${R_PESO}:M${R_PESO})`, result: 1 };
    for (const r of [peso, std, vari]) {
      r.font = { bold: true };
      for (let c = 2; c <= 14; c++) Object.assign(r.getCell(c), { numFmt: PCT, alignment: { horizontal: 'right' } });
    }
    for (let c = 1; c <= 14; c++) peso.getCell(c).border = { top: { style: 'double' } };

    // Sección 1b — $ (referencia; oct-dic = kg proyectado × $/kg)
    titulo(ws.getCell(R_HEAD_P - 1, 1), modo === 'suma'
      ? 'Ventas en $ (oct-dic 2026 = suma de los rubros)'
      : 'Ventas en $ (oct-dic 2026 = kg proyectado × $/kg)');
    ws.getRow(R_HEAD_P).values = ['Año', ...MESES, 'Total anual'];
    estiloHeader(ws.getRow(R_HEAD_P), 14);
    anios.forEach((a, i) => {
      const r = rP(a);
      const row = ws.getRow(r);
      const v = a === ANIO ? $Proy : serie('neto', rubro, a);
      row.getCell(1).value = a === ANIO ? `${a} (real + proy.)` : a;
      for (let m = 0; m < 12; m++) {
        row.getCell(m + 2).value =
          a === ANIO && m >= ULTIMO_REAL
            ? {
              formula: {
                estacional: `${col(m + 1)}${R_KG26}*$C$${R_ACUM}`,
                ritmo: `${col(m + 1)}${R_KG26}*SUM($${L_VENT}${r}:$${L_ULT}${r})/SUM($${L_VENT}${R_KG26}:$${L_ULT}${R_KG26})`,
                suma: sumaHojas(`${col(m + 1)}${r}`),
              }[modo],
              result: v[m],
            }
            : v[m];
      }
      row.getCell(14).value = { formula: `SUM(B${r}:M${r})`, result: sum(v) };
      cebra(row, i, 14);
      for (let c = 2; c <= 14; c++) row.getCell(c).numFmt = NUM;
    });

    // Amarillo en lo proyectado y borde azul en el corte real/proyectado.
    for (let m = ULTIMO_REAL; m < 12; m++) {
      ws.getCell(R_KG26, m + 2).fill = fill(AMARILLO);
      ws.getCell(R_P26, m + 2).fill = fill(AMARILLO);
    }
    for (const [desde, hasta] of [[R_HEAD_KG, R_VAR], [R_HEAD_P, R_P26]]) {
      for (let r = desde; r <= hasta; r++) {
        const c = ws.getCell(r, ULTIMO_REAL + 2);
        c.border = { ...c.border, left: { style: 'medium', color: { argb: 'FF1F6FEB' } } };
      }
    }

    // Sección 2 — proyección
    titulo(ws.getCell(R_SEC2, 1), `Sección 2 — Proyección ${ANIO}`);
    const ant = anterior ?? ANIO - 1;
    ws.getRow(R_HEAD2).values = ['Concepto', `Kg ${ANIO}`, `$/kg ${ANIO}`, `$ ${ANIO}`, `Kg ${ant}`, `$ ${ant}`,
      'Δ kg %', 'Δ $', 'Δ $ %', 'Tipo'];
    estiloHeader(ws.getRow(R_HEAD2), 10);

    const kgAnt = anterior ? serie('kilos', rubro, anterior) : Array(12).fill(0);
    const $Ant = anterior ? serie('neto', rubro, anterior) : Array(12).fill(0);
    const ref = (fila, rango) => (anterior ? rango.replace(/#/g, fila) : '0');
    const lineas = [{
      label: `Acumulado real ene-${mesUlt}`, tipo: 'Real',
      kg: [`SUM(B${R_KG26}:${L_ULT}${R_KG26})`, kgAcum],
      pr: [`IF(B${R_ACUM}=0,0,D${R_ACUM}/B${R_ACUM})`, precio],
      $: [`SUM(B${R_P26}:${L_ULT}${R_P26})`, $Acum],
      kgA: [ref(rKg(ant), `SUM(B#:${L_ULT}#)`), sum(kgAnt.slice(0, ULTIMO_REAL))],
      $A: [ref(rP(ant), `SUM(B#:${L_ULT}#)`), sum($Ant.slice(0, ULTIMO_REAL))],
    }];
    for (let m = ULTIMO_REAL; m < 12; m++) {
      const L = col(m + 1);
      lineas.push({
        label: `${MESES[m]} (proyectado)`, tipo: 'Proyectado',
        kg: [`${L}${R_KG26}`, kgProy[m]],
        pr: [`IF(B${R_ACUM + 1 + m - ULTIMO_REAL}=0,0,D${R_ACUM + 1 + m - ULTIMO_REAL}/B${R_ACUM + 1 + m - ULTIMO_REAL})`,
          div($Proy[m], kgProy[m])],
        $: [`${L}${R_P26}`, $Proy[m]],
        kgA: [ref(rKg(ant), `${L}#`), kgAnt[m]],
        $A: [ref(rP(ant), `${L}#`), $Ant[m]],
      });
    }
    lineas.forEach((l, i) => {
      const r = R_ACUM + i;
      const row = ws.getRow(r);
      const f = ([formula, result]) => ({ formula, result });
      row.values = [l.label, f(l.kg), f(l.pr), f(l.$), f(l.kgA), f(l.$A), ...deltas(r, l.kg[1], l.kgA[1], l.$[1], l.$A[1]), l.tipo];
      cebra(row, i, 10);
      if (l.tipo === 'Proyectado') for (const c of [2, 3, 4]) row.getCell(c).fill = fill(AMARILLO);
    });
    const tot = ws.getRow(R_TOT);
    const sumCol = (L, result) => ({ formula: `SUM(${L}${R_ACUM}:${L}${R_TOT - 1})`, result });
    tot.values = [`Total año ${ANIO} (real + proyectado)`,
      sumCol('B', sum(kgProy)), { formula: `IF(B${R_TOT}=0,0,D${R_TOT}/B${R_TOT})`, result: div(sum($Proy), sum(kgProy)) },
      sumCol('D', sum($Proy)), sumCol('E', sum(kgAnt)), sumCol('F', sum($Ant)),
      ...deltas(R_TOT, sum(kgProy), sum(kgAnt), sum($Proy), sum($Ant)), ''];
    tot.font = { bold: true };
    for (let c = 1; c <= 10; c++) tot.getCell(c).border = { top: { style: 'double' } };
    for (let r = R_ACUM; r <= R_TOT; r++) {
      for (const c of [2, 3, 4, 5, 6, 8]) ws.getCell(r, c).numFmt = NUM;
      for (const c of [7, 9]) ws.getCell(r, c).numFmt = PCT;
    }
    ws.getCell(R_NOTA, 1).value =
      'Celdas amarillas = proyectado (fórmula visible en la celda). Borde azul = corte entre real y proyectado.';
    nota(ws.getCell(R_NOTA, 1));

    // Ancho automático (ignora título, notas y rótulos de sección, que desbordan).
    const saltar = new Set([1, 2, R_HEAD_KG - 1, R_HEAD_P - 1, R_SEC2, R_NOTA]);
    ws.columns.forEach((column, i) => {
      let max = 8;
      column.eachCell({ includeEmpty: false }, (cell) => {
        if (saltar.has(Number(cell.row))) return;
        const v = cell.value;
        const n = v !== null && typeof v === 'object' ? v.result : v;
        const txt = typeof n === 'number'
          ? (cell.numFmt === PCT ? '-100.0%' : Math.round(n).toLocaleString('es-AR'))
          : String(n ?? '');
        max = Math.max(max, txt.length + 2);
      });
      column.width = i === 0 ? Math.max(max, 14) : max;
    });
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: R_HEAD_KG }];
  }

  const archivo = process.argv[2] || 'proyeccion_estacionalidad_2026.xlsx';
  await wb.xlsx.writeFile(archivo);
  console.log(`${archivo}: TOTAL + ${rubros.length} rubros; estacionalidad en kg de ${historicos.join(', ')}`);
  await pool.end();
}

// Δ kg %, Δ $, Δ $ % (columnas G, H, I).
function deltas(r, kg, kgA, $, $A) {
  return [
    { formula: `IF(E${r}=0,"",B${r}/E${r}-1)`, result: kgA ? kg / kgA - 1 : '' },
    { formula: `D${r}-F${r}`, result: $ - $A },
    { formula: `IF(F${r}=0,"",D${r}/F${r}-1)`, result: $A ? $ / $A - 1 : '' },
  ];
}

function estiloHeader(row, n) {
  for (let c = 1; c <= n; c++) {
    const cell = row.getCell(c);
    cell.fill = fill(AZUL);
    cell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { horizontal: c === 1 ? 'left' : 'center', vertical: 'middle' };
  }
}

function titulo(cell, texto) {
  cell.value = texto;
  cell.font = { bold: true, size: 12, color: { argb: AZUL } };
}

function nota(cell) {
  cell.font = { italic: true, color: { argb: 'FF555555' } };
}

function cebra(row, i, n) {
  for (let c = 1; c <= n; c++) row.getCell(c).fill = fill(i % 2 ? 'FFFFFFFF' : GRIS);
}

main().catch((e) => { console.error(e); process.exit(1); });
