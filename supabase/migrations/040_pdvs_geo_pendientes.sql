-- ============================================================
-- 040 — Cola de PDV imprecisos pendientes de re-geocodificar (para el cron)
-- ============================================================
-- Devuelve los PDV aproximados (centro de barrio) que todavía NO fueron
-- verificados, con su dirección y el centroide de su localidad. El cron de
-- /api/cron/geo-fix los agarra de a lotes chicos (rate-limit de Nominatim) y
-- los arregla con IA, marcándolos geo_verificada=true (se procesen bien o no,
-- para no reintentarlos infinito).

CREATE OR REPLACE FUNCTION pdvs_geo_pendientes(p_limit int DEFAULT 15)
RETURNS TABLE(
  pdv_id int, domicilio text, calle text, altura text,
  localidad text, partido text, cen_lat numeric, cen_lng numeric
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT g.pdv_id, p.domicilio, g.calle, g.altura, p.localidad, g.partido, lg.lat, lg.lng
  FROM pdvs_geo g
  JOIN pdvs p ON p.id = g.pdv_id AND p.activo
  JOIN localidades_geo lg ON lg.localidad = norm_localidad(p.localidad)
  WHERE g.aproximada AND NOT g.geo_verificada
  ORDER BY g.pdv_id
  LIMIT GREATEST(1, LEAST(p_limit, 40));
$$;

REVOKE EXECUTE ON FUNCTION pdvs_geo_pendientes(int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION pdvs_geo_pendientes(int) TO service_role;
