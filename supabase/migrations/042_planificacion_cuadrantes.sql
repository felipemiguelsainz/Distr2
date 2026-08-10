-- ============================================================
-- 042 — PLANIFICACIÓN: cuadrantes dibujados sobre el mapa
-- ============================================================
-- Capa de asignación PARALELA al maestro de PDVs. Deliberadamente NO toca
-- pdvs.cartera ni pdvs.dia_visita: el maestro se vuelve a subir por Excel y
-- pisaría cualquier cambio. Acá vive la zonificación "de escritorio".
--
-- Modelo:
--   cuadrante = polígono + día + vendedor (la unidad que se dibuja y se guarda)
--   asignación = qué PDVs quedaron adentro de ese cuadrante
--
-- Regla de unicidad: un PDV no puede estar en dos cuadrantes del MISMO día.
-- Se garantiza con una FK compuesta (cuadrante_id, dia) + UNIQUE (pdv_id, dia),
-- así el día de la asignación no puede divergir del día de su cuadrante y
-- ON UPDATE CASCADE lo propaga si se reetiqueta el cuadrante.
--
-- La otra regla —un PDV no puede tener dos vendedores planificados distintos—
-- NO se declara acá a propósito: es un conflicto que el usuario resuelve a mano
-- ("¿se lo saco a Juan o se lo dejo?"), así que lo arbitra la API, no un
-- constraint que abortaría la transacción. Un PDV SÍ puede estar en varios
-- cuadrantes del mismo vendedor en días distintos = visita 2 veces por semana.
-- ============================================================

CREATE TABLE IF NOT EXISTS plan_cuadrantes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          TEXT NOT NULL,
  dia             TEXT NOT NULL CHECK (dia IN ('LUN','MAR','MIE','JUE','VIE','SAB')),
  vendedor_nombre TEXT NOT NULL REFERENCES vendedores(nombre) ON UPDATE CASCADE,
  color           TEXT NOT NULL DEFAULT '#0c5cab',
  -- [[lat, lng], ...] — anillo exterior del polígono, sin cerrar.
  poligono        JSONB NOT NULL,
  -- Localidad sobre la que se estaba trabajando. Solo referencia/filtro: el
  -- polígono manda, un cuadrante puede cruzar el límite de la localidad.
  localidad       TEXT,
  creado_por      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  -- Destino de la FK compuesta de plan_asignaciones (ver arriba).
  CONSTRAINT plan_cuadrantes_id_dia_uniq UNIQUE (id, dia)
);

CREATE INDEX IF NOT EXISTS idx_plan_cuadrantes_vendedor ON plan_cuadrantes(vendedor_nombre);
CREATE INDEX IF NOT EXISTS idx_plan_cuadrantes_dia      ON plan_cuadrantes(dia);

DROP TRIGGER IF EXISTS trg_plan_cuadrantes_updated_at ON plan_cuadrantes;
CREATE TRIGGER trg_plan_cuadrantes_updated_at
  BEFORE UPDATE ON plan_cuadrantes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS plan_asignaciones (
  cuadrante_id UUID NOT NULL,
  dia          TEXT NOT NULL,
  pdv_id       INT  NOT NULL REFERENCES pdvs(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (cuadrante_id, pdv_id),
  CONSTRAINT plan_asig_cuadrante_fk FOREIGN KEY (cuadrante_id, dia)
    REFERENCES plan_cuadrantes(id, dia) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT plan_asig_pdv_dia_uniq UNIQUE (pdv_id, dia)
);

CREATE INDEX IF NOT EXISTS idx_plan_asignaciones_pdv ON plan_asignaciones(pdv_id);

-- ============================================================
-- RLS — solo admin y supervisor. El vendedor no entra a Planificación.
-- ============================================================
ALTER TABLE plan_cuadrantes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_asignaciones ENABLE ROW LEVEL SECURITY;

-- ---- plan_cuadrantes ----
DROP POLICY IF EXISTS plan_cuadrantes_admin ON plan_cuadrantes;
CREATE POLICY plan_cuadrantes_admin ON plan_cuadrantes
  FOR ALL USING (get_user_rol() = 'admin');

-- El supervisor solo ve y toca cuadrantes de vendedores de SU equipo.
-- WITH CHECK además le impide mover un cuadrante a un vendedor de otro equipo.
DROP POLICY IF EXISTS plan_cuadrantes_supervisor ON plan_cuadrantes;
CREATE POLICY plan_cuadrantes_supervisor ON plan_cuadrantes
  FOR ALL
  USING (
    get_user_rol() = 'supervisor'
    AND vendedor_nombre IN (
      SELECT v.nombre FROM vendedores v
      WHERE v.equipo = get_user_equipo() AND v.activo = true
    )
  )
  WITH CHECK (
    get_user_rol() = 'supervisor'
    AND vendedor_nombre IN (
      SELECT v.nombre FROM vendedores v
      WHERE v.equipo = get_user_equipo() AND v.activo = true
    )
  );

-- ---- plan_asignaciones ----
-- Hereda el permiso de su cuadrante: si podés ver/tocar el cuadrante, podés
-- ver/tocar sus PDVs. Evita duplicar la lógica de equipos en dos lugares.
DROP POLICY IF EXISTS plan_asignaciones_admin ON plan_asignaciones;
CREATE POLICY plan_asignaciones_admin ON plan_asignaciones
  FOR ALL USING (get_user_rol() = 'admin');

DROP POLICY IF EXISTS plan_asignaciones_supervisor ON plan_asignaciones;
CREATE POLICY plan_asignaciones_supervisor ON plan_asignaciones
  FOR ALL
  USING (
    get_user_rol() = 'supervisor'
    AND EXISTS (
      SELECT 1 FROM plan_cuadrantes c
      WHERE c.id = plan_asignaciones.cuadrante_id
        AND c.vendedor_nombre IN (
          SELECT v.nombre FROM vendedores v
          WHERE v.equipo = get_user_equipo() AND v.activo = true
        )
    )
  )
  WITH CHECK (
    get_user_rol() = 'supervisor'
    AND EXISTS (
      SELECT 1 FROM plan_cuadrantes c
      WHERE c.id = plan_asignaciones.cuadrante_id
        AND c.vendedor_nombre IN (
          SELECT v.nombre FROM vendedores v
          WHERE v.equipo = get_user_equipo() AND v.activo = true
        )
    )
  );
