-- ============================================================
-- 047: la columna CCC del consolidado por producto cuenta sólo compras
-- ============================================================
-- La pantalla la rotula "CCC — Clientes con Compra", pero consolidado_por_producto
-- hacía COUNT(DISTINCT v.pdv_id) plano: un PDV cuyo único movimiento del artículo
-- fue una devolución contaba como cliente con compra. O sea, la misma 044 pero
-- en la otra pantalla, y por eso los dos números no cerraban entre sí.
--
-- Medido sobre julio 2026, sin filtrar artículos (o sea, exactamente el mismo
-- universo que el CCC del dashboard):
--
--   consolidado por producto ...... 3.814
--   ccc_por_vendedor .............. 3.701
--   vendedores con diferencia ..... 30 de 37
--
-- El corte va por (pdv, vendedor, rubro), la misma unidad que usa la 044, para
-- que las dos pantallas reconcilien: sin filtrar artículos, esta columna tiene
-- que dar el mismo número que ccc_por_vendedor. Cortar por artículo en vez de
-- por rubro daba 3 clientes más (PDVs que compraron un artículo y devolvieron
-- otro del mismo rubro por más plata), y dos números distintos rotulados CCC.
--
-- Los SUM de kilos y neto NO cambian: las devoluciones tienen que seguir
-- restando de la facturación. Lo que se arregla es contar clientes.
-- ============================================================

CREATE OR REPLACE FUNCTION consolidado_por_producto(
  p_desde     DATE,
  p_hasta     DATE,
  p_equipo    TEXT,
  p_articulos TEXT[] DEFAULT NULL
)
RETURNS TABLE (vendedor TEXT, kilos NUMERIC, neto NUMERIC, ccc INT)
LANGUAGE sql STABLE AS $$
  WITH filtradas AS (
    SELECT v.vendedor, v.pdv_id, v.rubro, v.kilos, v.neto
    FROM ventas v
    JOIN vendedores vd ON vd.nombre = v.vendedor
    WHERE v.fecha BETWEEN p_desde AND p_hasta
      AND (p_equipo IS NULL OR vd.equipo = p_equipo)
      AND (p_articulos IS NULL OR array_length(p_articulos, 1) IS NULL
           OR v.articulo = ANY(p_articulos))
  ),
  compradores AS (
    SELECT vendedor, COUNT(DISTINCT pdv_id)::INT AS ccc
    FROM (
      SELECT vendedor, pdv_id
      FROM filtradas
      WHERE pdv_id IS NOT NULL
      GROUP BY vendedor, pdv_id, rubro
      HAVING SUM(kilos) > 0 OR SUM(neto) > 0
    ) t
    GROUP BY vendedor
  )
  SELECT f.vendedor, SUM(f.kilos)::NUMERIC, SUM(f.neto)::NUMERIC, COALESCE(c.ccc, 0)::INT
  FROM filtradas f
  LEFT JOIN compradores c ON c.vendedor = f.vendedor
  GROUP BY f.vendedor, c.ccc
  ORDER BY f.vendedor;
$$;
