-- ============================================================
-- Recalcula resumen_diario + resumen_clientes_pdv para TODO
-- el histórico. Disparado después de un master de vendedores
-- para que los equipos/supervisores denormalizados se actualicen.
-- ============================================================
CREATE OR REPLACE FUNCTION recalcular_resumen_completo()
RETURNS TABLE (fechas_procesadas INT, periodos_procesados INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '5min'
AS $$
DECLARE
  fechas   DATE[];
  periodos TEXT[];
BEGIN
  SELECT array_agg(DISTINCT fecha ORDER BY fecha)
    INTO fechas
    FROM ventas
    WHERE fecha IS NOT NULL;

  SELECT array_agg(DISTINCT to_char(fecha, 'YYYY-MM') ORDER BY to_char(fecha, 'YYYY-MM'))
    INTO periodos
    FROM ventas
    WHERE fecha IS NOT NULL;

  IF fechas IS NOT NULL AND array_length(fechas, 1) > 0 THEN
    PERFORM recalcular_resumen_diario(fechas);
  END IF;
  IF periodos IS NOT NULL AND array_length(periodos, 1) > 0 THEN
    PERFORM recalcular_resumen_clientes_pdv(periodos);
  END IF;

  RETURN QUERY SELECT
    COALESCE(array_length(fechas, 1),   0)::INT,
    COALESCE(array_length(periodos, 1), 0)::INT;
END;
$$;
