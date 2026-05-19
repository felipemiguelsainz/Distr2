-- ============================================================
-- Fix: ccc_por_vendedor — ahora usa resumen_clientes_pdv
-- (misma fuente que clientes_compra_rubro y clientes_activos_total)
-- y acepta p_equipo directamente para no depender de que JS
-- pase la lista de vendedores.
-- ============================================================
DROP FUNCTION IF EXISTS ccc_por_vendedor(date, date, text[]);

CREATE OR REPLACE FUNCTION ccc_por_vendedor(
  p_desde      date,
  p_hasta      date,
  p_equipo     text   DEFAULT NULL,
  p_vendedores text[] DEFAULT NULL
)
RETURNS TABLE(vendedor text, clientes bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    rcp.vendedor,
    COUNT(DISTINCT rcp.pdv_id)::bigint AS clientes
  FROM resumen_clientes_pdv rcp
  WHERE (rcp.anio * 100 + rcp.mes)
          BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
              AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    AND (p_equipo     IS NULL OR rcp.equipo   = p_equipo)
    AND (p_vendedores IS NULL OR rcp.vendedor = ANY(p_vendedores))
  GROUP BY rcp.vendedor
$$;

