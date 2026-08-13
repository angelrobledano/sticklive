-- ============================================================
-- 050 — A5: el enrich también corrige el marcador en históricos fiables.
--
-- El volcado (048) dio por "fiable" el marcador del histórico, pero *presente*
-- no es *correcto*: en 2022/23, 174/182 marcadores del volcado están mal (la
-- clasificación scrapeada NO cuadra con ellos, pero SÍ con el re-scrape). Así que
-- cuando el re-scrape es demostrablemente consistente —su clasificación reconcilia
-- con la suma de sus partidos— es fuente de verdad, y el enrich pisa también
-- home_score/away_score, no solo fecha/temporada.
--
-- Para poder revertir al valor exacto, guardamos también el marcador anterior.
-- ============================================================
ALTER TABLE enrich_changes
  ADD COLUMN IF NOT EXISTS old_home_score int,
  ADD COLUMN IF NOT EXISTS old_away_score int;
