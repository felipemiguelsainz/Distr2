-- ============================================================
-- 049: "compró" es tener una línea de compra, no quedar en positivo
-- ============================================================
-- La 044 sacó las devoluciones del CCC con `SUM(kilos) > 0 OR SUM(neto) > 0`
-- sobre el agregado (pdv, vendedor, rubro). El agregado es el error: un PDV que
-- compró el 5 y el 15 devolvió más de lo que había comprado queda con la suma
-- en negativo y desaparece del CCC — pero compró. La devolución suele ser de
-- mercadería de un mes anterior, así que ni siquiera es la misma venta
-- cancelándose a sí misma.
--
-- Reportado por el cliente el 2026-08-20: el equipo de VALERIA SVENCEN daba
-- 1.367 en la página contra ~1.450 del sistema. Medido sobre 1-19/08/2026 para
-- ese equipo:
--
--   criterio de la 044 (la suma del mes > 0) ..... 1.367
--   con línea de compra (este cambio) ............ 1.424   <- correcto
--   sin filtrar devoluciones (pre-044) ........... 1.439
--
-- O sea: de los 72 clientes que la 044 sacaba, 57 sí habían comprado. Los otros
-- 15 son devolución pura y siguen afuera, que es lo que la 044 quería.
--
-- El arreglo va en la definición, no en cada pantalla: las cinco funciones que
-- cuentan clientes comparten el mismo criterio.
--
--   * Rama `ventas` (rango parcial, mig. 045): el filtro pasa a ser por FILA,
--     antes de agrupar. Como ya no hay que agregar para decidir, el
--     GROUP BY/HAVING se cae entero: COUNT(DISTINCT) sobre las filas de compra.
--   * Rama `resumen_clientes_pdv` (meses completos): la tabla está pre-agregada
--     por mes, la fila individual ahí no existe. Se le agrega `lineas_compra` =
--     cuántas filas del grupo fueron compra, y el filtro pasa a
--     `lineas_compra > 0`.
--
-- `kilos` y `neto` NO cambian: las devoluciones tienen que seguir restando de
-- la facturación. Lo que se arregla es a quién se cuenta como cliente.
-- ============================================================

-- ------------------------------------------------------------
-- 1) resumen_clientes_pdv: columna nueva + recálculo + backfill
-- ------------------------------------------------------------
ALTER TABLE resumen_clientes_pdv
  ADD COLUMN IF NOT EXISTS lineas_compra INT NOT NULL DEFAULT 0;

-- Igual que la 021 (mantiene el LOCK defensivo), + lineas_compra.
CREATE OR REPLACE FUNCTION recalcular_resumen_clientes_pdv(p_periodos TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
DECLARE
  p TEXT;
  py INT;
  pm INT;
BEGIN
  IF p_periodos IS NULL OR array_length(p_periodos, 1) IS NULL THEN RETURN; END IF;

  LOCK TABLE resumen_clientes_pdv IN SHARE ROW EXCLUSIVE MODE;

  FOREACH p IN ARRAY p_periodos LOOP
    py := SPLIT_PART(p, '-', 1)::INT;
    pm := SPLIT_PART(p, '-', 2)::INT;

    DELETE FROM resumen_clientes_pdv WHERE anio = py AND mes = pm;

    INSERT INTO resumen_clientes_pdv (anio, mes, pdv_id, vendedor, rubro, equipo, kilos, neto, skus, lineas_compra)
    SELECT
      EXTRACT(YEAR  FROM v.fecha)::INT,
      EXTRACT(MONTH FROM v.fecha)::INT,
      v.pdv_id,
      v.vendedor,
      v.rubro,
      MAX(vd.equipo),
      SUM(v.kilos)::NUMERIC,
      SUM(v.neto)::NUMERIC,
      COUNT(DISTINCT v.sku)::INT,
      COUNT(*) FILTER (WHERE v.kilos > 0 OR v.neto > 0)::INT
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
$fn$;

-- Backfill de todo el histórico ya cargado: la columna arranca en 0 y sin esto
-- el CCC de los meses completos daría 0 clientes.
UPDATE resumen_clientes_pdv rcp
SET lineas_compra = src.n
FROM (
  SELECT
    EXTRACT(YEAR  FROM v.fecha)::INT AS anio,
    EXTRACT(MONTH FROM v.fecha)::INT AS mes,
    v.pdv_id, v.vendedor, v.rubro,
    COUNT(*) FILTER (WHERE v.kilos > 0 OR v.neto > 0)::INT AS n
  FROM ventas v
  WHERE v.pdv_id IS NOT NULL AND v.rubro IS NOT NULL AND v.vendedor IS NOT NULL
  GROUP BY 1, 2, 3, 4, 5
) src
WHERE rcp.anio     = src.anio
  AND rcp.mes      = src.mes
  AND rcp.pdv_id   = src.pdv_id
  AND rcp.vendedor = src.vendedor
  AND rcp.rubro    = src.rubro;

-- ------------------------------------------------------------
-- 2) Las funciones que cuentan clientes
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION clientes_activos_total(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN p_desde = date_trunc('month', p_desde)::date
     AND p_hasta = (date_trunc('month', p_hasta) + interval '1 month' - interval '1 day')::date
    THEN (
      SELECT COUNT(DISTINCT pdv_id)::bigint
      FROM resumen_clientes_pdv
      WHERE (anio * 100 + mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                   AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
        AND lineas_compra > 0
        AND (p_vendedores IS NULL OR vendedor = ANY(p_vendedores))
    )
    ELSE (
      SELECT COUNT(DISTINCT v.pdv_id)::bigint
      FROM ventas v
      WHERE v.fecha BETWEEN p_desde AND p_hasta
        AND v.pdv_id IS NOT NULL AND v.rubro IS NOT NULL AND v.vendedor IS NOT NULL
        AND (v.kilos > 0 OR v.neto > 0)
        AND (p_vendedores IS NULL OR v.vendedor = ANY(p_vendedores))
    )
  END
$fn$;

CREATE OR REPLACE FUNCTION clientes_compra_rubro(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS TABLE(rubro text, clientes bigint)
LANGUAGE sql STABLE AS $fn$
  SELECT r.rubro, COUNT(DISTINCT r.pdv_id)::BIGINT
  FROM resumen_clientes_pdv r
  WHERE p_desde = date_trunc('month', p_desde)::date
    AND p_hasta = (date_trunc('month', p_hasta) + interval '1 month' - interval '1 day')::date
    AND (r.anio * 100 + r.mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                   AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    AND r.lineas_compra > 0
    AND (p_vendedores IS NULL OR r.vendedor = ANY(p_vendedores))
  GROUP BY r.rubro

  UNION ALL

  SELECT v.rubro, COUNT(DISTINCT v.pdv_id)::BIGINT
  FROM ventas v
  WHERE NOT (p_desde = date_trunc('month', p_desde)::date
         AND p_hasta = (date_trunc('month', p_hasta) + interval '1 month' - interval '1 day')::date)
    AND v.fecha BETWEEN p_desde AND p_hasta
    AND v.pdv_id IS NOT NULL AND v.rubro IS NOT NULL AND v.vendedor IS NOT NULL
    AND (v.kilos > 0 OR v.neto > 0)
    AND (p_vendedores IS NULL OR v.vendedor = ANY(p_vendedores))
  GROUP BY v.rubro

  ORDER BY 1;
$fn$;

CREATE OR REPLACE FUNCTION ccc_por_vendedor(
  p_desde      date,
  p_hasta      date,
  p_equipo     text   DEFAULT NULL,
  p_vendedores text[] DEFAULT NULL
)
RETURNS TABLE(vendedor text, clientes bigint)
LANGUAGE sql STABLE AS $fn$
  SELECT rcp.vendedor, COUNT(DISTINCT rcp.pdv_id)::bigint
  FROM resumen_clientes_pdv rcp
  WHERE p_desde = date_trunc('month', p_desde)::date
    AND p_hasta = (date_trunc('month', p_hasta) + interval '1 month' - interval '1 day')::date
    AND (rcp.anio * 100 + rcp.mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                       AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    AND rcp.lineas_compra > 0
    AND (p_equipo     IS NULL OR rcp.equipo   = p_equipo)
    AND (p_vendedores IS NULL OR rcp.vendedor = ANY(p_vendedores))
  GROUP BY rcp.vendedor

  UNION ALL

  SELECT v.vendedor, COUNT(DISTINCT v.pdv_id)::bigint
  FROM ventas v
  LEFT JOIN vendedores vd ON vd.nombre = v.vendedor
  WHERE NOT (p_desde = date_trunc('month', p_desde)::date
         AND p_hasta = (date_trunc('month', p_hasta) + interval '1 month' - interval '1 day')::date)
    AND v.fecha BETWEEN p_desde AND p_hasta
    AND v.pdv_id IS NOT NULL AND v.rubro IS NOT NULL AND v.vendedor IS NOT NULL
    AND (v.kilos > 0 OR v.neto > 0)
    AND (p_equipo     IS NULL OR vd.equipo   = p_equipo)
    AND (p_vendedores IS NULL OR v.vendedor = ANY(p_vendedores))
  GROUP BY v.vendedor;
$fn$;

-- La columna CCC del consolidado por producto (mig. 047) tiene que reconciliar
-- con ccc_por_vendedor, así que usa exactamente el mismo criterio.
CREATE OR REPLACE FUNCTION consolidado_por_producto(
  p_desde     DATE,
  p_hasta     DATE,
  p_equipo    TEXT,
  p_articulos TEXT[] DEFAULT NULL
)
RETURNS TABLE (vendedor TEXT, kilos NUMERIC, neto NUMERIC, ccc INT)
LANGUAGE sql STABLE AS $fn$
  WITH filtradas AS (
    SELECT v.vendedor, v.pdv_id, v.rubro, v.kilos, v.neto
    FROM ventas v
    JOIN vendedores vd ON vd.nombre = v.vendedor
    WHERE v.fecha BETWEEN p_desde AND p_hasta
      AND (p_equipo IS NULL OR vd.equipo = p_equipo)
      AND (p_articulos IS NULL OR array_length(p_articulos, 1) IS NULL
           OR v.articulo = ANY(p_articulos))
  ),
  compradores AS (
    SELECT vendedor, COUNT(DISTINCT pdv_id)::INT AS ccc
    FROM filtradas
    WHERE pdv_id IS NOT NULL AND (kilos > 0 OR neto > 0)
    GROUP BY vendedor
  )
  SELECT f.vendedor, SUM(f.kilos)::NUMERIC, SUM(f.neto)::NUMERIC, COALESCE(c.ccc, 0)::INT
  FROM filtradas f
  LEFT JOIN compradores c ON c.vendedor = f.vendedor
  GROUP BY f.vendedor, c.ccc
  ORDER BY f.vendedor;
$fn$;

-- El preset de metas CCC mide penetración histórica por rubro: misma definición
-- de "compró" que el CCC (mig. 046), ahora sobre lineas_compra.
CREATE OR REPLACE FUNCTION calcular_preset_ccc(p_mes INT, p_anio INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_count     INT := 0;
  v_prev_anio INT := p_anio - 1;
BEGIN
  -- 1) Meta total = PDVs activos asignados al vendedor en el maestro.
  INSERT INTO metas_ccc (mes, anio, vendedor, rubro, meta_pdvs, es_preset, updated_at)
  SELECT p_mes, p_anio, v.nombre, NULL, COUNT(p.id), true, NOW()
  FROM vendedores v
  JOIN pdvs p ON p.cartera = v.nombre AND p.activo = true
  WHERE v.activo = true
  GROUP BY v.nombre
  ON CONFLICT (mes, anio, vendedor, rubro) DO UPDATE
    SET meta_pdvs = EXCLUDED.meta_pdvs, updated_at = NOW()
    WHERE metas_ccc.es_preset = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 2) Meta por rubro = meta_total * (% PDVs que COMPRARON ese rubro el mismo
  --    mes del año anterior).
  WITH totales AS (
    SELECT vendedor, COUNT(DISTINCT pdv_id) AS total_pdvs
    FROM resumen_clientes_pdv
    WHERE anio = v_prev_anio AND mes = p_mes
      AND lineas_compra > 0
    GROUP BY vendedor
  ),
  por_rubro AS (
    SELECT vendedor, rubro, COUNT(DISTINCT pdv_id) AS pdvs_rubro
    FROM resumen_clientes_pdv
    WHERE anio = v_prev_anio AND mes = p_mes
      AND lineas_compra > 0
    GROUP BY vendedor, rubro
  ),
  metas_total AS (
    SELECT vendedor, meta_pdvs
    FROM metas_ccc
    WHERE mes = p_mes AND anio = p_anio AND rubro IS NULL
  )
  INSERT INTO metas_ccc (mes, anio, vendedor, rubro, meta_pdvs, es_preset, updated_at)
  SELECT p_mes, p_anio, pr.vendedor, pr.rubro,
         ROUND(mt.meta_pdvs * (pr.pdvs_rubro::numeric / NULLIF(t.total_pdvs, 0)))::int,
         true, NOW()
  FROM por_rubro pr
  JOIN totales t      ON t.vendedor = pr.vendedor
  JOIN metas_total mt ON mt.vendedor = pr.vendedor
  WHERE t.total_pdvs > 0
  ON CONFLICT (mes, anio, vendedor, rubro) DO UPDATE
    SET meta_pdvs = EXCLUDED.meta_pdvs, updated_at = NOW()
    WHERE metas_ccc.es_preset = true;

  RETURN v_count;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION calcular_preset_ccc(INT, INT) FROM anon, authenticated;
