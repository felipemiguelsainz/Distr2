-- ============================================================
-- 037 — Limpiar geo de PDVs no activos
-- ============================================================
-- Al cargar un maestro nuevo, los PDVs que no vienen quedan activo=false (baja
-- lógica, se preserva el historial de ventas por la FK). Su fila en pdvs_geo
-- quedaba huérfana (ignorada por el mapa, pero acumulándose). Esta función la
-- borra: pdvs_geo queda solo con PDVs vigentes. Devuelve cuántas borró.
CREATE OR REPLACE FUNCTION cleanup_pdvs_geo_inactivos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM pdvs_geo g
  WHERE NOT EXISTS (
    SELECT 1 FROM pdvs p WHERE p.id = g.pdv_id AND p.activo = true
  );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE EXECUTE ON FUNCTION cleanup_pdvs_geo_inactivos() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION cleanup_pdvs_geo_inactivos() TO service_role;
