const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://ughzmwnguuzyddcbklhb.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function run() {
  // Test kpi_resumen for April 2026
  const { data, error } = await supabase.rpc('kpi_resumen', {
    p_desde: '2026-04-01',
    p_hasta: '2026-04-30',
  });
  if (error) { console.error('ERROR kpi_resumen:', error.message); return; }

  console.log('=== kpi_resumen abril 2026 ===');
  let totalKg = 0, totalNeto = 0;
  for (const r of data) {
    console.log(`  ${r.rubro}: ${Number(r.kilos).toLocaleString('es-AR')} kg | $${Number(r.neto).toLocaleString('es-AR')}`);
    totalKg += Number(r.kilos);
    totalNeto += Number(r.neto);
  }
  console.log(`  TOTAL: ${totalKg.toLocaleString('es-AR')} kg | $${totalNeto.toLocaleString('es-AR')}`);

  // Test kpi_tendencia
  const { data: trend, error: e2 } = await supabase.rpc('kpi_tendencia', {
    p_desde: '2026-04-01',
    p_hasta: '2026-04-30',
  });
  if (e2) { console.error('ERROR kpi_tendencia:', e2.message); return; }
  console.log(`\nkpi_tendencia: ${trend.length} días con data`);
  console.log('Primeros 3:', trend.slice(0, 3).map(r => `${r.fecha}: ${Number(r.kilos).toLocaleString('es-AR')} kg`).join(' | '));

  // Test kpi_por_vendedor (equipo Valeria)
  const { data: vd, error: e3 } = await supabase.rpc('kpi_por_vendedor', {
    p_desde: '2026-04-01',
    p_hasta: '2026-04-30',
    p_equipo: 'VALERIA SVENCEN',
  });
  if (e3) { console.error('ERROR kpi_por_vendedor:', e3.message); return; }
  const vendedores = [...new Set(vd.map(r => r.vendedor))];
  console.log(`\nkpi_por_vendedor (Valeria): ${vendedores.length} vendedores, ${vd.length} filas`);
  console.log('Vendedores:', vendedores.slice(0, 5).join(', '));
}

run().catch(e => { console.error(e.message); process.exit(1); });
