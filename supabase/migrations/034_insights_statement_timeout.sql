-- ============================================================
-- 034 — Subir statement_timeout de los RPCs de insights
-- ============================================================
-- PostgREST/Supabase cancela statements a los ~8s. Las agregaciones de insights
-- escanean toda la tabla ventas y, sobre todo cross_sell (~10s) y bajo carga
-- concurrente, se pasan de ese límite → devuelven NULL y el insight queda roto
-- (todos los PDVs caen como "en riesgo"). Les damos margen a nivel función.
ALTER FUNCTION pdvs_ultima_vta()       SET statement_timeout = '30s';
ALTER FUNCTION pdvs_valor_12m()        SET statement_timeout = '30s';
ALTER FUNCTION pdvs_cadencia()         SET statement_timeout = '30s';
ALTER FUNCTION cross_sell(text[])      SET statement_timeout = '30s';
