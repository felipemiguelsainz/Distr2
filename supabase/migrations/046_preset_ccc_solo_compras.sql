-- ============================================================
-- 046: el preset de metas CCC usa la misma definición de "compró" que el CCC
-- ============================================================
-- La 044 dejó que CCC cuente sólo PDVs con compra efectiva (kilos > 0 OR
-- neto > 0), pero calcular_preset_ccc siguió leyendo resumen_clientes_pdv
-- crudo: la penetración histórica por rubro con la que arma la meta se
-- calculaba sobre PDVs que ese mes sólo habían devuelto.
--
-- No se cancela solo por ser un cociente: las devoluciones no se reparten
-- parejo entre rubros. Medido sobre ago-2025 (el histórico que usa el preset
-- de ago-2026), la penetración por (vendedor, rubro) se corre 1,5 pp en
-- promedio y hasta 26 pp en el peor caso — o sea metas por rubro apuntando a
-- un mix que nunca existió.
--
-- Único cambio respecto de la 027: el filtro (kilos > 0 OR neto > 0) en las
-- dos CTEs del histórico. La meta total (PDVs activos del maestro) no se toca.
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

  -- 2) Meta por rubro = meta_total * (% PDVs que COMPRARON ese rubro el mismo
  --    mes del año anterior).
  WITH totales AS (
    SELECT vendedor, COUNT(DISTINCT pdv_id) AS total_pdvs
    FROM resumen_clientes_pdv
    WHERE anio = v_prev_anio AND mes = p_mes
      AND (kilos > 0 OR neto > 0)
    GROUP BY vendedor
  ),
  por_rubro AS (
    SELECT vendedor, rubro, COUNT(DISTINCT pdv_id) AS pdvs_rubro
    FROM resumen_clientes_pdv
    WHERE anio = v_prev_anio AND mes = p_mes
      AND (kilos > 0 OR neto > 0)
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

REVOKE EXECUTE ON FUNCTION calcular_preset_ccc(INT, INT) FROM anon, authenticated;
