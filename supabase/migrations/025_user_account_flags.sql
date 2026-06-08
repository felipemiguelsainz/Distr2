-- ============================================================
-- USER ACCOUNT FLAGS — migration 025
-- - must_change_password: fuerza cambio de contraseña en primer login
--   (se setea true al crear la cuenta, false cuando el usuario la cambia)
-- - activo: permite desactivar/reactivar cuentas sin borrarlas
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true;
