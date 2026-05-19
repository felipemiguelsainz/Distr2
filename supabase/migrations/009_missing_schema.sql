-- ============================================================
-- MISSING SCHEMA — migration 009
-- Documents tables and functions that were created directly
-- in Supabase without a migration file.
-- Apply with: IF NOT EXISTS guards so it's idempotent.
-- ============================================================

-- ---- config_meses ----
-- Stores working-day count per calendar month (used in KPI projections)
CREATE TABLE IF NOT EXISTS config_meses (
  anio            INT NOT NULL,
  mes             INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  dias_laborables INT NOT NULL CHECK (dias_laborables BETWEEN 1 AND 31),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT config_meses_unique UNIQUE (anio, mes)
);

ALTER TABLE config_meses ENABLE ROW LEVEL SECURITY;

CREATE POLICY config_meses_read_all ON config_meses
  FOR SELECT USING (get_user_rol() IN ('admin', 'supervisor', 'vendedor'));

CREATE POLICY config_meses_admin_write ON config_meses
  FOR ALL USING (get_user_rol() = 'admin');

CREATE TRIGGER trg_config_meses_updated_at
  BEFORE UPDATE ON config_meses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- kpi_dias_trabajados ----
-- Returns the count of distinct dates with sales records in a given range.
-- Used by fetchTotalKpis / fetchSupervisorKpis to compute media_real.
CREATE OR REPLACE FUNCTION kpi_dias_trabajados(
  p_desde    date,
  p_hasta    date,
  p_equipo   text DEFAULT NULL,
  p_vendedor text DEFAULT NULL
)
RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT COUNT(DISTINCT fecha)::integer
  FROM resumen_diario
  WHERE fecha >= p_desde
    AND fecha <= p_hasta
    AND (p_equipo   IS NULL OR equipo   = p_equipo)
    AND (p_vendedor IS NULL OR vendedor = p_vendedor)
$$;

-- ---- planificacion UNIQUE constraint ----
-- Prevents duplicate planning entries for same (fecha, vendedor, rubro)
DO $$ BEGIN
  ALTER TABLE planificacion ADD CONSTRAINT planificacion_unique
    UNIQUE (fecha, vendedor_nombre, rubro);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---- asignaciones UNIQUE constraint ----
-- Prevents inserting the same cartera-vendedor assignment twice on the same date
DO $$ BEGIN
  ALTER TABLE asignaciones ADD CONSTRAINT asignaciones_unique
    UNIQUE (cartera, vendedor_nombre, fecha_desde);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
