-- ============================================================
-- 035 — Tendencia interanual a igual día del mes (apples-to-apples)
-- ============================================================
-- La comparación vs año pasado se distorsiona cuando el mes en curso está
-- incompleto (p. ej. hoy 22 pero datos hasta el 11): compara parcial vs total
-- y exagera la caída. Acá cortamos AMBOS años en el mismo día del mes (el
-- último con datos del mes en curso) → comparación justa, por rubro.
CREATE OR REPLACE FUNCTION tendencia_anual(p_carteras text[] DEFAULT NULL)
RETURNS json
LANGUAGE sql STABLE
SET statement_timeout = '30s'
AS $$
  WITH corte AS (
    SELECT COALESCE(EXTRACT(day FROM max(fecha))::int, EXTRACT(day FROM CURRENT_DATE)::int) AS dia
    FROM ventas
    WHERE (p_carteras IS NULL OR cartera = ANY(p_carteras))
      AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)
  ),
  este AS (
    SELECT rubro, sum(neto) AS v FROM ventas, corte
    WHERE (p_carteras IS NULL OR cartera = ANY(p_carteras)) AND rubro IS NOT NULL
      AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)
      AND EXTRACT(day FROM fecha) <= corte.dia
    GROUP BY rubro
  ),
  aa AS (
    SELECT rubro, sum(neto) AS v FROM ventas, corte
    WHERE (p_carteras IS NULL OR cartera = ANY(p_carteras)) AND rubro IS NOT NULL
      AND date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE - INTERVAL '1 year')
      AND EXTRACT(day FROM fecha) <= corte.dia
    GROUP BY rubro
  )
  SELECT json_agg(json_build_object(
           'rubro', r, 'este', round(e), 'aa', round(a),
           'pct', CASE WHEN a > 0 THEN round((e - a) / a * 100) ELSE NULL END
         ) ORDER BY a DESC)
  FROM (
    SELECT COALESCE(este.rubro, aa.rubro) AS r, COALESCE(este.v, 0) AS e, COALESCE(aa.v, 0) AS a
    FROM este FULL OUTER JOIN aa ON este.rubro = aa.rubro
  ) t
$$;
