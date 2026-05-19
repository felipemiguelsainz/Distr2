-- ============================================================
-- Optimización: todos los RPCs del home/clientes_compra_rubro
-- pasan a usar resumen_clientes_pdv (174K rows) en lugar de
-- ventas (950K rows). Más simple, más rápido, menos índices.
-- ============================================================

-- Drop signatures changing
DROP FUNCTION IF EXISTS home_facturacion_localidad_mensual(DATE, DATE, INT);
DROP FUNCTION IF EXISTS home_top_productos(DATE, DATE, INT);
DROP FUNCTION IF EXISTS home_top_clientes(DATE, DATE, INT);
DROP FUNCTION IF EXISTS home_mix_canal(DATE, DATE);

-- Top productos por kilos en rango (desde tabla materializada por SKU no, así que pegamos contra ventas con índice)
-- NOTA: este sigue pegando contra ventas porque resumen_clientes_pdv no tiene SKU.
-- Pero está acotado por el índice idx_ventas_sku_vendedor_periodo.
-- En vez de COUNT distinct, hace SUM(kilos) que es rápido con índice covering.
CREATE OR REPLACE FUNCTION home_top_productos(p_desde DATE, p_hasta DATE, p_limit INT DEFAULT 10)
RETURNS TABLE (articulo TEXT, kilos NUMERIC, pct NUMERIC)
LANGUAGE sql STABLE
SET statement_timeout = '30s'
AS $$
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

-- Top clientes por kilos (desde resumen_clientes_pdv + JOIN pdvs)
CREATE OR REPLACE FUNCTION home_top_clientes(p_desde DATE, p_hasta DATE, p_limit INT DEFAULT 10)
RETURNS TABLE (razon_social TEXT, kilos NUMERIC, pct NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH ranged AS (
    SELECT pdv_id, kilos
    FROM resumen_clientes_pdv
    WHERE (anio * 100 + mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                  AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
  ),
  total AS (SELECT SUM(kilos) AS tot FROM ranged)
  SELECT
    COALESCE(p.razon_social, '(sin nombre)')::TEXT,
    SUM(r.kilos)::NUMERIC,
    (SUM(r.kilos) / NULLIF((SELECT tot FROM total), 0))::NUMERIC
  FROM ranged r LEFT JOIN pdvs p ON p.id = r.pdv_id
  GROUP BY p.razon_social
  ORDER BY 2 DESC
  LIMIT p_limit;
$$;

-- Mix por canal (kilos) desde resumen_clientes_pdv
CREATE OR REPLACE FUNCTION home_mix_canal(p_desde DATE, p_hasta DATE)
RETURNS TABLE (canal TEXT, kilos NUMERIC)
LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(p.canal_venta, '(sin canal)')::TEXT,
    SUM(r.kilos)::NUMERIC
  FROM resumen_clientes_pdv r LEFT JOIN pdvs p ON p.id = r.pdv_id
  WHERE (r.anio * 100 + r.mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                    AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
  GROUP BY p.canal_venta
  ORDER BY 2 DESC;
$$;

-- Facturación mensual por localidad — top N
CREATE OR REPLACE FUNCTION home_facturacion_localidad_mensual(
  p_desde DATE,
  p_hasta DATE,
  p_top   INT DEFAULT 5
)
RETURNS TABLE (localidad TEXT, anio INT, mes INT, neto NUMERIC)
LANGUAGE sql STABLE AS $$
  WITH ranged AS (
    SELECT r.anio, r.mes, r.pdv_id, r.neto, p.localidad
    FROM resumen_clientes_pdv r JOIN pdvs p ON p.id = r.pdv_id
    WHERE (r.anio * 100 + r.mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                      AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
      AND p.localidad IS NOT NULL
  ),
  top_locs AS (
    SELECT localidad
    FROM ranged
    GROUP BY localidad
    ORDER BY SUM(neto) DESC
    LIMIT p_top
  )
  SELECT
    r.localidad::TEXT,
    r.anio,
    r.mes,
    SUM(r.neto)::NUMERIC
  FROM ranged r
  WHERE r.localidad IN (SELECT localidad FROM top_locs)
  GROUP BY r.localidad, r.anio, r.mes
  ORDER BY r.localidad, r.anio, r.mes;
$$;

-- ============================================================
-- Cleanup: borrar índices que ya no aportan (con la tabla
-- materializada, los queries del home no necesitan idx_ventas_fecha_pdv)
-- ============================================================
DROP INDEX IF EXISTS idx_ventas_fecha_pdv;
