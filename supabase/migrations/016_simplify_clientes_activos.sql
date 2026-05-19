-- ============================================================
-- Simplificación: clientes_activos_total ahora también pega
-- contra resumen_clientes_pdv. Mantiene la misma firma.
-- ============================================================

DROP FUNCTION IF EXISTS clientes_activos_total(date, date, text[]);

CREATE OR REPLACE FUNCTION clientes_activos_total(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(DISTINCT pdv_id)::bigint
  FROM resumen_clientes_pdv
  WHERE (anio * 100 + mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    AND (p_vendedores IS NULL OR vendedor = ANY(p_vendedores));
$$;
