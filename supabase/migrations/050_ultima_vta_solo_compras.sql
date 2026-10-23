-- ============================================================
-- 050 — La última venta de un PDV es su última COMPRA
-- ============================================================
-- Mapa, Planificación y Ruta deciden "cartera activa" (compró en los últimos
-- 3 meses) con MAX(fecha) de esta función. Contaba también las devoluciones, así
-- que un PDV que solo devolvió aparecía activo, mientras que la tabla de
-- Clientes (clientes_activos_total) ya exigía una línea de compra (mig. 049).
-- Mismo criterio de "compró" en todas las pantallas.
CREATE OR REPLACE FUNCTION pdvs_ultima_vta()
RETURNS json
LANGUAGE sql STABLE AS $$
  SELECT json_agg(json_build_object('pdv_id', pdv_id, 'ultima', ultima))
  FROM (
    SELECT pdv_id, MAX(fecha) AS ultima
    FROM ventas
    WHERE pdv_id IS NOT NULL
      AND (kilos > 0 OR neto > 0)
    GROUP BY pdv_id
  ) t
$$;

-- CREATE OR REPLACE pisa los SET de la función: se repone el de la 034.
ALTER FUNCTION pdvs_ultima_vta() SET statement_timeout = '30s';
