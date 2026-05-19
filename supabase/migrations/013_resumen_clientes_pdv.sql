-- ============================================================
-- Pre-agregación por (anio, mes, pdv_id, rubro)
-- Acelera: home_drop_mensual, home_surtido_mensual, home_ccc_mensual,
--          home_cartera_activa_mensual, clientes_compra_rubro
-- ============================================================

CREATE TABLE IF NOT EXISTS resumen_clientes_pdv (
  anio     INT     NOT NULL,
  mes      INT     NOT NULL,
  pdv_id   INT     NOT NULL,
  vendedor TEXT    NOT NULL,
  rubro    TEXT    NOT NULL,
  equipo   TEXT,
  kilos    NUMERIC NOT NULL DEFAULT 0,
  neto     NUMERIC NOT NULL DEFAULT 0,
  skus     INT     NOT NULL DEFAULT 0,
  PRIMARY KEY (anio, mes, pdv_id, vendedor, rubro)
);

CREATE INDEX IF NOT EXISTS idx_rcp_periodo_equipo    ON resumen_clientes_pdv(anio, mes, equipo);
CREATE INDEX IF NOT EXISTS idx_rcp_periodo_vendedor  ON resumen_clientes_pdv(anio, mes, vendedor);
CREATE INDEX IF NOT EXISTS idx_rcp_periodo_rubro     ON resumen_clientes_pdv(anio, mes, rubro);

ALTER TABLE resumen_clientes_pdv ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rcp_read_all ON resumen_clientes_pdv;
CREATE POLICY rcp_read_all ON resumen_clientes_pdv
  FOR SELECT USING (get_user_rol() IN ('admin', 'supervisor', 'vendedor'));

-- Repopulate function: takes a list of (anio, mes) pairs encoded as TEXT 'YYYY-MM'
CREATE OR REPLACE FUNCTION recalcular_resumen_clientes_pdv(p_periodos TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  p TEXT;
  py INT;
  pm INT;
BEGIN
  IF p_periodos IS NULL OR array_length(p_periodos, 1) IS NULL THEN RETURN; END IF;

  FOREACH p IN ARRAY p_periodos LOOP
    py := SPLIT_PART(p, '-', 1)::INT;
    pm := SPLIT_PART(p, '-', 2)::INT;

    DELETE FROM resumen_clientes_pdv WHERE anio = py AND mes = pm;

    INSERT INTO resumen_clientes_pdv (anio, mes, pdv_id, vendedor, rubro, equipo, kilos, neto, skus)
    SELECT
      EXTRACT(YEAR  FROM v.fecha)::INT,
      EXTRACT(MONTH FROM v.fecha)::INT,
      v.pdv_id,
      v.vendedor,
      v.rubro,
      MAX(vd.equipo),
      SUM(v.kilos)::NUMERIC,
      SUM(v.neto)::NUMERIC,
      COUNT(DISTINCT v.sku)::INT
    FROM ventas v
    LEFT JOIN vendedores vd ON vd.nombre = v.vendedor
    WHERE EXTRACT(YEAR FROM v.fecha) = py
      AND EXTRACT(MONTH FROM v.fecha) = pm
      AND v.pdv_id   IS NOT NULL
      AND v.rubro    IS NOT NULL
      AND v.vendedor IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5;
  END LOOP;
END;
$$;

-- (backfill se ejecuta aparte desde scripts/backfill-resumen-clientes-pdv.cjs)

-- ============================================================
-- Rewrite slow RPCs to use the materialized table
-- ============================================================

DROP FUNCTION IF EXISTS home_drop_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_surtido_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_ccc_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_cartera_activa_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS clientes_compra_rubro(DATE, DATE, TEXT[]);

-- CCC mensual (distinct pdv_id por mes) — usa la tabla pre-agregada
CREATE OR REPLACE FUNCTION home_ccc_mensual(p_desde DATE, p_hasta DATE)
RETURNS TABLE (anio INT, mes INT, ccc INT)
LANGUAGE sql STABLE AS $$
  SELECT anio, mes, COUNT(DISTINCT pdv_id)::INT
  FROM resumen_clientes_pdv
  WHERE (anio * 100 + mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
  GROUP BY anio, mes
  ORDER BY anio, mes;
$$;

-- Drop promedio (KG / PDV únicos) por mes
CREATE OR REPLACE FUNCTION home_drop_mensual(p_desde DATE, p_hasta DATE)
RETURNS TABLE (anio INT, mes INT, drop_promedio NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH agg AS (
    SELECT anio, mes, pdv_id, SUM(kilos) AS kilos_pdv
    FROM resumen_clientes_pdv
    WHERE (anio * 100 + mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                  AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    GROUP BY anio, mes, pdv_id
  )
  SELECT anio, mes, (SUM(kilos_pdv) / NULLIF(COUNT(*), 0))::NUMERIC
  FROM agg
  GROUP BY anio, mes
  ORDER BY anio, mes;
$$;

-- Surtido promedio (SKUs distintos por PDV) por mes
CREATE OR REPLACE FUNCTION home_surtido_mensual(p_desde DATE, p_hasta DATE)
RETURNS TABLE (anio INT, mes INT, surtido_promedio NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH per_pdv AS (
    SELECT anio, mes, pdv_id, SUM(skus) AS skus_total
    FROM resumen_clientes_pdv
    WHERE (anio * 100 + mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                  AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    GROUP BY anio, mes, pdv_id
  )
  SELECT anio, mes, AVG(skus_total)::NUMERIC
  FROM per_pdv
  GROUP BY anio, mes
  ORDER BY anio, mes;
$$;

-- Cartera Activa rolling 3 meses (pdv_id activo en M-2, M-1, M)
CREATE OR REPLACE FUNCTION home_cartera_activa_mensual(p_desde DATE, p_hasta DATE)
RETURNS TABLE (anio INT, mes INT, cartera_activa INT)
LANGUAGE sql STABLE AS $$
  WITH meses AS (
    SELECT generate_series(date_trunc('month', p_desde), date_trunc('month', p_hasta), '1 month')::date AS m
  )
  SELECT
    EXTRACT(YEAR  FROM meses.m)::INT,
    EXTRACT(MONTH FROM meses.m)::INT,
    COUNT(DISTINCT rcp.pdv_id)::INT
  FROM meses
  LEFT JOIN resumen_clientes_pdv rcp
    ON (rcp.anio * 100 + rcp.mes) BETWEEN ((EXTRACT(YEAR FROM (meses.m - INTERVAL '2 months'))::INT) * 100
                                          + EXTRACT(MONTH FROM (meses.m - INTERVAL '2 months'))::INT)
                                       AND (EXTRACT(YEAR FROM meses.m)::INT * 100 + EXTRACT(MONTH FROM meses.m)::INT)
  GROUP BY meses.m
  ORDER BY meses.m;
$$;

-- clientes_compra_rubro: ahora desde la tabla materializada
CREATE OR REPLACE FUNCTION clientes_compra_rubro(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS TABLE(rubro text, clientes bigint)
LANGUAGE sql STABLE AS $$
  SELECT rubro, COUNT(DISTINCT pdv_id)::BIGINT
  FROM resumen_clientes_pdv
  WHERE (anio * 100 + mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    AND (p_vendedores IS NULL OR vendedor = ANY(p_vendedores))
  GROUP BY rubro
  ORDER BY rubro;
$$;
