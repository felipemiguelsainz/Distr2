-- Agrega columna dia_visita a pdvs.
-- Almacena el/los día(s) de visita derivados de las columnas LUN/MAR/MIE/JUE/VIE/SAB/DOM
-- del maestro de PDVs (valor 'S' = visita ese día).
-- Formato: abreviatura del día, coma-separado si hay múltiples (ej: 'LUN', 'LUN,JUE').
ALTER TABLE pdvs ADD COLUMN IF NOT EXISTS dia_visita TEXT;
