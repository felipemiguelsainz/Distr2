-- ============================================================
-- 030 — Cache de insights de IA por scope/período
-- ============================================================
-- Los insights (resumen + alertas redactados por el LLM) se cachean para no
-- regenerarlos (ni pagar tokens) en cada visita. Se regeneran on-demand.
CREATE TABLE IF NOT EXISTS ai_insights (
  scope_key    text NOT NULL,        -- ej: 'vendedor:AGUSTIN CALABRIA'
  periodo      text NOT NULL,        -- 'YYYY-MM'
  payload      jsonb NOT NULL,       -- { data, narrative }
  generated_at timestamptz DEFAULT now(),
  PRIMARY KEY (scope_key, periodo)
);
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY; -- solo service_role (bypassa RLS)
