-- COUNT(DISTINCT pdv_id) across all rubros — used for the TOTAL row's Cartera 3M.
-- Without GROUP BY rubro, avoids double-counting clients who bought multiple categories.
CREATE OR REPLACE FUNCTION clientes_activos_total(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(DISTINCT pdv_id)::bigint
  FROM ventas
  WHERE fecha BETWEEN p_desde AND p_hasta
    AND (p_vendedores IS NULL OR vendedor = ANY(p_vendedores))
$$;
