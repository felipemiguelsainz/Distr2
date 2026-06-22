-- ============================================================
-- 031 — Valor histórico por PDV (últimos 12 meses)
-- ============================================================
-- Para priorizar el churn por PLATA EN JUEGO (no por fecha): cuánto facturaba
-- cada PDV por mes cuando compraba. neto_12m = suma de $ de los últimos 12
-- meses; meses = cantidad de meses con compra en esa ventana. El valor mensual
-- se calcula en el backend como neto_12m / max(meses,1).
--
-- Igual que pdvs_ultima_vta: json_agg en una fila para esquivar el límite de
-- filas de PostgREST. STABLE / solo lectura; se llama con la service_role key.
CREATE OR REPLACE FUNCTION pdvs_valor_12m()
RETURNS json
LANGUAGE sql STABLE AS $$
  SELECT json_agg(json_build_object('pdv_id', pdv_id, 'neto_12m', neto, 'meses', meses))
  FROM (
    SELECT pdv_id,
           round(sum(neto))::bigint AS neto,
           count(DISTINCT date_trunc('month', fecha)) AS meses
    FROM ventas
    WHERE pdv_id IS NOT NULL
      AND neto IS NOT NULL
      AND fecha >= (CURRENT_DATE - INTERVAL '12 months')
    GROUP BY pdv_id
  ) t
$$;
