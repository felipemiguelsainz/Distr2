-- ============================================================
-- CCC (Clientes con Compra) agrupado por vendedor en rango de fechas.
-- Reemplaza la query directa con filtro mes/anio que tenía límite de filas.
-- ============================================================
CREATE OR REPLACE FUNCTION ccc_por_vendedor(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[]
)
RETURNS TABLE(vendedor text, clientes bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    vendedor,
    COUNT(DISTINCT pdv_id)::bigint AS clientes
  FROM ventas
  WHERE fecha BETWEEN p_desde AND p_hasta
    AND vendedor = ANY(p_vendedores)
  GROUP BY vendedor
$$;
