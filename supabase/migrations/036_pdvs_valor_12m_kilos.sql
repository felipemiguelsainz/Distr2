-- ============================================================
-- 036 — pdvs_valor_12m ahora también devuelve kilos (para Kg/mes)
-- ============================================================
-- La vista de clientes enfriándose suma una columna/KPI de Kg/mes. El RPC sólo
-- devolvía $ (neto); acá agregamos kilos. Mantiene el statement_timeout de 034
-- (CREATE OR REPLACE resetea los SET, hay que re-declararlo).
CREATE OR REPLACE FUNCTION pdvs_valor_12m()
RETURNS json
LANGUAGE sql STABLE
SET statement_timeout = '30s'
AS $$
  SELECT json_agg(json_build_object(
    'pdv_id', pdv_id, 'neto_12m', neto, 'kilos_12m', kilos, 'meses', meses
  ))
  FROM (
    SELECT pdv_id,
           round(sum(neto))::bigint AS neto,
           coalesce(round(sum(kilos)), 0)::bigint AS kilos,
           count(DISTINCT date_trunc('month', fecha)) AS meses
    FROM ventas
    WHERE pdv_id IS NOT NULL AND neto IS NOT NULL
      AND fecha >= (CURRENT_DATE - INTERVAL '12 months')
    GROUP BY pdv_id
  ) t
$$;
