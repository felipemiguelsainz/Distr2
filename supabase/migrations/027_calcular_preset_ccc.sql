-- ============================================================
-- RPC calcular_preset_ccc — migration 027
-- Calcula y upsertea las metas CCC preseteadas para (p_mes, p_anio):
--   1) meta total por vendedor = # de PDVs activos asignados (pdvs.cartera = vendedor)
--   2) meta por rubro = meta_total * penetración histórica del mismo mes del año
--      anterior (de los PDVs que compraron, qué % compró ese rubro), desde
--      resumen_clientes_pdv.
-- Solo pisa filas con es_preset = true → respeta las ediciones del supervisor.
-- Devuelve la cantidad de filas total (rubro NULL) escritas.
-- ============================================================

CREATE OR REPLACE FUNCTION calcular_preset_ccc(p_mes INT, p_anio INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count     INT := 0;
  v_prev_anio INT := p_anio - 1;
BEGIN
  -- 1) Meta total = PDVs activos asignados al vendedor en el maestro.
  INSERT INTO metas_ccc (mes, anio, vendedor, rubro, meta_pdvs, es_preset, updated_at)
  SELECT p_mes, p_anio, v.nombre, NULL, COUNT(p.id), true, NOW()
  FROM vendedores v
  JOIN pdvs p ON p.cartera = v.nombre AND p.activo = true
  WHERE v.activo = true
  GROUP BY v.nombre
  ON CONFLICT (mes, anio, vendedor, rubro) DO UPDATE
    SET meta_pdvs = EXCLUDED.meta_pdvs, updated_at = NOW()
    WHERE metas_ccc.es_preset = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- 2) Meta por rubro = meta_total * (% PDVs que compraron ese rubro el mismo
  --    mes del año anterior).
  WITH totales AS (
    SELECT vendedor, COUNT(DISTINCT pdv_id) AS total_pdvs
    FROM resumen_clientes_pdv
    WHERE anio = v_prev_anio AND mes = p_mes
    GROUP BY vendedor
  ),
  por_rubro AS (
    SELECT vendedor, rubro, COUNT(DISTINCT pdv_id) AS pdvs_rubro
    FROM resumen_clientes_pdv
    WHERE anio = v_prev_anio AND mes = p_mes
    GROUP BY vendedor, rubro
  ),
  metas_total AS (
    SELECT vendedor, meta_pdvs
    FROM metas_ccc
    WHERE mes = p_mes AND anio = p_anio AND rubro IS NULL
  )
  INSERT INTO metas_ccc (mes, anio, vendedor, rubro, meta_pdvs, es_preset, updated_at)
  SELECT p_mes, p_anio, pr.vendedor, pr.rubro,
         ROUND(mt.meta_pdvs * (pr.pdvs_rubro::numeric / NULLIF(t.total_pdvs, 0)))::int,
         true, NOW()
  FROM por_rubro pr
  JOIN totales t      ON t.vendedor = pr.vendedor
  JOIN metas_total mt ON mt.vendedor = pr.vendedor
  WHERE t.total_pdvs > 0
  ON CONFLICT (mes, anio, vendedor, rubro) DO UPDATE
    SET meta_pdvs = EXCLUDED.meta_pdvs, updated_at = NOW()
    WHERE metas_ccc.es_preset = true;

  RETURN v_count;
END;
$$;

-- Siguiendo el patrón de migration 024: las funciones SECURITY DEFINER de
-- escritura no se exponen a anon/authenticated; solo el service role las llama.
REVOKE EXECUTE ON FUNCTION calcular_preset_ccc(INT, INT) FROM anon, authenticated;
