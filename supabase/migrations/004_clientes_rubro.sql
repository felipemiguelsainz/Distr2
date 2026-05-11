-- ============================================================
-- Distinct buying clients (PDVs) per rubro in a date range.
-- Used to compute: clientes_mes, cartera_activa_3m, vs_prev, vs_aa.
-- p_vendedores NULL → no vendor filter (total empresa).
-- ============================================================
CREATE OR REPLACE FUNCTION clientes_compra_rubro(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS TABLE(rubro text, clientes bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    rubro,
    COUNT(DISTINCT pdv_id)::bigint AS clientes
  FROM ventas
  WHERE fecha BETWEEN p_desde AND p_hasta
    AND (p_vendedores IS NULL OR vendedor = ANY(p_vendedores))
  GROUP BY rubro
  ORDER BY rubro
$$;
