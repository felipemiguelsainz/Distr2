-- ============================================================
-- Vista "Consolidado por producto"
-- Catálogo de artículos + agregado por vendedor filtrado por artículos.
-- ============================================================

-- Catálogo: artículos distintos con su rubro (para el buscador)
CREATE OR REPLACE FUNCTION productos_catalogo()
RETURNS TABLE (rubro TEXT, articulo TEXT)
LANGUAGE sql STABLE AS $$
  SELECT DISTINCT
    COALESCE(rubro, '(sin rubro)')::TEXT,
    COALESCE(articulo, '(sin nombre)')::TEXT
  FROM ventas
  WHERE articulo IS NOT NULL
  ORDER BY 1, 2;
$$;

-- Consolidado por vendedor filtrado por una lista de artículos.
-- p_articulos NULL/vacío → todos los artículos.
CREATE OR REPLACE FUNCTION consolidado_por_producto(
  p_desde     DATE,
  p_hasta     DATE,
  p_equipo    TEXT,
  p_articulos TEXT[] DEFAULT NULL
)
RETURNS TABLE (vendedor TEXT, kilos NUMERIC, neto NUMERIC, ccc INT)
LANGUAGE sql STABLE AS $$
  SELECT
    v.vendedor,
    SUM(v.kilos)::NUMERIC,
    SUM(v.neto)::NUMERIC,
    COUNT(DISTINCT v.pdv_id)::INT
  FROM ventas v
  JOIN vendedores vd ON vd.nombre = v.vendedor
  WHERE v.fecha BETWEEN p_desde AND p_hasta
    AND vd.equipo = p_equipo
    AND (p_articulos IS NULL OR array_length(p_articulos, 1) IS NULL
         OR v.articulo = ANY(p_articulos))
  GROUP BY v.vendedor
  ORDER BY v.vendedor;
$$;
