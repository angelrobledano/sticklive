-- ============================================================
-- 073 — Memoria de bajas y fusiones de entidades (F1-7).
--
-- Una ficha pública (competición, equipo, jugador, partido) cuyo id desaparece
-- dejaba su URL en 404 sin destino. Pasa al limpiar placeholders sintéticos
-- cuando llega el partido real, al fusionar competiciones duplicadas o al
-- revertir un filial. Search Console lo confirmó el 16/10/2026: la segunda
-- página con más clics del sitio era un partido borrado (§1b y DQ-02 de
-- docs/AUDITORIA_SEO_2026-10-16.md).
--
-- Diseño:
--   · `entity_redirects (entity_type, old_id) → new_id`. `new_id` NULL = baja
--     sin sustituto. Sin FK a propósito: el id viejo ya no existe y el nuevo
--     puede desaparecer a su vez (la API sigue la cadena).
--   · Trigger AFTER DELETE en las cuatro tablas con ficha pública: TODO
--     borrado queda registrado aunque el código que borra no sepa nada de
--     esto (ON CONFLICT DO NOTHING: si una ruta ya escribió el sustituto en la
--     misma sentencia, se respeta).
--   · Las rutas que conocen al sustituto (fusión de competiciones, sintético
--     adoptado) hacen upsert con `new_id`.
--   · TRUNCATE no dispara triggers de fila: un reset completo no deja rastro,
--     que es lo esperado (no hay entidades a las que redirigir).
--
-- Idempotente y aditiva. Los permisos del rol de aplicación llegan por los
-- DEFAULT PRIVILEGES de la 062.
-- ============================================================

CREATE TABLE IF NOT EXISTS entity_redirects (
  entity_type TEXT        NOT NULL CHECK (entity_type IN ('competition', 'team', 'player', 'match')),
  old_id      UUID        NOT NULL,
  new_id      UUID,
  reason      TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_type, old_id),
  CHECK (new_id IS NULL OR new_id <> old_id)
);

COMMENT ON TABLE entity_redirects IS
  'Ids de fichas públicas que ya no existen y su sustituto (NULL = baja sin sustituto). La web responde 308 al sustituto o 404. Ver migración 073.';

CREATE OR REPLACE FUNCTION fn_record_entity_deletion()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO entity_redirects (entity_type, old_id, new_id, reason)
  VALUES (TG_ARGV[0], OLD.id, NULL, 'deleted')
  ON CONFLICT (entity_type, old_id) DO NOTHING;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_redirect_competitions ON competitions;
CREATE TRIGGER trg_entity_redirect_competitions
  AFTER DELETE ON competitions
  FOR EACH ROW EXECUTE FUNCTION fn_record_entity_deletion('competition');

DROP TRIGGER IF EXISTS trg_entity_redirect_teams ON teams;
CREATE TRIGGER trg_entity_redirect_teams
  AFTER DELETE ON teams
  FOR EACH ROW EXECUTE FUNCTION fn_record_entity_deletion('team');

DROP TRIGGER IF EXISTS trg_entity_redirect_players ON players;
CREATE TRIGGER trg_entity_redirect_players
  AFTER DELETE ON players
  FOR EACH ROW EXECUTE FUNCTION fn_record_entity_deletion('player');

DROP TRIGGER IF EXISTS trg_entity_redirect_matches ON matches;
CREATE TRIGGER trg_entity_redirect_matches
  AFTER DELETE ON matches
  FOR EACH ROW EXECUTE FUNCTION fn_record_entity_deletion('match');
