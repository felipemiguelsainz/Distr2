-- ============================================================
-- CANDYSUR SALES DASHBOARD — INITIAL SCHEMA
-- ============================================================

-- EXTENSION
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

-- Puntos de Venta (client master)
CREATE TABLE IF NOT EXISTS pdvs (
  id                  INT PRIMARY KEY,
  razon_social        TEXT,
  domicilio           TEXT,
  localidad           TEXT,
  zona                TEXT,
  canal_distribucion  TEXT,
  canal_venta         TEXT,
  categoria_iva       TEXT,
  cuit                TEXT,
  cartera             TEXT,
  fecha_alta          DATE,
  ultima_vta          DATE,
  activo              BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Vendedores
CREATE TABLE IF NOT EXISTS vendedores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT UNIQUE NOT NULL,
  supervisor  TEXT,
  equipo      TEXT,
  localidad   TEXT,
  activo      BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Asignaciones (portfolio assignment history)
CREATE TABLE IF NOT EXISTS asignaciones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cartera         TEXT NOT NULL,
  vendedor_nombre TEXT NOT NULL,
  fecha_desde     DATE NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Ventas (daily sales lines — performance critical)
CREATE TABLE IF NOT EXISTS ventas (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha        DATE NOT NULL,
  pdv_id       INT REFERENCES pdvs(id),
  cartera      TEXT,
  vendedor     TEXT,
  razon_social TEXT,
  comprobante  TEXT,
  marca        TEXT,
  rubro        TEXT,
  sku          TEXT,
  articulo     TEXT,
  neto         NUMERIC,
  kilos        NUMERIC,
  bultos       INT,
  unidades     INT,
  mes          INT,
  anio         INT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT ventas_unique UNIQUE (fecha, pdv_id, comprobante, sku)
);

-- Metas
CREATE TABLE IF NOT EXISTS metas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  anio            INT NOT NULL,
  mes             INT NOT NULL,
  vendedor_nombre TEXT NOT NULL,
  rubro           TEXT NOT NULL,
  kilos_meta      NUMERIC NOT NULL DEFAULT 0,
  CONSTRAINT metas_unique UNIQUE (anio, mes, vendedor_nombre, rubro)
);

-- Planificacion
CREATE TABLE IF NOT EXISTS planificacion (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha              DATE NOT NULL,
  vendedor_nombre    TEXT NOT NULL,
  rubro              TEXT NOT NULL,
  kilos_planificado  NUMERIC NOT NULL DEFAULT 0,
  kilos_real         NUMERIC,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Resumen diario (pre-aggregated — source for all dashboard queries)
CREATE TABLE IF NOT EXISTS resumen_diario (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  fecha        DATE NOT NULL,
  vendedor     TEXT NOT NULL,
  supervisor   TEXT,
  equipo       TEXT,
  rubro        TEXT NOT NULL,
  kilos        NUMERIC NOT NULL DEFAULT 0,
  neto         NUMERIC NOT NULL DEFAULT 0,
  pdvs_activos INT NOT NULL DEFAULT 0,
  CONSTRAINT resumen_diario_unique UNIQUE (fecha, vendedor, rubro)
);

-- User profiles (linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS profiles (
  id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre    TEXT,
  rol       TEXT NOT NULL CHECK (rol IN ('admin', 'supervisor', 'vendedor')),
  vendedor_nombre TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES ON ventas
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_ventas_vendedor_mes_anio ON ventas(vendedor, mes, anio);
CREATE INDEX IF NOT EXISTS idx_ventas_pdv_fecha        ON ventas(pdv_id, fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_rubro_mes_anio   ON ventas(rubro, mes, anio);
CREATE INDEX IF NOT EXISTS idx_ventas_cartera_fecha    ON ventas(cartera, fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha            ON ventas(fecha);

-- ============================================================
-- INDEXES ON resumen_diario
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_resumen_vendedor_fecha ON resumen_diario(vendedor, fecha);
CREATE INDEX IF NOT EXISTS idx_resumen_equipo_fecha   ON resumen_diario(equipo, fecha);
CREATE INDEX IF NOT EXISTS idx_resumen_rubro_fecha    ON resumen_diario(rubro, fecha);

-- ============================================================
-- HELPER: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pdvs_updated_at
  BEFORE UPDATE ON pdvs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_vendedores_updated_at
  BEFORE UPDATE ON vendedores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE pdvs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendedores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE asignaciones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE planificacion   ENABLE ROW LEVEL SECURITY;
ALTER TABLE resumen_diario  ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user role
CREATE OR REPLACE FUNCTION get_user_rol()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT rol FROM profiles WHERE id = auth.uid();
$$;

-- Helper function: get current user vendedor_nombre
CREATE OR REPLACE FUNCTION get_user_vendedor()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT vendedor_nombre FROM profiles WHERE id = auth.uid();
$$;

-- Helper function: get current user equipo (via vendedores)
CREATE OR REPLACE FUNCTION get_user_equipo()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT v.equipo
  FROM profiles p
  JOIN vendedores v ON v.nombre = p.vendedor_nombre
  WHERE p.id = auth.uid();
$$;

-- ---- profiles ----
CREATE POLICY profiles_self ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY profiles_admin_all ON profiles
  FOR ALL USING (get_user_rol() = 'admin');

-- ---- pdvs ----
CREATE POLICY pdvs_read_all ON pdvs
  FOR SELECT USING (get_user_rol() IN ('admin', 'supervisor', 'vendedor'));

CREATE POLICY pdvs_admin_write ON pdvs
  FOR ALL USING (get_user_rol() = 'admin');

-- ---- vendedores ----
CREATE POLICY vendedores_read_all ON vendedores
  FOR SELECT USING (get_user_rol() IN ('admin', 'supervisor', 'vendedor'));

CREATE POLICY vendedores_admin_write ON vendedores
  FOR ALL USING (get_user_rol() = 'admin');

-- ---- asignaciones ----
CREATE POLICY asignaciones_read_all ON asignaciones
  FOR SELECT USING (get_user_rol() IN ('admin', 'supervisor', 'vendedor'));

CREATE POLICY asignaciones_admin_write ON asignaciones
  FOR ALL USING (get_user_rol() = 'admin');

-- ---- ventas ----
CREATE POLICY ventas_admin ON ventas
  FOR ALL USING (get_user_rol() = 'admin');

CREATE POLICY ventas_supervisor ON ventas
  FOR SELECT USING (
    get_user_rol() = 'supervisor'
    AND vendedor IN (
      SELECT nombre FROM vendedores
      WHERE equipo = get_user_equipo()
    )
  );

CREATE POLICY ventas_vendedor ON ventas
  FOR SELECT USING (
    get_user_rol() = 'vendedor'
    AND vendedor = get_user_vendedor()
  );

-- ---- metas ----
CREATE POLICY metas_admin ON metas
  FOR ALL USING (get_user_rol() = 'admin');

CREATE POLICY metas_supervisor ON metas
  FOR SELECT USING (
    get_user_rol() = 'supervisor'
    AND vendedor_nombre IN (
      SELECT nombre FROM vendedores WHERE equipo = get_user_equipo()
    )
  );

CREATE POLICY metas_vendedor ON metas
  FOR SELECT USING (
    get_user_rol() = 'vendedor'
    AND vendedor_nombre = get_user_vendedor()
  );

-- ---- planificacion ----
CREATE POLICY planificacion_admin ON planificacion
  FOR ALL USING (get_user_rol() = 'admin');

CREATE POLICY planificacion_supervisor ON planificacion
  FOR ALL USING (
    get_user_rol() = 'supervisor'
    AND vendedor_nombre IN (
      SELECT nombre FROM vendedores WHERE equipo = get_user_equipo()
    )
  );

CREATE POLICY planificacion_vendedor ON planificacion
  FOR SELECT USING (
    get_user_rol() = 'vendedor'
    AND vendedor_nombre = get_user_vendedor()
  );

-- ---- resumen_diario ----
CREATE POLICY resumen_admin ON resumen_diario
  FOR ALL USING (get_user_rol() = 'admin');

CREATE POLICY resumen_supervisor ON resumen_diario
  FOR SELECT USING (
    get_user_rol() = 'supervisor'
    AND equipo = get_user_equipo()
  );

CREATE POLICY resumen_vendedor ON resumen_diario
  FOR SELECT USING (
    get_user_rol() = 'vendedor'
    AND vendedor = get_user_vendedor()
  );

-- ============================================================
-- SERVICE ROLE BYPASS (for API routes using service key)
-- ============================================================
-- Policies above apply to anon/authenticated.
-- Service role key bypasses RLS by default in Supabase.
