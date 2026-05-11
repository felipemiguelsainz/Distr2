-- Add neto_meta column to store the original dollar objective per vendedor
ALTER TABLE metas ADD COLUMN IF NOT EXISTS neto_meta NUMERIC DEFAULT NULL;
