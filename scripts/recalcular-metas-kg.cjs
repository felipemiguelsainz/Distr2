// Recalcula las metas de KG de un mes con los kilos de HOY, conservando los
// objetivos Mondelez en $ ya guardados. Mismas fórmulas que calcularMetasPreview
// (lib/calculations/metas.ts): hay que mantenerlas en sincronía.
//
// Se usa cuando cambian los kilos históricos (p. ej. la corrección de gramaje,
// mig. 051): el kg meta Mondelez = objetivo $ ÷ ($/kg del mes anterior), y ese
// $/kg sale de los kilos. Los objetivos $ no se guardan, pero se recuperan:
// sum(neto_meta) de un rubro Mondelez == objetivo_neto (docs/CONTEXTO-IA.md §13).
// Los vendedores excluidos son los que NO tienen meta guardada en ese mes.
//
//   node scripts/recalcular-metas-kg.cjs 2026 10            # dry-run
//   node scripts/recalcular-metas-kg.cjs 2026 10 --aplicar  # respalda, borra el mes e inserta
//   node scripts/recalcular-metas-kg.cjs 2026 11 --objetivos-de=2026-10   # mes sin metas: toma objetivos $ y excluidos de otro mes
const { Pool } = require('pg');
const fs = require('fs');
for (const l of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const anio = Number(process.argv[2]), mes = Number(process.argv[3]);
const aplicar = process.argv.includes('--aplicar');
const baseArg = (process.argv.find((a) => a.startsWith('--objetivos-de=')) ?? '').split('=')[1]; // AAAA-MM
if (!anio || !mes) { console.error('uso: node scripts/recalcular-metas-kg.cjs <anio> <mes> [--aplicar]'); process.exit(1); }

const MONDELEZ = ['Beverages', 'Biscuits', 'Candies', 'Chocolates', 'Dry Mixes', 'Gums'];
const pad = (n) => String(n).padStart(2, '0');
const rango = (a, m) => [`${a}-${pad(m)}-01`, `${a}-${pad(m)}-${pad(new Date(a, m, 0).getDate())}`];
const prev = (a, m) => (m === 1 ? { a: a - 1, m: 12 } : { a, m: m - 1 });

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const porRubro = async (a, m) => {
      const [d, h] = rango(a, m);
      const { rows } = await pool.query('SELECT * FROM resumen_totales_por_rubro($1,$2)', [d, h]);
      return new Map(rows.map((r) => [r.rubro, { kilos: Number(r.kilos), neto: Number(r.neto) }]));
    };
    const ant = prev(anio, mes), aaTar = { a: anio - 1, m: mes }, aaAnt = prev(anio - 1, mes);
    const d0 = new Date(anio, mes - 1, 1); d0.setMonth(d0.getMonth() - 4);
    const [pd] = rango(d0.getFullYear(), d0.getMonth() + 1), [, ph] = rango(ant.a, ant.m);

    const [totAnt, totAATar, totAAAnt] = await Promise.all([porRubro(ant.a, ant.m), porRubro(aaTar.a, aaTar.m), porRubro(aaAnt.a, aaAnt.m)]);
    const { rows: pv } = await pool.query('SELECT * FROM resumen_totales_por_vendedor_rubro($1,$2)', [pd, ph]);
    const hist = new Map(); // rubro -> Map(vendedor -> kilos)
    for (const r of pv) {
      const m = hist.get(r.rubro) ?? new Map();
      m.set(r.vendedor, (m.get(r.vendedor) ?? 0) + Number(r.kilos));
      hist.set(r.rubro, m);
    }

    const { rows: viejas } = await pool.query('SELECT * FROM metas WHERE anio=$1 AND mes=$2', [anio, mes]);
    const [ba, bm] = baseArg ? baseArg.split('-').map(Number) : [anio, mes];
    const { rows: fuente } = baseArg ? await pool.query('SELECT * FROM metas WHERE anio=$1 AND mes=$2', [ba, bm]) : { rows: viejas };
    if (!fuente.length) throw new Error(`No hay metas guardadas para ${ba}-${pad(bm)}: no puedo recuperar los objetivos (usá --objetivos-de=AAAA-MM).`);
    const conMeta = new Set(fuente.map((v) => v.vendedor_nombre));
    const todosHist = new Set(pv.map((r) => r.vendedor));
    const excluidos = new Set([...todosHist].filter((v) => !conMeta.has(v)));
    console.log(`excluidos (sin meta guardada): ${[...excluidos].join(', ') || 'ninguno'}`);

    const objetivo = (rubro) => fuente.filter((v) => v.rubro === rubro).reduce((s, v) => s + Number(v.neto_meta ?? 0), 0);
    const dpk = (rubro) => { const t = totAnt.get(rubro); return t && t.kilos > 0 ? t.neto / t.kilos : 0; };

    const rubros = new Set([...MONDELEZ, ...totAnt.keys(), ...hist.keys()]);
    const nuevas = [];
    for (const rubro of rubros) {
      let kgTotal, netoTotal = null;
      if (MONDELEZ.includes(rubro)) {
        const obj = objetivo(rubro), d = dpk(rubro);
        kgTotal = d > 0 ? obj / d : 0; netoTotal = obj;
      } else {
        const ant_ = totAnt.get(rubro)?.kilos ?? 0, a = totAATar.get(rubro)?.kilos ?? 0, b = totAAAnt.get(rubro)?.kilos ?? 0;
        kgTotal = ant_ * (b > 0 ? a / b : 1);
        const d = dpk(rubro); netoTotal = d > 0 ? kgTotal * d : null;
      }
      const byV = [...(hist.get(rubro) ?? new Map())].filter(([v]) => !excluidos.has(v));
      const total = byV.reduce((s, [, k]) => s + k, 0);
      if (total <= 0) continue;
      for (const [v, k] of byV) {
        if (k <= 0) continue;
        const peso = k / total;
        nuevas.push({ anio, mes, vendedor_nombre: v, rubro, kilos_meta: kgTotal * peso, neto_meta: netoTotal == null ? null : netoTotal * peso });
      }
    }

    const suma = (rows, c, r) => Math.round(rows.filter((x) => x.rubro === r).reduce((s, x) => s + Number(x[c] ?? 0), 0));
    console.log('rubro | kg guardado → kg nuevo | $ guardado → $ nuevo');
    for (const r of [...rubros].sort())
      console.log(`${r} | ${suma(viejas, 'kilos_meta', r)} → ${suma(nuevas, 'kilos_meta', r)} | ${suma(viejas, 'neto_meta', r)} → ${suma(nuevas, 'neto_meta', r)}`);
    console.log(`TOTAL kg ${suma(viejas.map((x) => ({ ...x, rubro: 'x' })), 'kilos_meta', 'x')} → ${suma(nuevas.map((x) => ({ ...x, rubro: 'x' })), 'kilos_meta', 'x')} · filas ${viejas.length} → ${nuevas.length}`);
    if (!aplicar) { console.log('dry-run: no se escribió nada'); return; }

    fs.mkdirSync('respaldos', { recursive: true });
    const file = `respaldos/metas_${anio}-${pad(mes)}_antes_de_recalcular.json`;
    fs.writeFileSync(file, JSON.stringify(viejas));
    console.log(`respaldo: ${file}`);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM metas WHERE anio=$1 AND mes=$2', [anio, mes]);
      for (let i = 0; i < nuevas.length; i += 500) {
        const lote = nuevas.slice(i, i + 500), params = [];
        const vals = lote.map((r) => `(${['anio', 'mes', 'vendedor_nombre', 'rubro', 'kilos_meta', 'neto_meta'].map((k) => { params.push(r[k]); return `$${params.length}`; }).join(',')})`);
        await c.query(`INSERT INTO metas (anio, mes, vendedor_nombre, rubro, kilos_meta, neto_meta) VALUES ${vals.join(',')}`, params);
      }
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    console.log(`metas guardadas: ${nuevas.length} filas`);
  } finally { await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
