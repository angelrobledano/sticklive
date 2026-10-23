-- ============================================================
-- 092 — Escudo bloqueado por equipo
--
-- A veces la federación sirve un escudo equivocado (FECAPA pone el de Arenys
-- de Mar a CHAM Maristes-Sagrerenc). Varios caminos rellenan teams.logo_url
-- (calendario, histórico, seeds), así que el bloqueo va en la BD: con
-- logo_locked = true, ninguna ingesta cambia el escudo.
-- Para desbloquear: UPDATE teams SET logo_locked = false WHERE ...
-- ============================================================
ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_locked BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION teams_keep_locked_logo() RETURNS trigger AS $$
BEGIN
  IF OLD.logo_locked AND NEW.logo_locked THEN
    NEW.logo_url := OLD.logo_url;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_teams_keep_locked_logo ON teams;
CREATE TRIGGER trg_teams_keep_locked_logo
  BEFORE UPDATE OF logo_url ON teams
  FOR EACH ROW EXECUTE FUNCTION teams_keep_locked_logo();

-- Maristes-Sagrerenc: sin escudo (la 091 ya le quitó el de Arenys) y bloqueado.
UPDATE teams SET logo_url = NULL, logo_locked = true, updated_at = NOW()
 WHERE name ILIKE '%MARISTES%SAGRERENC%';
