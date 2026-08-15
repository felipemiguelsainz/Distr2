-- ============================================================
-- 045: CCC exacto cuando el rango no cubre meses completos
-- ============================================================
-- Las tres funciones de CCC leen resumen_clientes_pdv, que está agregada por
-- (anio, mes): no tiene día. El filtro convertía el rango a `anio*100+mes` y
-- usaba BETWEEN, así que CUALQUIER rango parcial devolvía el mes entero.
--
-- No era teórico. lib/calculations/queries/clientes.ts corta el año anterior a
-- propósito para comparar contra el mismo día del mes:
--
--   const aaHasta = isCurrentMonth
--     ? `${year-1}-${mm}-${today.getDate()}`   <- rango parcial
--     : `${year-1}-${mm}-${lastDay}`;
--
-- ...y las pantallas de Insights lo anuncian como "(a igual día del mes)".
-- Pero la funcion redondeaba, asi que comparaba 14 dias de este año contra los
-- 31 del año pasado. Medido el 2026-08-14:
--
--   informado para ago 1-14 del año pasado ... 3.505  (era agosto entero)
--   real de ago 1-14 del año pasado ......... 2.942
--   este año, ago 1-14 ...................... 2.924
--
-- O sea: el dashboard mostraba -16,6% interanual donde la caida real era
-- -0,6%. Una caida inventada de 16 puntos, justo en la metrica de cobertura.
--
-- Cada funcion queda con dos ramas mutuamente excluyentes segun si el rango
-- cubre meses completos. La condicion depende solo de los parametros, asi que
-- una sola rama produce filas y el plan de la otra ni se ejecuta:
--
--   * meses completos -> resumen_clientes_pdv, que es para lo que existe
--   * rango parcial   -> ventas, exacto por fecha (~380ms para un mes)
--
-- La rama de ventas replica la semantica del resumen: agrega por
-- (pdv, vendedor, rubro) sobre el rango y exige compra con
-- SUM(kilos) > 0 OR SUM(neto) > 0, igual que el filtro por fila de la 044.
-- Tambien repite sus mismos descartes: pdv_id, rubro y vendedor NOT NULL.
-- ============================================================

CREATE OR REPLACE FUNCTION clientes_activos_total(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p_desde = date_trunc('month', p_desde)::date
     AND p_hasta = (date_trunc('month', p_hasta) + interval '1 month' - interval '1 day')::date
    THEN (
      SELECT COUNT(DISTINCT pdv_id)::bigint
      FROM resumen_clientes_pdv
      WHERE (anio * 100 + mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                   AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
        AND (kilos > 0 OR neto > 0)
        AND (p_vendedores IS NULL OR vendedor = ANY(p_vendedores))
    )
    ELSE (
      SELECT COUNT(DISTINCT t.pdv_id)::bigint FROM (
        SELECT v.pdv_id
        FROM ventas v
        WHERE v.fecha BETWEEN p_desde AND p_hasta
          AND v.pdv_id IS NOT NULL AND v.rubro IS NOT NULL AND v.vendedor IS NOT NULL
          AND (p_vendedores IS NULL OR v.vendedor = ANY(p_vendedores))
        GROUP BY v.pdv_id, v.vendedor, v.rubro
        HAVING SUM(v.kilos) > 0 OR SUM(v.neto) > 0
      ) t
    )
  END
$$;

CREATE OR REPLACE FUNCTION clientes_compra_rubro(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS TABLE(rubro text, clientes bigint)
LANGUAGE sql STABLE AS $$
  SELECT r.rubro, COUNT(DISTINCT r.pdv_id)::BIGINT
  FROM resumen_clientes_pdv r
  WHERE p_desde = date_trunc('month', p_desde)::date
    AND p_hasta = (date_trunc('month', p_hasta) + interval '1 month' - interval '1 day')::date
    AND (r.anio * 100 + r.mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                   AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    AND (r.kilos > 0 OR r.neto > 0)
    AND (p_vendedores IS NULL OR r.vendedor = ANY(p_vendedores))
  GROUP BY r.rubro

  UNION ALL

  SELECT t.rubro, COUNT(DISTINCT t.pdv_id)::BIGINT
  FROM (
    SELECT v.rubro, v.pdv_id
    FROM ventas v
    WHERE NOT (p_desde = date_trunc('month', p_desde)::date
           AND p_hasta = (date_trunc('month', p_hasta) + interval '1 month' - interval '1 day')::date)
      AND v.fecha BETWEEN p_desde AND p_hasta
      AND v.pdv_id IS NOT NULL AND v.rubro IS NOT NULL AND v.vendedor IS NOT NULL
      AND (p_vendedores IS NULL OR v.vendedor = ANY(p_vendedores))
    GROUP BY v.pdv_id, v.vendedor, v.rubro
    HAVING SUM(v.kilos) > 0 OR SUM(v.neto) > 0
  ) t
  GROUP BY t.rubro

  ORDER BY 1;
$$;

CREATE OR REPLACE FUNCTION ccc_por_vendedor(
  p_desde      date,
  p_hasta      date,
  p_equipo     text   DEFAULT NULL,
  p_vendedores text[] DEFAULT NULL
)
RETURNS TABLE(vendedor text, clientes bigint)
LANGUAGE sql STABLE AS $$
  SELECT rcp.vendedor, COUNT(DISTINCT rcp.pdv_id)::bigint
  FROM resumen_clientes_pdv rcp
  WHERE p_desde = date_trunc('month', p_desde)::date
    AND p_hasta = (date_trunc('month', p_hasta) + interval '1 month' - interval '1 day')::date
    AND (rcp.anio * 100 + rcp.mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                       AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    AND (rcp.kilos > 0 OR rcp.neto > 0)
    AND (p_equipo     IS NULL OR rcp.equipo   = p_equipo)
    AND (p_vendedores IS NULL OR rcp.vendedor = ANY(p_vendedores))
  GROUP BY rcp.vendedor

  UNION ALL

  SELECT t.vendedor, COUNT(DISTINCT t.pdv_id)::bigint
  FROM (
    SELECT v.vendedor, v.pdv_id
    FROM ventas v
    LEFT JOIN vendedores vd ON vd.nombre = v.vendedor
    WHERE NOT (p_desde = date_trunc('month', p_desde)::date
           AND p_hasta = (date_trunc('month', p_hasta) + interval '1 month' - interval '1 day')::date)
      AND v.fecha BETWEEN p_desde AND p_hasta
      AND v.pdv_id IS NOT NULL AND v.rubro IS NOT NULL AND v.vendedor IS NOT NULL
      AND (p_equipo     IS NULL OR vd.equipo   = p_equipo)
      AND (p_vendedores IS NULL OR v.vendedor = ANY(p_vendedores))
    GROUP BY v.pdv_id, v.vendedor, v.rubro
    HAVING SUM(v.kilos) > 0 OR SUM(v.neto) > 0
  ) t
  GROUP BY t.vendedor;
$$;
