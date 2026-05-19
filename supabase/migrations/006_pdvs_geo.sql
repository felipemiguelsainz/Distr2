-- ============================================================
-- PDVs GEOLOCATION TABLE — migration 006
-- Stores enriched address + lat/lng data for PDVs, linked
-- by FK to pdvs.id. Arrives separately from the base PDV master.
-- ============================================================

CREATE TABLE IF NOT EXISTS pdvs_geo (
  pdv_id         INT PRIMARY KEY REFERENCES pdvs(id) ON DELETE CASCADE,
  partido        TEXT,
  provincia      TEXT,
  calle          TEXT,
  altura         TEXT,
  entre1         TEXT,
  entre2         TEXT,
  latitud        NUMERIC(10,6),
  longitud       NUMERIC(10,6),
  ruteable       BOOLEAN,
  domicilio_geo  TEXT,
  fecha_geo      DATE,
  hora_geo       TEXT,
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdvs_geo_latlon
  ON pdvs_geo(latitud, longitud) WHERE latitud IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pdvs_geo_partido
  ON pdvs_geo(partido);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE pdvs_geo ENABLE ROW LEVEL SECURITY;

CREATE POLICY pdvs_geo_read_all ON pdvs_geo
  FOR SELECT USING (get_user_rol() IN ('admin', 'supervisor', 'vendedor'));

CREATE POLICY pdvs_geo_admin_write ON pdvs_geo
  FOR ALL USING (get_user_rol() = 'admin');
