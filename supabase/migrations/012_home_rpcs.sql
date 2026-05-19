-- ============================================================
-- HOME PAGE — Aggregate RPC functions
-- ============================================================

-- Index para acelerar CCC mensual y cartera rolling
CREATE INDEX IF NOT EXISTS idx_ventas_fecha_pdv
  ON ventas(fecha, pdv_id);

-- Drop existing functions whose signature is changing
DROP FUNCTION IF EXISTS home_resumen_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_ccc_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_drop_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_surtido_mensual(DATE, DATE);

-- 1) Mensual: neto + kilos (desde resumen_diario)
CREATE OR REPLACE FUNCTION home_resumen_mensual(p_desde DATE, p_hasta DATE)
RETURNS TABLE (anio INT, mes INT, neto NUMERIC, kilos NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT
    EXTRACT(YEAR  FROM fecha)::INT,
    EXTRACT(MONTH FROM fecha)::INT,
    SUM(neto)::NUMERIC,
    SUM(kilos)::NUMERIC
  FROM resumen_diario
  WHERE fecha BETWEEN p_desde AND p_hasta
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

-- 2) CCC mensual con generate_series para usar el índice
CREATE OR REPLACE FUNCTION home_ccc_mensual(p_desde DATE, p_hasta DATE)
RETURNS TABLE (anio INT, mes INT, ccc INT)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  WITH meses AS (
    SELECT generate_series(date_trunc('month', p_desde), date_trunc('month', p_hasta), '1 month')::date AS m
  )
  SELECT
    EXTRACT(YEAR  FROM meses.m)::INT,
    EXTRACT(MONTH FROM meses.m)::INT,
    COUNT(DISTINCT v.pdv_id)::INT
  FROM meses
  LEFT JOIN ventas v
    ON v.fecha >= meses.m
   AND v.fecha <  (meses.m + INTERVAL '1 month')
  GROUP BY meses.m
  ORDER BY meses.m;
$$;

-- 3) Drop Promedio (KG/PDV) por mes
CREATE OR REPLACE FUNCTION home_drop_mensual(p_desde DATE, p_hasta DATE)
RETURNS TABLE (anio INT, mes INT, drop_promedio NUMERIC)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  WITH meses AS (
    SELECT generate_series(date_trunc('month', p_desde), date_trunc('month', p_hasta), '1 month')::date AS m
  )
  SELECT
    EXTRACT(YEAR  FROM meses.m)::INT,
    EXTRACT(MONTH FROM meses.m)::INT,
    (SUM(v.kilos) / NULLIF(COUNT(DISTINCT v.pdv_id), 0))::NUMERIC
  FROM meses
  LEFT JOIN ventas v
    ON v.fecha >= meses.m
   AND v.fecha <  (meses.m + INTERVAL '1 month')
  GROUP BY meses.m
  ORDER BY meses.m;
$$;

-- 4) Surtido mensual = AVG por PDV de COUNT(DISTINCT sku)
CREATE OR REPLACE FUNCTION home_surtido_mensual(p_desde DATE, p_hasta DATE)
RETURNS TABLE (anio INT, mes INT, surtido_promedio NUMERIC)
LANGUAGE sql STABLE
SET statement_timeout = '120s'
AS $$
  WITH meses AS (
    SELECT generate_series(date_trunc('month', p_desde), date_trunc('month', p_hasta), '1 month')::date AS m
  ),
  per_pdv AS (
    SELECT
      meses.m AS mes_inicio,
      v.pdv_id,
      COUNT(DISTINCT v.sku) AS skus
    FROM meses
    JOIN ventas v
      ON v.fecha >= meses.m
     AND v.fecha <  (meses.m + INTERVAL '1 month')
    GROUP BY meses.m, v.pdv_id
  )
  SELECT
    EXTRACT(YEAR  FROM mes_inicio)::INT,
    EXTRACT(MONTH FROM mes_inicio)::INT,
    AVG(skus)::NUMERIC
  FROM per_pdv
  GROUP BY mes_inicio
  ORDER BY mes_inicio;
$$;

-- 5) Cartera Activa rolling 3 meses
CREATE OR REPLACE FUNCTION home_cartera_activa_mensual(p_desde DATE, p_hasta DATE)
RETURNS TABLE (anio INT, mes INT, cartera_activa INT)
LANGUAGE sql STABLE
SET statement_timeout = '60s'
AS $$
  WITH meses AS (
    SELECT generate_series(date_trunc('month', p_desde), date_trunc('month', p_hasta), '1 month')::date AS m
  )
  SELECT
    EXTRACT(YEAR  FROM meses.m)::INT,
    EXTRACT(MONTH FROM meses.m)::INT,
    COUNT(DISTINCT v.pdv_id)::INT
  FROM meses
  LEFT JOIN ventas v
    ON v.fecha >= (meses.m - INTERVAL '2 months')
   AND v.fecha <  (meses.m + INTERVAL '1 month')
  GROUP BY meses.m
  ORDER BY meses.m;
$$;

-- 6) Top productos por kilos en rango
CREATE OR REPLACE FUNCTION home_top_productos(p_desde DATE, p_hasta DATE, p_limit INT DEFAULT 10)
RETURNS TABLE (articulo TEXT, kilos NUMERIC, pct NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH total AS (
    SELECT SUM(kilos) AS tot FROM ventas WHERE fecha BETWEEN p_desde AND p_hasta
  )
  SELECT
    COALESCE(articulo, '(sin nombre)')::TEXT,
    SUM(kilos)::NUMERIC,
    (SUM(kilos) / NULLIF((SELECT tot FROM total), 0))::NUMERIC
  FROM ventas
  WHERE fecha BETWEEN p_desde AND p_hasta
  GROUP BY articulo
  ORDER BY 2 DESC
  LIMIT p_limit;
$$;

-- 7) Top rubros por kilos
CREATE OR REPLACE FUNCTION home_top_rubros(p_desde DATE, p_hasta DATE)
RETURNS TABLE (rubro TEXT, kilos NUMERIC, pct NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH total AS (
    SELECT SUM(kilos) AS tot FROM resumen_diario WHERE fecha BETWEEN p_desde AND p_hasta
  )
  SELECT
    COALESCE(rubro, '(sin rubro)')::TEXT,
    SUM(kilos)::NUMERIC,
    (SUM(kilos) / NULLIF((SELECT tot FROM total), 0))::NUMERIC
  FROM resumen_diario
  WHERE fecha BETWEEN p_desde AND p_hasta
  GROUP BY rubro
  ORDER BY 2 DESC;
$$;

-- 8) Top clientes por kilos
CREATE OR REPLACE FUNCTION home_top_clientes(p_desde DATE, p_hasta DATE, p_limit INT DEFAULT 10)
RETURNS TABLE (razon_social TEXT, kilos NUMERIC, pct NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH total AS (
    SELECT SUM(kilos) AS tot FROM ventas WHERE fecha BETWEEN p_desde AND p_hasta
  )
  SELECT
    COALESCE(p.razon_social, '(sin nombre)')::TEXT,
    SUM(v.kilos)::NUMERIC,
    (SUM(v.kilos) / NULLIF((SELECT tot FROM total), 0))::NUMERIC
  FROM ventas v
  LEFT JOIN pdvs p ON p.id = v.pdv_id
  WHERE v.fecha BETWEEN p_desde AND p_hasta
  GROUP BY p.razon_social
  ORDER BY 2 DESC
  LIMIT p_limit;
$$;

-- 9) Mix por canal (kilos)
CREATE OR REPLACE FUNCTION home_mix_canal(p_desde DATE, p_hasta DATE)
RETURNS TABLE (canal TEXT, kilos NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(p.canal_venta, '(sin canal)')::TEXT,
    SUM(v.kilos)::NUMERIC
  FROM ventas v
  LEFT JOIN pdvs p ON p.id = v.pdv_id
  WHERE v.fecha BETWEEN p_desde AND p_hasta
  GROUP BY p.canal_venta
  ORDER BY 2 DESC;
$$;

-- 10) Facturación mensual por localidad — top N
CREATE OR REPLACE FUNCTION home_facturacion_localidad_mensual(
  p_desde DATE,
  p_hasta DATE,
  p_top   INT DEFAULT 5
)
RETURNS TABLE (localidad TEXT, anio INT, mes INT, neto NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH top_locs AS (
    SELECT p.localidad
    FROM ventas v JOIN pdvs p ON p.id = v.pdv_id
    WHERE v.fecha BETWEEN p_desde AND p_hasta AND p.localidad IS NOT NULL
    GROUP BY p.localidad
    ORDER BY SUM(v.neto) DESC
    LIMIT p_top
  )
  SELECT
    p.localidad::TEXT,
    EXTRACT(YEAR  FROM v.fecha)::INT,
    EXTRACT(MONTH FROM v.fecha)::INT,
    SUM(v.neto)::NUMERIC
  FROM ventas v
  JOIN pdvs p ON p.id = v.pdv_id
  WHERE v.fecha BETWEEN p_desde AND p_hasta
    AND p.localidad IN (SELECT localidad FROM top_locs)
  GROUP BY p.localidad, EXTRACT(YEAR FROM v.fecha), EXTRACT(MONTH FROM v.fecha)
  ORDER BY p.localidad, 2, 3;
$$;

-- 11) Facturación mensual por equipo/supervisor
CREATE OR REPLACE FUNCTION home_facturacion_supervisor_mensual(p_desde DATE, p_hasta DATE)
RETURNS TABLE (equipo TEXT, anio INT, mes INT, neto NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT
    equipo::TEXT,
    EXTRACT(YEAR  FROM fecha)::INT,
    EXTRACT(MONTH FROM fecha)::INT,
    SUM(neto)::NUMERIC
  FROM resumen_diario
  WHERE fecha BETWEEN p_desde AND p_hasta
    AND equipo IS NOT NULL
    AND equipo <> 'SIN SUPERVISOR'
  GROUP BY equipo, EXTRACT(YEAR FROM fecha), EXTRACT(MONTH FROM fecha)
  ORDER BY equipo, 2, 3;
$$;
