-- ============================================================
-- Catálogo de productos materializado.
-- SELECT DISTINCT sobre ventas (950K filas) tarda demasiado;
-- lo pre-agregamos en una tabla chica (cientos de filas).
-- ============================================================

CREATE TABLE IF NOT EXISTS catalogo_productos (
  rubro    TEXT NOT NULL,
  articulo TEXT NOT NULL,
  PRIMARY KEY (rubro, articulo)
);

ALTER TABLE catalogo_productos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogo_read_all ON catalogo_productos;
CREATE POLICY catalogo_read_all ON catalogo_productos
  FOR SELECT USING (get_user_rol() IN ('admin', 'supervisor', 'vendedor'));

-- Rebuild desde ventas
CREATE OR REPLACE FUNCTION recalcular_catalogo_productos()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '2min'
AS $$
BEGIN
  DELETE FROM catalogo_productos;
  INSERT INTO catalogo_productos (rubro, articulo)
  SELECT DISTINCT
    COALESCE(rubro, '(sin rubro)'),
    COALESCE(articulo, '(sin nombre)')
  FROM ventas
  WHERE articulo IS NOT NULL
  ON CONFLICT DO NOTHING;
END;
$$;

-- productos_catalogo ahora lee de la tabla materializada (instantáneo)
CREATE OR REPLACE FUNCTION productos_catalogo()
RETURNS TABLE (rubro TEXT, articulo TEXT)
LANGUAGE sql STABLE AS $$
  SELECT rubro, articulo FROM catalogo_productos ORDER BY rubro, articulo;
$$;
