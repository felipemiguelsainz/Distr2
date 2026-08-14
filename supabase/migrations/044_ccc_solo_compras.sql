-- ============================================================
-- 044: CCC cuenta sólo clientes que efectivamente compraron
-- ============================================================
-- CCC = "Clientes que Compraron". Las tres funciones que lo calculan hacían
-- COUNT(DISTINCT pdv_id) sobre resumen_clientes_pdv sin exigir que el
-- movimiento del mes fuera una compra, así que un PDV cuyo único movimiento
-- fue una DEVOLUCIÓN contaba como cliente que compró.
--
-- Medido sobre datos reales antes de este cambio:
--
--   Período   CCC informado   CCC real   Inflado
--   2026-08        2.558       2.387      6,7%
--   2026-07        3.820       3.700      3,1%
--   2026-06        3.892       3.771      3,1%
--   2026-05        3.766       3.634      3,5%
--   2026-04        3.940       3.791      3,8%
--   2026-03        3.750       3.617      3,5%
--
-- En 2026-08 los 173 PDVs de más suman -362,5 kilos y -$5.131.037: son
-- devoluciones puras, sin una sola línea de compra en el mes. Por vendedor
-- pega más fuerte que el promedio — ROMINA MONTEROS informaba 57 clientes
-- cuando eran 40 (43% inflado), ANALIA TALON 99 contra 86.
--
-- El filtro va por FILA, no por PDV agregado: un PDV que compró chocolates y
-- devolvió galletitas tiene la fila de chocolates en positivo y cuenta —
-- compró. Y en el corte por rubro cuenta en Chocolates y no en Biscuits, que
-- es lo correcto.
--
-- `kilos > 0 OR neto > 0` y no sólo kilos: cubre un rubro que se venda por
-- unidad y quede en 0 kilos con neto positivo. Hoy ambos criterios dan el
-- mismo resultado; el OR es para que siga siendo cierto si eso cambia.
--
-- NO se toca resumen_clientes_pdv ni recalcular_resumen_clientes_pdv: las
-- devoluciones tienen que seguir estando ahí, porque restan de los totales de
-- kilos y facturación. El problema es contar PDVs, no guardar el movimiento.
-- ============================================================

CREATE OR REPLACE FUNCTION ccc_por_vendedor(
  p_desde      date,
  p_hasta      date,
  p_equipo     text   DEFAULT NULL,
  p_vendedores text[] DEFAULT NULL
)
RETURNS TABLE(vendedor text, clientes bigint)
LANGUAGE sql STABLE AS $$
  SELECT
    rcp.vendedor,
    COUNT(DISTINCT rcp.pdv_id)::bigint AS clientes
  FROM resumen_clientes_pdv rcp
  WHERE (rcp.anio * 100 + rcp.mes)
          BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
              AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    AND (rcp.kilos > 0 OR rcp.neto > 0)
    AND (p_equipo     IS NULL OR rcp.equipo   = p_equipo)
    AND (p_vendedores IS NULL OR rcp.vendedor = ANY(p_vendedores))
  GROUP BY rcp.vendedor
$$;

CREATE OR REPLACE FUNCTION clientes_compra_rubro(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS TABLE(rubro text, clientes bigint)
LANGUAGE sql STABLE AS $$
  SELECT rubro, COUNT(DISTINCT pdv_id)::BIGINT
  FROM resumen_clientes_pdv
  WHERE (anio * 100 + mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    AND (kilos > 0 OR neto > 0)
    AND (p_vendedores IS NULL OR vendedor = ANY(p_vendedores))
  GROUP BY rubro
  ORDER BY rubro;
$$;

CREATE OR REPLACE FUNCTION clientes_activos_total(
  p_desde      date,
  p_hasta      date,
  p_vendedores text[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT COUNT(DISTINCT pdv_id)::bigint
  FROM resumen_clientes_pdv
  WHERE (anio * 100 + mes) BETWEEN (EXTRACT(YEAR FROM p_desde)::INT * 100 + EXTRACT(MONTH FROM p_desde)::INT)
                                AND (EXTRACT(YEAR FROM p_hasta)::INT * 100 + EXTRACT(MONTH FROM p_hasta)::INT)
    AND (kilos > 0 OR neto > 0)
    AND (p_vendedores IS NULL OR vendedor = ANY(p_vendedores));
$$;
