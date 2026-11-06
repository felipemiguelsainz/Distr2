// Cascadea los objetivos por vendedor de un archivo de concurso sin tocar el total empresa.
//  - metas ($ y kg): cada vendedor del archivo recibe su Facturación (con el mix de rubros de la
//    empresa) y lo que sobra de cada rubro va a Megaunion (VENTA OFICINA F.VA, o --megaunion=NOMBRE).
//    Los vendedores que no están en el archivo no se tocan.
//  - metas_ccc: la meta total del vendedor pasa a ser la CCC del archivo; los rubros se
//    escalan en proporción y las filas quedan como editadas (es_preset=false).
// Hoja "Resumen": A vendedor · B spv · C facturación · D CCC.
//
//   node scripts/cascadear-concurso.cjs "<concurso.xlsx>" 2026 11            # dry-run
//   node scripts/cascadear-concurso.cjs "<concurso.xlsx>" 2026 11 --aplicar        # respalda y escribe las metas $/kg
//   ... --aplicar --ccc    # además pisa metas_ccc (cambia el total empresa de CCC)
const XLSX = require('xlsx');
const { Pool } = require('pg');
const fs = require('fs');
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const [archivo, a, m, flag] = process.argv.slice(2);
const anio = Number(a), mes = Number(m), aplicar = process.argv.includes('--aplicar'), conCcc = process.argv.includes('--ccc');
if (!archivo || !anio || !mes) { console.error('uso: node scripts/cascadear-concurso.cjs <archivo> <anio> <mes> [--aplicar]'); process.exit(1); }
const MEGA = (process.argv.find((x) => x.startsWith('--megaunion=')) ?? '--megaunion=VENTA OFICINA F.VA').split('=')[1];
const suma = (xs) => xs.reduce((s, x) => s + x, 0);

(async () => {
  const filas = XLSX.utils.sheet_to_json(XLSX.readFile(archivo).Sheets.Resumen, { header: 1, defval: '' })
    .slice(2).filter((r) => r[0] && typeof r[2] === 'number');
  const arch = new Map(filas.map((r) => [String(r[0]).trim(), { fact: r[2], ccc: Number(r[3]) }]));
  const totFact = suma([...arch.values()].map((x) => x.fact));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const { rows: metas } = await pool.query('SELECT * FROM metas WHERE anio=$1 AND mes=$2', [anio, mes]);
    const { rows: ccc } = await pool.query('SELECT * FROM metas_ccc WHERE anio=$1 AND mes=$2', [anio, mes]);
    const sinMeta = [...arch.keys()].filter((v) => !metas.some((x) => x.vendedor_nombre === v));
    if (sinMeta.length) throw new Error(`Vendedores del archivo sin meta en ${anio}-${mes}: ${sinMeta.join(', ')}`);

    // --- metas $ / kg: cada vendedor del archivo recibe SU facturación (con el mix de rubros de la
    // empresa); lo que sobra de cada rubro va a Megaunion. Los que no están en el archivo no se tocan.
    const rubros = [...new Set(metas.map((x) => x.rubro))];
    const tr = (rubro, c) => suma(metas.filter((x) => x.rubro === rubro).map((x) => Number(x[c] ?? 0)));
    const totalNeto = suma(rubros.map((r) => tr(r, 'neto_meta')));
    const fuera = metas.filter((x) => !arch.has(x.vendedor_nombre) && x.vendedor_nombre !== MEGA);
    const nuevas = [];
    for (const rubro of rubros) {
      const Rn = tr(rubro, 'neto_meta'), Rk = tr(rubro, 'kilos_meta');
      const vend = [...arch].map(([v, { fact }]) => ({ anio, mes, vendedor_nombre: v, rubro, kilos_meta: fact * Rk / totalNeto, neto_meta: fact * Rn / totalNeto }));
      const otros = fuera.filter((x) => x.rubro === rubro);
      const sobraN = Rn - suma(vend.map((x) => x.neto_meta)) - suma(otros.map((x) => Number(x.neto_meta ?? 0)));
      const sobraK = Rk - suma(vend.map((x) => x.kilos_meta)) - suma(otros.map((x) => Number(x.kilos_meta)));
      if (sobraN < -1 || sobraK < -0.01) throw new Error(`Rubro ${rubro}: lo asignado supera el total (${Math.round(sobraN)} $, ${sobraK.toFixed(2)} kg)`);
      nuevas.push(...vend, { anio, mes, vendedor_nombre: MEGA, rubro, kilos_meta: Math.max(0, sobraK), neto_meta: Math.max(0, sobraN) });
    }
    const todas = [...fuera.map((x) => ({ anio, mes, vendedor_nombre: x.vendedor_nombre, rubro: x.rubro, kilos_meta: x.kilos_meta, neto_meta: x.neto_meta })), ...nuevas];
    const dep = (v) => Math.round(suma(todas.filter((x) => x.vendedor_nombre === v).map((x) => Number(x.neto_meta ?? 0))));
    console.log(`vendedores del archivo ${Math.round(totFact)} · ${MEGA} ${dep(MEGA)} · sin tocar: ${[...new Set(fuera.map((x) => x.vendedor_nombre))].map((v) => `${v} ${dep(v)}`).join(', ')}`);
    console.log('rubro | kg antes → después | $ antes → después');
    for (const rubro of [...new Set(metas.map((x) => x.rubro))].sort()) {
      const t = (rows, c) => Math.round(suma(rows.filter((x) => x.rubro === rubro).map((x) => Number(x[c] ?? 0))));
      console.log(`${rubro} | ${t(metas, 'kilos_meta')} → ${t(todas, 'kilos_meta')} | ${t(metas, 'neto_meta')} → ${t(todas, 'neto_meta')}`);
    }
    const tt = (rows, c) => Math.round(suma(rows.map((x) => Number(x[c] ?? 0))));
    console.log(`TOTAL kg ${tt(metas, 'kilos_meta')} → ${tt(todas, 'kilos_meta')} · $ ${tt(metas, 'neto_meta')} → ${tt(todas, 'neto_meta')} · filas ${metas.length} → ${todas.length}`);

    // --- metas CCC
    const cambios = [];
    for (const [v, { ccc: nuevoTotal }] of arch) {
      const total = ccc.find((x) => x.vendedor === v && x.rubro == null);
      if (!total) { console.log(`  ⚠ ${v}: sin fila total en metas_ccc, se omite`); continue; }
      const viejo = Number(total.meta_pdvs);
      for (const x of ccc.filter((y) => y.vendedor === v)) {
        const n = x.rubro == null ? nuevoTotal : Math.min(nuevoTotal, Math.round(Number(x.meta_pdvs) * nuevoTotal / (viejo || 1)));
        cambios.push({ id: x.id, vendedor: v, rubro: x.rubro, de: Number(x.meta_pdvs), a: n });
      }
    }
    const tot = (f) => suma(cambios.filter((c) => c.rubro == null).map(f));
    const totalEmpresa = suma(ccc.filter((x) => x.rubro == null).map((x) => Number(x.meta_pdvs)));
    console.log(`CCC vendedores del archivo ${tot((c) => c.de)} → ${tot((c) => c.a)} · total empresa ${totalEmpresa} → ${totalEmpresa - tot((c) => c.de) + tot((c) => c.a)}`);
    if (!aplicar) { console.log('dry-run: no se escribió nada'); return; }

    fs.mkdirSync('respaldos', { recursive: true });
    const f1 = `respaldos/metas_${anio}-${mes}_antes_del_concurso.json`, f2 = `respaldos/metas_ccc_${anio}-${mes}_antes_del_concurso.json`;
    fs.writeFileSync(f1, JSON.stringify(metas)); fs.writeFileSync(f2, JSON.stringify(ccc));
    console.log(`respaldos: ${f1} · ${f2}`);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM metas WHERE anio=$1 AND mes=$2', [anio, mes]);
      for (let i = 0; i < todas.length; i += 500) {
        const lote = todas.slice(i, i + 500), params = [];
        const vals = lote.map((r) => `(${['anio', 'mes', 'vendedor_nombre', 'rubro', 'kilos_meta', 'neto_meta'].map((k) => { params.push(r[k]); return `$${params.length}`; }).join(',')})`);
        await c.query(`INSERT INTO metas (anio, mes, vendedor_nombre, rubro, kilos_meta, neto_meta) VALUES ${vals.join(',')}`, params);
      }
      if (conCcc) for (const x of cambios) await c.query('UPDATE metas_ccc SET meta_pdvs=$1, es_preset=false, updated_at=NOW() WHERE id=$2', [x.a, x.id]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    console.log(`metas: ${todas.length} filas · metas_ccc: ${conCcc ? cambios.length + ' filas actualizadas' : 'sin tocar (falta --ccc)'}`);
  } finally { await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
