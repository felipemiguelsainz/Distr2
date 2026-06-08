-- ============================================================
-- 024 — Lock down SECURITY DEFINER write/recalc functions
-- ============================================================
-- Postgres concede EXECUTE a PUBLIC por defecto en cada funcion nueva.
-- Estas funciones son SECURITY DEFINER (corren como el dueño y saltan RLS)
-- y solo deben invocarse desde el backend con la service_role key.
-- Sin este REVOKE, cualquiera con la anon key (que es publica) podria
-- llamarlas via /rest/v1/rpc/... para escribir/corromper datos o disparar
-- recalculos costosos (DoS). Aca les quitamos el acceso a anon/authenticated.
--
-- Nota: las RPC que devuelven datos (kpi_*, ccc_por_vendedor,
-- clientes_compra_rubro, etc.) son SECURITY INVOKER y respetan RLS, por eso
-- NO se tocan aca — authenticated las necesita (p. ej. kpi_dias_trabajados).

-- bulk_upsert_pdvs_geo(jsonb)
REVOKE EXECUTE ON FUNCTION bulk_upsert_pdvs_geo(jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION bulk_upsert_pdvs_geo(jsonb) TO service_role;

-- recalcular_resumen_diario(date[])
REVOKE EXECUTE ON FUNCTION recalcular_resumen_diario(date[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION recalcular_resumen_diario(date[]) TO service_role;

-- recalcular_resumen_completo()
REVOKE EXECUTE ON FUNCTION recalcular_resumen_completo() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION recalcular_resumen_completo() TO service_role;

-- recalcular_resumen_clientes_pdv(text[])
REVOKE EXECUTE ON FUNCTION recalcular_resumen_clientes_pdv(text[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION recalcular_resumen_clientes_pdv(text[]) TO service_role;

-- recalcular_catalogo_productos()
REVOKE EXECUTE ON FUNCTION recalcular_catalogo_productos() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION recalcular_catalogo_productos() TO service_role;
