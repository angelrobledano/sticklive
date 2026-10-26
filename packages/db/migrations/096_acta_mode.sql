-- ============================================================
-- 096 — Actas que solo se publican al final (#417)
--
-- competitions.acta_mode: 'live' (acta con cronología en directo), 'post'
--   (solo al final) o NULL (sin aprender). Lo aprende cron-live.
-- competitions.acta_post_strikes: directos con goles y ficha vacía seguidos.
-- matches.ficha_fetched_at / ficha_finished_tries: para espaciar la petición
--   de la ficha. No tocan updated_at (la selección de candidatos lo usa).
-- matches.acta_probe: este partido ya contó como directo sin acta (cada
--   partido cuenta una sola vez, no una por ciclo).
-- Aditiva.
-- ============================================================
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS acta_mode TEXT
  CHECK (acta_mode IS NULL OR acta_mode IN ('live', 'post'));
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS acta_post_strikes INT NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ficha_fetched_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ficha_finished_tries INT NOT NULL DEFAULT 0;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS acta_probe BOOLEAN NOT NULL DEFAULT false;
