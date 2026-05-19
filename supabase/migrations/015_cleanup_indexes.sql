-- ============================================================
-- Cleanup: borrar índices sin uso para liberar espacio en DB.
-- Datos verificados con pg_stat_user_indexes (idx_scan = 0).
-- ============================================================

-- 15 MB, 0 scans — el campo `cartera` se denormaliza desde pdvs
DROP INDEX IF EXISTS idx_ventas_cartera_fecha;

-- 10 MB, 7 scans (uso despreciable) — los queries por rubro
-- ahora pegan contra resumen_diario o resumen_clientes_pdv
DROP INDEX IF EXISTS idx_ventas_rubro_mes_anio;

-- de migration 005, fue para clientes_compra_rubro que ahora
-- usa resumen_clientes_pdv. No se referencia en ningún query nuevo.
DROP INDEX IF EXISTS idx_ventas_vendedor_fecha_rubro;
