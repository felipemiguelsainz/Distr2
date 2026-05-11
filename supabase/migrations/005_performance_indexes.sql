-- ============================================================
-- PERFORMANCE INDEXES — migration 005
-- Add missing indexes to dramatically speed up dashboard queries.
-- ============================================================

-- metas: full-scan on every KPI page load (no index existed)
CREATE INDEX IF NOT EXISTS idx_metas_periodo_vendedor
  ON metas(anio, mes, vendedor_nombre);

-- vendedores: equipo lookup (called once per equipo-filtered page)
CREATE INDEX IF NOT EXISTS idx_vendedores_equipo_activo
  ON vendedores(equipo) WHERE activo = true;

-- ventas: covering index for clientes_compra_rubro RPC
-- (COUNT DISTINCT pdv_id grouped by rubro, filtered by fecha + vendedor)
CREATE INDEX IF NOT EXISTS idx_ventas_vendedor_fecha_rubro
  ON ventas(vendedor, fecha, rubro, pdv_id);

-- ventas: cobertura SKU queries (sku + vendedor + periodo)
CREATE INDEX IF NOT EXISTS idx_ventas_sku_vendedor_periodo
  ON ventas(sku, vendedor, mes, anio);

-- pdvs: cartera count for cobertura (only active PDVs)
CREATE INDEX IF NOT EXISTS idx_pdvs_cartera_activo
  ON pdvs(cartera) WHERE activo = true;
