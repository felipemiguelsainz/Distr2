import { createServiceClient } from '@/lib/supabase/server';

/**
 * Rebuilds resumen_diario for a specific set of dates AND refreshes the
 * monthly per-PDV cache for the (anio, mes) periods covered by those dates.
 *
 * Cada RPC tiene que chequear su `error`: el cliente de Supabase NO tira
 * excepción cuando una RPC falla, devuelve `{ data, error }`. Antes esto hacía
 * `await supabase.rpc(...)` a secas, así que un fallo —un timeout recalculando
 * un mes grande, por ejemplo— se descartaba en silencio: la función resolvía
 * bien, el `catch` del route de upload nunca corría, y la carga se informaba
 * como exitosa con las tablas de resumen quedadas atrás.
 *
 * Se detectó con agosto 2026: el resumen tenía 7.676 grupos donde ventas ya
 * tenía 9.074, y 26.333 kilos contra 34.007 reales. El dashboard mostraba 23%
 * menos kilos de los que había, sin ningún aviso.
 */
async function rpc(
  supabase: ReturnType<typeof createServiceClient>,
  nombre: string,
  args: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.rpc(nombre, args);
  if (error) {
    throw new Error(`${nombre} falló: ${error.message}`);
  }
}

export async function recalcularResumenDiario(fechas: string[]): Promise<void> {
  if (fechas.length === 0) return;
  const supabase = createServiceClient();

  await rpc(supabase, 'recalcular_resumen_diario', { p_fechas: fechas });

  const periodos = Array.from(
    new Set(fechas.map((f) => f.slice(0, 7))), // 'YYYY-MM'
  );
  if (periodos.length > 0) {
    await rpc(supabase, 'recalcular_resumen_clientes_pdv', { p_periodos: periodos });
  }

  // Refrescar el catálogo de productos (puede traer artículos nuevos)
  await rpc(supabase, 'recalcular_catalogo_productos', {});
}
