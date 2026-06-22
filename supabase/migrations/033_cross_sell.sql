-- ============================================================
-- 033 — Cross-sell por mix de rubros
-- ============================================================
-- Detecta oportunidades de venta nueva: clientes ACTIVOS (compraron en los
-- últimos 3 meses) que NO compran alguno de los rubros más fuertes de la
-- distribuidora. Por cada rubro ancla devuelve cuántos activos no lo compran,
-- un $ estimado de oportunidad (no_compran × promedio mensual por comprador) y
-- una muestra de los clientes de mayor valor a los que conviene ofrecérselo.
--
-- p_carteras: scope (NULL = toda la empresa). Filtra por ventas.cartera.
CREATE OR REPLACE FUNCTION cross_sell(p_carteras text[] DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT pdv_id, rubro, neto, fecha
  FROM ventas
  WHERE pdv_id IS NOT NULL AND rubro IS NOT NULL AND neto IS NOT NULL
    AND fecha >= CURRENT_DATE - INTERVAL '12 months'
    AND (p_carteras IS NULL OR cartera = ANY(p_carteras))
),
activos AS (
  SELECT DISTINCT pdv_id FROM base WHERE fecha >= CURRENT_DATE - INTERVAL '3 months'
),
base_act AS (
  SELECT b.pdv_id, b.rubro, b.neto FROM base b JOIN activos a ON a.pdv_id = b.pdv_id
),
anchors AS ( -- rubros más penetrados (los fuertes) entre clientes activos
  SELECT rubro,
         count(DISTINCT pdv_id) AS n_buyers,
         sum(neto) / count(DISTINCT pdv_id) / 12.0 AS avg_mes_buyer
  FROM base_act GROUP BY rubro
  ORDER BY count(DISTINCT pdv_id) DESC LIMIT 4
),
val_pdv AS (SELECT pdv_id, sum(neto) AS v FROM base_act GROUP BY pdv_id),
pares AS ( -- (cliente, rubro) que SÍ existen, solo para los rubros ancla
  SELECT DISTINCT pdv_id, rubro FROM base_act WHERE rubro IN (SELECT rubro FROM anchors)
),
no_buyers AS ( -- activos que NO compran cada rubro ancla
  SELECT a.rubro, x.pdv_id FROM (SELECT rubro FROM anchors) a CROSS JOIN activos x
  EXCEPT
  SELECT rubro, pdv_id FROM pares
),
ranked AS (
  SELECT nb.rubro, nb.pdv_id,
         row_number() OVER (PARTITION BY nb.rubro ORDER BY vp.v DESC NULLS LAST) AS rn,
         count(*) OVER (PARTITION BY nb.rubro) AS n_no
  FROM no_buyers nb LEFT JOIN val_pdv vp ON vp.pdv_id = nb.pdv_id
)
SELECT json_agg(j) FROM (
  SELECT json_build_object(
    'rubro', r.rubro,
    'n_no_compran', max(r.n_no),
    'valor_estimado', round(max(r.n_no) * max(an.avg_mes_buyer)),
    'pdv_ids', json_agg(r.pdv_id ORDER BY r.rn) FILTER (WHERE r.rn <= 8)
  ) AS j
  FROM ranked r JOIN anchors an ON an.rubro = r.rubro
  GROUP BY r.rubro
  ORDER BY max(r.n_no) * max(an.avg_mes_buyer) DESC
) z
$$;
