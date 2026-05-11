import { createServiceClient } from '@/lib/supabase/server';

/**
 * Rebuilds resumen_diario for a specific set of dates.
 * Delegates entirely to a SQL function to avoid PostgREST row limits.
 */
export async function recalcularResumenDiario(fechas: string[]): Promise<void> {
  if (fechas.length === 0) return;
  const supabase = createServiceClient();
  await supabase.rpc('recalcular_resumen_diario', { p_fechas: fechas });
}
