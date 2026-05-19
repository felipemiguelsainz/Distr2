-- ============================================================
-- Rollback: el home fue removido del producto. Borrar las RPCs
-- que solo lo servían. La tabla `resumen_clientes_pdv` y la
-- función `recalcular_resumen_clientes_pdv` se MANTIENEN porque
-- aceleran clientes_compra_rubro / clientes_activos_total / fetchCCC.
-- ============================================================

DROP FUNCTION IF EXISTS home_resumen_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_ccc_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_drop_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_surtido_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_cartera_activa_mensual(DATE, DATE);
DROP FUNCTION IF EXISTS home_top_productos(DATE, DATE, INT);
DROP FUNCTION IF EXISTS home_top_rubros(DATE, DATE);
DROP FUNCTION IF EXISTS home_top_clientes(DATE, DATE, INT);
DROP FUNCTION IF EXISTS home_mix_canal(DATE, DATE);
DROP FUNCTION IF EXISTS home_facturacion_localidad_mensual(DATE, DATE, INT);
DROP FUNCTION IF EXISTS home_facturacion_supervisor_mensual(DATE, DATE);
