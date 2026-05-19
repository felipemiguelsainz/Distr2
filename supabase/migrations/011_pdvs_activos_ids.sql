-- Returns all distinct pdv_ids with a purchase since p_desde as a JSON array.
-- Using json_agg in a single row bypasses PostgREST's default row limit.
CREATE OR REPLACE FUNCTION pdvs_activos_ids(p_desde date)
RETURNS json
LANGUAGE sql STABLE AS $$
  SELECT json_agg(pdv_id)
  FROM (SELECT DISTINCT pdv_id FROM ventas WHERE fecha >= p_desde) t
$$;
