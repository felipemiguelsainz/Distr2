-- ============================================================
-- 028 — Última venta real por PDV (pivot desde la base de ventas)
-- ============================================================
-- El mapa colorea los PDV por recencia de compra (verde ≤1 mes,
-- amarillo >1 mes, rojo >3 meses). La fuente de verdad es la tabla
-- `ventas`, no el campo cacheado `pdvs.ultima_vta` (que puede quedar
-- desactualizado). Devolvemos MAX(fecha) por pdv_id.
--
-- Igual que pdvs_activos_ids, usamos json_agg en una sola fila para
-- esquivar el límite de filas de PostgREST. STABLE / SECURITY INVOKER:
-- solo lee, y se invoca desde el backend con la service_role key.
CREATE OR REPLACE FUNCTION pdvs_ultima_vta()
RETURNS json
LANGUAGE sql STABLE AS $$
  SELECT json_agg(json_build_object('pdv_id', pdv_id, 'ultima', ultima))
  FROM (
    SELECT pdv_id, MAX(fecha) AS ultima
    FROM ventas
    WHERE pdv_id IS NOT NULL
    GROUP BY pdv_id
  ) t
$$;
