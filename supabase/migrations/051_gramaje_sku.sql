-- ============================================================
-- 051 — Gramaje corregido por SKU
-- ============================================================
-- Los kilos de `ventas` vienen del ERP, que los calcula con el "Peso Neto (Kg)"
-- del maestro de artículos. Ese peso estaba mal en ~100 artículos (TANG 12X20X15G
-- figuraba con 4,8 kg por bulto y son 3,6; CLIGHT 16X20X7G con 3,2 y son 2,24).
-- Verificado contra "Info Logística Productos" (KG/BULTO), que coincide con la
-- fórmula del nombre del artículo en 179 de 183 casos.
--
--   gramaje_sku.factor = kg/bulto correcto ÷ kg/bulto que usó el ERP
--
-- Un trigger lo aplica en cada INSERT/UPDATE de kilos, así que cubre la carga web
-- y los scripts locales sin tocar el código. El kilo original del ERP queda en
-- ventas.kilos_erp (sólo en las filas corregidas) para poder revertir.
--
-- El trigger corrige el kilo que ENTRA: al re-subir un archivo del ERP (kilos
-- crudos) se vuelve a corregir una sola vez. No re-corrige updates que no
-- cambian `kilos`.
-- ============================================================
CREATE TABLE IF NOT EXISTS gramaje_sku (
  sku               TEXT PRIMARY KEY,
  descripcion       TEXT,
  kg_bulto_erp      NUMERIC NOT NULL CHECK (kg_bulto_erp > 0),
  kg_bulto_correcto NUMERIC NOT NULL CHECK (kg_bulto_correcto > 0),
  factor            NUMERIC GENERATED ALWAYS AS (kg_bulto_correcto / kg_bulto_erp) STORED,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE gramaje_sku ENABLE ROW LEVEL SECURITY;  -- sólo service_role

ALTER TABLE ventas ADD COLUMN IF NOT EXISTS kilos_erp NUMERIC;

CREATE OR REPLACE FUNCTION aplicar_gramaje()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  f NUMERIC;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.kilos IS NOT DISTINCT FROM OLD.kilos THEN
    RETURN NEW;
  END IF;
  SELECT factor INTO f FROM gramaje_sku WHERE sku = NEW.sku;
  IF f IS NULL THEN
    NEW.kilos_erp := NULL;
  ELSE
    NEW.kilos_erp := NEW.kilos;
    NEW.kilos     := NEW.kilos * f;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_aplicar_gramaje ON ventas;
CREATE TRIGGER trg_aplicar_gramaje
  BEFORE INSERT OR UPDATE OF kilos ON ventas
  FOR EACH ROW EXECUTE FUNCTION aplicar_gramaje();
