import { createServiceClient } from '@/lib/supabase/server';

/**
 * Rebuilds resumen_diario for a specific set of dates AND refreshes the
 * monthly per-PDV cache for the (anio, mes) periods covered by those dates.
 */
export async function recalcularResumenDiario(fechas: string[]): Promise<void> {
  if (fechas.length === 0) return;
  const supabase = createServiceClient();
  await supabase.rpc('recalcular_resumen_diario', { p_fechas: fechas });

  const periodos = Array.from(
    new Set(fechas.map((f) => f.slice(0, 7))), // 'YYYY-MM'
  );
  if (periodos.length > 0) {
    await supabase.rpc('recalcular_resumen_clientes_pdv', { p_periodos: periodos });
  }

  // Refrescar el catálogo de productos (puede traer artículos nuevos)
  await supabase.rpc('recalcular_catalogo_productos');
}
