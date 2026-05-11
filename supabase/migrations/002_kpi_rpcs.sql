-- ============================================================
-- KPI AGGREGATE RPC FUNCTIONS
-- Solve the Supabase 1000-row default limit by aggregating
-- at the DB level instead of in JavaScript.
-- ============================================================

-- Aggregated KPIs by rubro for a date range
CREATE OR REPLACE FUNCTION kpi_resumen(
  p_desde   date,
  p_hasta   date,
  p_equipo  text DEFAULT NULL,
  p_vendedor text DEFAULT NULL
)
RETURNS TABLE(rubro text, kilos numeric, neto numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    rubro,
    SUM(kilos)::numeric AS kilos,
    SUM(neto)::numeric  AS neto
  FROM resumen_diario
  WHERE fecha >= p_desde
    AND fecha <= p_hasta
    AND (p_equipo   IS NULL OR equipo   = p_equipo)
    AND (p_vendedor IS NULL OR vendedor = p_vendedor)
  GROUP BY rubro
  ORDER BY rubro
$$;

-- Daily kilos for trend charts
CREATE OR REPLACE FUNCTION kpi_tendencia(
  p_desde    date,
  p_hasta    date,
  p_equipo   text DEFAULT NULL,
  p_vendedor text DEFAULT NULL
)
RETURNS TABLE(fecha date, kilos numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    fecha,
    SUM(kilos)::numeric AS kilos
  FROM resumen_diario
  WHERE fecha >= p_desde
    AND fecha <= p_hasta
    AND (p_equipo   IS NULL OR equipo   = p_equipo)
    AND (p_vendedor IS NULL OR vendedor = p_vendedor)
  GROUP BY fecha
  ORDER BY fecha
$$;

-- Per-vendedor aggregated (for supervisor dashboard)
CREATE OR REPLACE FUNCTION kpi_por_vendedor(
  p_desde  date,
  p_hasta  date,
  p_equipo text DEFAULT NULL
)
RETURNS TABLE(vendedor text, rubro text, kilos numeric, neto numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    vendedor,
    rubro,
    SUM(kilos)::numeric AS kilos,
    SUM(neto)::numeric  AS neto
  FROM resumen_diario
  WHERE fecha >= p_desde
    AND fecha <= p_hasta
    AND (p_equipo IS NULL OR equipo = p_equipo)
  GROUP BY vendedor, rubro
  ORDER BY vendedor, rubro
$$;
