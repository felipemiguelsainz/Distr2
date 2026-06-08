-- ============================================================
-- METAS CCC — migration 026
-- Metas de Clientes con Compra (CCC) por vendedor, con cascadeo por rubro.
-- rubro NULL = meta total del vendedor; rubro != NULL = meta de esa categoría.
--
-- NOTA: se usa UNIQUE NULLS NOT DISTINCT (Postgres 15+, Supabase) para que la
-- fila total (rubro IS NULL) sea única por (mes,anio,vendedor) y el upsert
-- ON CONFLICT funcione. El UNIQUE clásico trata los NULL como distintos y
-- permitiría filas total duplicadas.
-- ============================================================

CREATE TABLE IF NOT EXISTS metas_ccc (
  id              BIGSERIAL PRIMARY KEY,
  mes             INT NOT NULL,
  anio            INT NOT NULL,
  vendedor        TEXT NOT NULL REFERENCES vendedores(nombre),
  rubro           TEXT,                       -- NULL = meta total
  meta_pdvs       INT NOT NULL,
  es_preset       BOOLEAN DEFAULT true,       -- false si fue editada por supervisor
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT metas_ccc_uniq UNIQUE NULLS NOT DISTINCT (mes, anio, vendedor, rubro)
);

CREATE INDEX IF NOT EXISTS idx_metas_ccc_periodo ON metas_ccc(mes, anio, vendedor);

ALTER TABLE metas_ccc ENABLE ROW LEVEL SECURITY;

-- Admin: todo
DROP POLICY IF EXISTS metas_ccc_admin ON metas_ccc;
CREATE POLICY metas_ccc_admin ON metas_ccc
  FOR ALL USING (get_user_rol() = 'admin');

-- Supervisor + vendedor: lectura
DROP POLICY IF EXISTS metas_ccc_read ON metas_ccc;
CREATE POLICY metas_ccc_read ON metas_ccc
  FOR SELECT USING (get_user_rol() IN ('supervisor', 'vendedor'));

-- Supervisor: update solo de vendedores de su equipo (USING + WITH CHECK para
-- que tampoco pueda mover la fila a un vendedor de otro equipo).
DROP POLICY IF EXISTS metas_ccc_supervisor_write ON metas_ccc;
CREATE POLICY metas_ccc_supervisor_write ON metas_ccc
  FOR UPDATE
  USING (
    get_user_rol() = 'supervisor'
    AND vendedor IN (
      SELECT v.nombre FROM vendedores v
      WHERE v.equipo = get_user_equipo() AND v.activo = true
    )
  )
  WITH CHECK (
    get_user_rol() = 'supervisor'
    AND vendedor IN (
      SELECT v.nombre FROM vendedores v
      WHERE v.equipo = get_user_equipo() AND v.activo = true
    )
  );
