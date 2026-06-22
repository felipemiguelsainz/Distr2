-- ============================================================
-- 032 — Cadencia de compra por PDV (para detectar "enfriándose")
-- ============================================================
-- Mediana de días entre compras de cada PDV en los últimos 12 meses + su última
-- compra. Sirve para detectar clientes que ROMPIERON su frecuencia habitual
-- (compran cada X días y hace >2X que no compran) aunque todavía cuenten como
-- "activos" por el corte plano de 3 meses → anticipa el churn.
--
-- Solo PDVs con >=3 intervalos (>=4 compras distintas) para que la cadencia sea
-- confiable. cadencia en días (entero). json_agg en una fila (PostgREST).
CREATE OR REPLACE FUNCTION pdvs_cadencia()
RETURNS json
LANGUAGE sql STABLE AS $$
  WITH dias AS (
    SELECT DISTINCT pdv_id, fecha
    FROM ventas
    WHERE pdv_id IS NOT NULL AND fecha >= CURRENT_DATE - INTERVAL '12 months'
  ),
  difs AS (
    SELECT pdv_id, fecha,
           (fecha - LAG(fecha) OVER (PARTITION BY pdv_id ORDER BY fecha)) AS gap
    FROM dias
  )
  SELECT json_agg(json_build_object('pdv_id', pdv_id, 'cadencia', cad, 'ultima', ult))
  FROM (
    SELECT pdv_id,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap))::int AS cad,
           max(fecha) AS ult
    FROM difs
    GROUP BY pdv_id
    HAVING count(gap) >= 3
  ) t
$$;
