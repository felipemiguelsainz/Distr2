-- ============================================================
-- 029 — Validación de geolocalización en la carga (por localidad)
-- ============================================================
-- Problema: el upload de pdvs_geo guardaba las coords del archivo tal cual,
-- así que las coords erróneas del CSV (puntos en otras provincias, centroides)
-- entraban derecho y había que correr un script manual cada vez.
--
-- Solución: una tabla de centroides por localidad (la "verdad") y un RPC de
-- upsert que valida cada coord contra el centro de su localidad y la corrige
-- (o rechaza) en el momento. La localidad sale de pdvs.localidad (la fuente
-- de verdad usable; pdvs_geo.partido viene vacío).

-- ---- Distancia (km) entre dos coordenadas, para validar cercanía -----------
CREATE OR REPLACE FUNCTION haversine_km(
  lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric
) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- ---- Tabla de centroides por localidad ------------------------------------
-- La clave es la localidad NORMALIZADA: mayúsculas, sin espacios al borde y
-- con la Ñ arreglada ("#" en el maestro es una Ñ mal codificada).
CREATE TABLE IF NOT EXISTS localidades_geo (
  localidad  text PRIMARY KEY,
  lat        numeric NOT NULL,
  lng        numeric NOT NULL,
  n_puntos   int,
  fuente     text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE localidades_geo ENABLE ROW LEVEL SECURITY; -- solo service_role (bypassa RLS)

CREATE OR REPLACE FUNCTION norm_localidad(s text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(trim(replace(coalesce(s, ''), '#', 'Ñ')));
$$;

-- ---- (Re)construir la tabla desde los PDVs sanos --------------------------
-- Centroide = mediana de los puntos DENTRO del GBA por localidad (>= 3 puntos
-- para confiar). Idempotente: se puede correr después de cargas para refrescar.
CREATE OR REPLACE FUNCTION refresh_localidades_geo() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO localidades_geo (localidad, lat, lng, n_puntos, fuente, updated_at)
  SELECT norm_localidad(p.localidad),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY g.latitud),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY g.longitud),
         count(*), 'mediana', now()
  FROM pdvs_geo g
  JOIN pdvs p ON p.id = g.pdv_id AND p.activo = true
  WHERE g.latitud  BETWEEN -35.6 AND -34.2
    AND g.longitud BETWEEN -59.2 AND -57.7
    AND norm_localidad(p.localidad) <> ''
  GROUP BY norm_localidad(p.localidad)
  HAVING count(*) >= 3
  ON CONFLICT (localidad) DO UPDATE SET
    lat = EXCLUDED.lat, lng = EXCLUDED.lng,
    n_puntos = EXCLUDED.n_puntos, fuente = EXCLUDED.fuente, updated_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Siembra inicial desde los datos (ya corregidos) actuales.
SELECT refresh_localidades_geo();

-- ---- Upsert de geo con validación/corrección por localidad -----------------
-- Cascada por fila (coords no nulas, PDV existente):
--   * en GBA y cerca del centroide (o sin centroide)  -> se guarda tal cual
--   * lejos del centroide / fuera del GBA, con centroide -> se corrige al centro
--   * fuera del GBA sin centroide, o sin localidad      -> se RECHAZA
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
  c_umbral_km  constant numeric := 10; -- tolerancia respecto del centro de la localidad
BEGIN
  -- Entrada deduplicada por pdv_id
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

  -- Resolver localidad + centroide y decidir el destino de cada fila usable
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

  -- Estado + coords finales
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

  -- Upsert de las aceptadas (keep + corrected)
  WITH ins AS (
    INSERT INTO pdvs_geo (
      pdv_id, partido, provincia, calle, altura, entre1, entre2,
      latitud, longitud, ruteable, domicilio_geo, fecha_geo, hora_geo, updated_at
    )
    SELECT
      d.pdv_id, d.partido, d.provincia, d.calle, d.altura, d.entre1, d.entre2,
      d.final_lat, d.final_lng, d.ruteable, d.domicilio_geo, d.fecha_geo, d.hora_geo, now()
    FROM _decided d
    WHERE d.status IN ('keep', 'corrected')
    ON CONFLICT (pdv_id) DO UPDATE SET
      partido       = EXCLUDED.partido,
      provincia     = EXCLUDED.provincia,
      calle         = EXCLUDED.calle,
      altura        = EXCLUDED.altura,
      entre1        = EXCLUDED.entre1,
      entre2        = EXCLUDED.entre2,
      latitud       = EXCLUDED.latitud,
      longitud      = EXCLUDED.longitud,
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

-- Permisos: estas funciones son SECURITY DEFINER y solo las llama el backend.
REVOKE EXECUTE ON FUNCTION refresh_localidades_geo()        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION refresh_localidades_geo()        TO service_role;
REVOKE EXECUTE ON FUNCTION bulk_upsert_pdvs_geo(jsonb)      FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION bulk_upsert_pdvs_geo(jsonb)      TO service_role;
