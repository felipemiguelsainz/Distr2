-- ============================================================
-- METAS TOTALES RPC — migration 008
-- Replaces JS-side aggregation of resumen_diario that was
-- silently truncated at PostgREST's default 1000-row limit.
-- Called by calcularMetasPreview() in lib/calculations/metas.ts
-- ============================================================

-- Aggregated totals per (rubro) for a date range
CREATE OR REPLACE FUNCTION resumen_totales_por_rubro(
  p_desde date,
  p_hasta date
)
RETURNS TABLE(rubro text, kilos numeric, neto numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    rubro,
    SUM(kilos)::numeric AS kilos,
    SUM(neto)::numeric  AS neto
  FROM resumen_diario
  WHERE fecha >= p_desde AND fecha <= p_hasta
  GROUP BY rubro
  ORDER BY rubro
$$;

-- Aggregated totals per (rubro, vendedor) for a date range
CREATE OR REPLACE FUNCTION resumen_totales_por_vendedor_rubro(
  p_desde date,
  p_hasta date
)
RETURNS TABLE(rubro text, vendedor text, kilos numeric, neto numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    rubro,
    vendedor,
    SUM(kilos)::numeric AS kilos,
    SUM(neto)::numeric  AS neto
  FROM resumen_diario
  WHERE fecha >= p_desde AND fecha <= p_hasta
  GROUP BY rubro, vendedor
  ORDER BY rubro, vendedor
$$;

GRANT EXECUTE ON FUNCTION resumen_totales_por_rubro(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION resumen_totales_por_vendedor_rubro(date, date) TO service_role;
