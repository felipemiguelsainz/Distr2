-- ============================================================
-- 023: equipo en profiles (supervisores sin fila en vendedores)
-- ============================================================
-- Hasta ahora el equipo de un supervisor se resolvía SOLO vía
-- profiles.vendedor_nombre -> vendedores.nombre -> vendedores.equipo,
-- lo que obligaba a que el supervisor existiera como vendedor.
-- Con esta columna un supervisor puro guarda su equipo directamente
-- en su perfil. La función get_user_equipo() prioriza ese valor y
-- cae al join con vendedores para casos legacy (ej. ANALIA TALON,
-- que es supervisora y además vende).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS equipo TEXT;

CREATE OR REPLACE FUNCTION get_user_equipo()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT COALESCE(
    (SELECT p.equipo FROM profiles p WHERE p.id = auth.uid()),
    (SELECT v.equipo
       FROM profiles p
       JOIN vendedores v ON v.nombre = p.vendedor_nombre
      WHERE p.id = auth.uid())
  );
$$;
