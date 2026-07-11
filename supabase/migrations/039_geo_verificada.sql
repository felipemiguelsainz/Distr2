-- ============================================================
-- 039 — Proteger coords verificadas/arregladas de ser pisadas por re-uploads
-- ============================================================
-- Problema: bulk_upsert_pdvs_geo (carga de geo) hace ON CONFLICT DO UPDATE y
-- pisa lat/long con las del CSV. Los arreglos con IA (regeocode-centroides,
-- fix-geo-outliers) se perderían en cada re-carga del maestro.
--
-- Solución: flag geo_verificada. Si está en true, el upsert NO pisa las coords
-- ni el flag `aproximada` (preserva el arreglo); sí actualiza los demás campos
-- (partido, calle, etc.). Los scripts de arreglo lo setean en true.
-- Los PDV nuevos entran con geo_verificada=false (comportamiento normal).

ALTER TABLE pdvs_geo ADD COLUMN IF NOT EXISTS geo_verificada boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION bulk_upsert_pdvs_geo(p_rows jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_upserted          int := 0;
  v_corrected         int := 0;
  v_rejected          int := 0;
  v_skipped_orphans   int := 0;
  v_skipped_no_coords int := 0;
  c_umbral_km  constant numeric := 10;
BEGIN
  CREATE TEMP TABLE _in ON COMMIT DROP AS
  SELECT DISTINCT ON (x.pdv_id) x.*
  FROM jsonb_to_recordset(p_rows) AS x(
    pdv_id int, partido text, provincia text, calle text, altura text,
    entre1 text, entre2 text, latitud numeric, longitud numeric,
    ruteable boolean, domicilio_geo text, fecha_geo date, hora_geo text
  )
  ORDER BY x.pdv_id;

  SELECT count(*) INTO v_skipped_no_coords FROM _in
   WHERE latitud IS NULL OR longitud IS NULL OR latitud = 0 OR longitud = 0;

  SELECT count(*) INTO v_skipped_orphans FROM _in i
   WHERE latitud IS NOT NULL AND longitud IS NOT NULL AND latitud <> 0 AND longitud <> 0
     AND NOT EXISTS (SELECT 1 FROM pdvs p WHERE p.id = i.pdv_id);

  CREATE TEMP TABLE _decided ON COMMIT DROP AS
  SELECT
    i.pdv_id, i.partido, i.provincia, i.calle, i.altura, i.entre1, i.entre2,
    i.ruteable, i.domicilio_geo, i.fecha_geo, i.hora_geo,
    i.latitud  AS in_lat,
    i.longitud AS in_lng,
    lg.lat AS ref_lat, lg.lng AS ref_lng,
    norm_localidad(p.localidad) AS loc,
    (i.latitud BETWEEN -35.6 AND -34.2 AND i.longitud BETWEEN -59.2 AND -57.7) AS in_gba,
    CASE WHEN lg.lat IS NOT NULL
         THEN haversine_km(i.latitud, i.longitud, lg.lat, lg.lng) END AS dist_km
  FROM _in i
  JOIN pdvs p ON p.id = i.pdv_id
  LEFT JOIN localidades_geo lg ON lg.localidad = norm_localidad(p.localidad)
  WHERE i.latitud IS NOT NULL AND i.longitud IS NOT NULL AND i.latitud <> 0 AND i.longitud <> 0;

  ALTER TABLE _decided ADD COLUMN status text;
  ALTER TABLE _decided ADD COLUMN final_lat numeric;
  ALTER TABLE _decided ADD COLUMN final_lng numeric;

  UPDATE _decided SET
    status = CASE
      WHEN loc = '' THEN 'rejected'
      WHEN in_gba AND (ref_lat IS NULL OR dist_km <= c_umbral_km) THEN 'keep'
      WHEN ref_lat IS NOT NULL THEN 'corrected'
      ELSE 'rejected'
    END;

  UPDATE _decided SET
    final_lat = CASE WHEN status = 'corrected' THEN ref_lat ELSE in_lat END,
    final_lng = CASE WHEN status = 'corrected' THEN ref_lng ELSE in_lng END;

  SELECT count(*) FILTER (WHERE status = 'corrected'),
         count(*) FILTER (WHERE status = 'rejected')
    INTO v_corrected, v_rejected
  FROM _decided;

  WITH ins AS (
    INSERT INTO pdvs_geo (
      pdv_id, partido, provincia, calle, altura, entre1, entre2,
      latitud, longitud, ruteable, domicilio_geo, fecha_geo, hora_geo, aproximada, updated_at
    )
    SELECT
      d.pdv_id, d.partido, d.provincia, d.calle, d.altura, d.entre1, d.entre2,
      d.final_lat, d.final_lng, d.ruteable, d.domicilio_geo, d.fecha_geo, d.hora_geo,
      (d.status = 'corrected'), now()
    FROM _decided d
    WHERE d.status IN ('keep', 'corrected')
    ON CONFLICT (pdv_id) DO UPDATE SET
      partido       = EXCLUDED.partido,
      provincia     = EXCLUDED.provincia,
      calle         = EXCLUDED.calle,
      altura        = EXCLUDED.altura,
      entre1        = EXCLUDED.entre1,
      entre2        = EXCLUDED.entre2,
      -- Coords y flag: si el PDV fue verificado/arreglado, NO pisar (preservar).
      latitud       = CASE WHEN pdvs_geo.geo_verificada THEN pdvs_geo.latitud    ELSE EXCLUDED.latitud    END,
      longitud      = CASE WHEN pdvs_geo.geo_verificada THEN pdvs_geo.longitud   ELSE EXCLUDED.longitud   END,
      aproximada    = CASE WHEN pdvs_geo.geo_verificada THEN pdvs_geo.aproximada ELSE EXCLUDED.aproximada END,
      ruteable      = EXCLUDED.ruteable,
      domicilio_geo = EXCLUDED.domicilio_geo,
      fecha_geo     = EXCLUDED.fecha_geo,
      hora_geo      = EXCLUDED.hora_geo,
      updated_at    = now()
    RETURNING pdv_id
  )
  SELECT count(*) INTO v_upserted FROM ins;

  RETURN json_build_object(
    'upserted',          v_upserted,
    'corrected',         v_corrected,
    'rejected',          v_rejected,
    'skipped_orphans',   v_skipped_orphans,
    'skipped_no_coords', v_skipped_no_coords
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION bulk_upsert_pdvs_geo(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION bulk_upsert_pdvs_geo(jsonb) TO service_role;
