-- ============================================================
-- 077 — `updated_at` solo se mueve si cambia el dato visible (F2-1).
--
-- El ETL hace `updated_at = NOW()` en casi todos sus upserts, aunque la fila no
-- cambie. El sitemap usa `updated_at` como `lastmod`, así que Google veía miles
-- de URLs "modificadas" en cada pasada y acabó ignorando la señal (auditoría SEO
-- del 16/10/2026, SEO-08 y F2-1).
--
-- En vez de tocar cada upsert (y volver a olvidarlo en el siguiente), un trigger
-- BEFORE UPDATE compara la fila sin `updated_at` ni `scraped_at` —los dos campos
-- que el ETL mueve en cada pasada— y, si no cambió nada más, conserva el
-- `updated_at` anterior. Un cambio real (marcador, estado, nombre, alineación)
-- sí lo mueve.
--
-- Aplica a las cuatro tablas que alimentan el sitemap: competiciones, equipos,
-- jugadores y partidos. Idempotente y aditiva.
--
-- Estas tablas ya tenían un `trg_<tabla>_updated_at` que ponía `NOW()` en cada
-- UPDATE. Se retiran para que haya una sola política: el trigger nuevo decide
-- si el timestamp se mueve. En `teams` además competían por orden alfabético
-- (`trg_stable…` corría antes que `trg_teams…` y el viejo pisaba el valor).
-- ============================================================

DROP TRIGGER IF EXISTS trg_competitions_updated_at ON competitions;
DROP TRIGGER IF EXISTS trg_teams_updated_at ON teams;
DROP TRIGGER IF EXISTS trg_players_updated_at ON players;
DROP TRIGGER IF EXISTS trg_matches_updated_at ON matches;

CREATE OR REPLACE FUNCTION fn_keep_updated_at_if_unchanged()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(OLD) - 'updated_at' - 'scraped_at')
     IS NOT DISTINCT FROM (to_jsonb(NEW) - 'updated_at' - 'scraped_at') THEN
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_keep_updated_at_if_unchanged() IS
  'Conserva updated_at cuando un UPDATE solo mueve updated_at/scraped_at. Evita lastmod falsos en el sitemap (F2-1).';

DROP TRIGGER IF EXISTS trg_stable_updated_at_competitions ON competitions;
CREATE TRIGGER trg_stable_updated_at_competitions
  BEFORE UPDATE ON competitions
  FOR EACH ROW EXECUTE FUNCTION fn_keep_updated_at_if_unchanged();

DROP TRIGGER IF EXISTS trg_stable_updated_at_teams ON teams;
CREATE TRIGGER trg_stable_updated_at_teams
  BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION fn_keep_updated_at_if_unchanged();

DROP TRIGGER IF EXISTS trg_stable_updated_at_players ON players;
CREATE TRIGGER trg_stable_updated_at_players
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION fn_keep_updated_at_if_unchanged();

DROP TRIGGER IF EXISTS trg_stable_updated_at_matches ON matches;
CREATE TRIGGER trg_stable_updated_at_matches
  BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION fn_keep_updated_at_if_unchanged();
