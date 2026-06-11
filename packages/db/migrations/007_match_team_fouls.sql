-- ============================================================
-- Migración 007: Faltas de equipo por partido
-- Fuente: divs .report_faltas en la cabecera de la ficha
-- (rfep_gr_{idp}_1.php). Son las faltas de equipo acumuladas,
-- NO las tarjetas azules (que son sanciones individuales).
-- ============================================================

ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_fouls INTEGER;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_fouls INTEGER;
