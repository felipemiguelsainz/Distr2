-- ============================================================
-- 043 — profiles.ve_empresa: ver toda la empresa, sin poder tocarla
-- ============================================================
-- Hasta ahora "ver los números de todos los equipos" y "poder cargar archivos,
-- borrar meses y crear usuarios" eran lo mismo: el rol admin. Para que un
-- supervisor pueda mirar Total Empresa y el mapa completo había que hacerlo
-- admin, y de paso quedaba habilitado para borrar todas las ventas de un mes.
--
-- Esta bandera separa las dos cosas. Es SOLO de lectura: amplía el alcance de
-- las pantallas que muestran datos y no toca ningún guard de escritura, que
-- siguen exigiendo rol = 'admin'.
-- ============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ve_empresa BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN profiles.ve_empresa IS
  'Solo lectura: ve los datos de toda la empresa (Total Empresa, mapa completo, '
  'consolidados de todos los equipos). No habilita ninguna escritura — para eso '
  'hace falta rol = admin.';
