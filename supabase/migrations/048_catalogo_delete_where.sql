-- ============================================================
-- 048: el recálculo del catálogo de productos fallaba en TODAS las cargas
-- ============================================================
-- Cada carga de ventas terminaba con el aviso "Ventas guardadas, pero el
-- resumen diario no pudo recalcularse". El resumen diario estaba bien: el que
-- fallaba era el tercer paso, recalcular_catalogo_productos, con
--
--   21000: DELETE requires a WHERE clause
--
-- El rol `authenticator` —el que usa PostgREST— corre con
-- `session_preload_libraries = supautils, safeupdate`. La extensión safeupdate
-- rechaza cualquier DELETE o UPDATE sin WHERE, y eso aplica también adentro de
-- una función SECURITY DEFINER. Por eso el error es invisible desde psql: por
-- conexión directa la extensión no está cargada y el DELETE pasa. Sólo falla
-- por el camino que usa la app, y falla SIEMPRE.
--
-- Consecuencia: `catalogo_productos` nunca se refrescaba desde la app, así que
-- los artículos nuevos no aparecían en el buscador del Consolidado por
-- producto. Los otros dos pasos (resumen_diario y resumen_clientes_pdv) borran
-- con WHERE por período, por eso nunca fallaron — el aviso culpaba al paso
-- equivocado, y "Panel Admin → Recalcular" ni siquiera toca el catálogo.
--
-- `WHERE true` es lo que safeupdate pide: la intención de borrar todo tiene que
-- estar escrita, no ser un descuido.
-- ============================================================

CREATE OR REPLACE FUNCTION recalcular_catalogo_productos()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '2min'
AS $$
BEGIN
  DELETE FROM catalogo_productos WHERE true;
  INSERT INTO catalogo_productos (rubro, articulo)
  SELECT DISTINCT
    COALESCE(rubro, '(sin rubro)'),
    COALESCE(articulo, '(sin nombre)')
  FROM ventas
  WHERE articulo IS NOT NULL
  ON CONFLICT DO NOTHING;
END;
$$;
