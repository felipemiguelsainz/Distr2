-- ============================================================
-- Audit fixes — migration 019
-- Corrige hallazgos R1, S3, D1, C1 del audit de DB.
-- ============================================================

-- ------------------------------------------------------------
-- R1: scope por rol en resumen_clientes_pdv (cerraba leak P0)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS rcp_read_all   ON resumen_clientes_pdv;
DROP POLICY IF EXISTS rcp_admin      ON resumen_clientes_pdv;
DROP POLICY IF EXISTS rcp_supervisor ON resumen_clientes_pdv;
DROP POLICY IF EXISTS rcp_vendedor   ON resumen_clientes_pdv;

CREATE POLICY rcp_admin ON resumen_clientes_pdv
  FOR ALL USING (get_user_rol() = 'admin');

CREATE POLICY rcp_supervisor ON resumen_clientes_pdv
  FOR SELECT USING (
    get_user_rol() = 'supervisor'
    AND equipo = get_user_equipo()
  );

CREATE POLICY rcp_vendedor ON resumen_clientes_pdv
  FOR SELECT USING (
    get_user_rol() = 'vendedor'
    AND vendedor = get_user_vendedor()
  );

-- ------------------------------------------------------------
-- S3: re-aplicar CHECKs perdidos en config_meses
-- ------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE config_meses
    ADD CONSTRAINT config_meses_mes_chk CHECK (mes BETWEEN 1 AND 12);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE config_meses
    ADD CONSTRAINT config_meses_dias_chk CHECK (dias_laborables BETWEEN 1 AND 31);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- D1: LOCK TABLE en los recalcular_* para evitar race conditions
--     entre uploads concurrentes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalcular_resumen_diario(p_fechas date[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  -- Serializa concurrentes que toquen las mismas fechas.
  LOCK TABLE resumen_diario IN SHARE ROW EXCLUSIVE MODE;

  DELETE FROM resumen_diario WHERE fecha = ANY(p_fechas);

  INSERT INTO resumen_diario (fecha, vendedor, supervisor, equipo, rubro, kilos, neto, pdvs_activos)
  SELECT
    v.fecha,
    v.vendedor,
    vd.supervisor,
    vd.equipo,
    v.rubro,
    SUM(v.kilos)             AS kilos,
    SUM(v.neto)              AS neto,
    COUNT(DISTINCT v.pdv_id) AS pdvs_activos
  FROM ventas v
  LEFT JOIN vendedores vd ON vd.nombre = v.vendedor
  WHERE v.fecha = ANY(p_fechas)
  GROUP BY v.fecha, v.vendedor, vd.supervisor, vd.equipo, v.rubro;
END;
$function$;

CREATE OR REPLACE FUNCTION recalcular_resumen_clientes_pdv(p_periodos TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  p  TEXT;
  py INT;
  pm INT;
BEGIN
  IF p_periodos IS NULL OR array_length(p_periodos, 1) IS NULL THEN RETURN; END IF;

  LOCK TABLE resumen_clientes_pdv IN SHARE ROW EXCLUSIVE MODE;

  FOREACH p IN ARRAY p_periodos LOOP
    py := SPLIT_PART(p, '-', 1)::INT;
    pm := SPLIT_PART(p, '-', 2)::INT;

    DELETE FROM resumen_clientes_pdv WHERE anio = py AND mes = pm;

    INSERT INTO resumen_clientes_pdv (anio, mes, pdv_id, vendedor, rubro, equipo, kilos, neto, skus)
    SELECT
      EXTRACT(YEAR  FROM v.fecha)::INT,
      EXTRACT(MONTH FROM v.fecha)::INT,
      v.pdv_id,
      v.vendedor,
      v.rubro,
      MAX(vd.equipo),
      SUM(v.kilos)::NUMERIC,
      SUM(v.neto)::NUMERIC,
      COUNT(DISTINCT v.sku)::INT
    FROM ventas v
    LEFT JOIN vendedores vd ON vd.nombre = v.vendedor
    WHERE EXTRACT(YEAR  FROM v.fecha) = py
      AND EXTRACT(MONTH FROM v.fecha) = pm
      AND v.pdv_id   IS NOT NULL
      AND v.rubro    IS NOT NULL
      AND v.vendedor IS NOT NULL
    GROUP BY 1, 2, 3, 4, 5;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- C1: CHECKs en metas para evitar valores negativos
-- ------------------------------------------------------------
DO $$ BEGIN
  ALTER TABLE metas
    ADD CONSTRAINT metas_kilos_chk CHECK (kilos_meta >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE metas
    ADD CONSTRAINT metas_neto_chk CHECK (neto_meta IS NULL OR neto_meta >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
