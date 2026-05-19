-- ============================================================
-- GEO UPSERT RPC — migration 007
-- Receives all geo rows as JSONB, filters valid PDV ids
-- server-side via JOIN, and upserts atomically.
-- Avoids PostgREST row-limit issues on client-side validation.
-- ============================================================

CREATE OR REPLACE FUNCTION bulk_upsert_pdvs_geo(p_rows jsonb)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_upserted       int := 0;
  v_skipped_orphans int := 0;
  v_skipped_no_coords int := 0;
BEGIN
  -- Count rows without coords
  SELECT count(*) INTO v_skipped_no_coords
  FROM jsonb_to_recordset(p_rows) AS x(
    latitud  numeric,
    longitud numeric
  )
  WHERE latitud IS NULL OR longitud IS NULL OR latitud = 0 OR longitud = 0;

  -- Count orphans (have coords but pdv_id not in pdvs)
  SELECT count(*) INTO v_skipped_orphans
  FROM jsonb_to_recordset(p_rows) AS x(
    pdv_id   int,
    latitud  numeric,
    longitud numeric
  )
  WHERE (latitud IS NOT NULL AND longitud IS NOT NULL AND latitud <> 0 AND longitud <> 0)
    AND NOT EXISTS (SELECT 1 FROM pdvs p WHERE p.id = x.pdv_id);

  -- Upsert valid rows
  WITH input AS (
    SELECT DISTINCT ON (pdv_id) *
    FROM jsonb_to_recordset(p_rows) AS x(
      pdv_id        int,
      partido       text,
      provincia     text,
      calle         text,
      altura        text,
      entre1        text,
      entre2        text,
      latitud       numeric,
      longitud      numeric,
      ruteable      boolean,
      domicilio_geo text,
      fecha_geo     date,
      hora_geo      text
    )
    WHERE latitud IS NOT NULL AND longitud IS NOT NULL AND latitud <> 0 AND longitud <> 0
    ORDER BY pdv_id
  ),
  ins AS (
    INSERT INTO pdvs_geo (
      pdv_id, partido, provincia, calle, altura, entre1, entre2,
      latitud, longitud, ruteable, domicilio_geo, fecha_geo, hora_geo, updated_at
    )
    SELECT
      i.pdv_id, i.partido, i.provincia, i.calle, i.altura, i.entre1, i.entre2,
      i.latitud, i.longitud, i.ruteable, i.domicilio_geo, i.fecha_geo, i.hora_geo,
      now()
    FROM input i
    INNER JOIN pdvs p ON p.id = i.pdv_id
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
    'skipped_orphans',   v_skipped_orphans,
    'skipped_no_coords', v_skipped_no_coords
  );
END;
$$;

GRANT EXECUTE ON FUNCTION bulk_upsert_pdvs_geo(jsonb) TO service_role;
